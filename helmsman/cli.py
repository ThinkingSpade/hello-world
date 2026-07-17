"""CLI: helmsman incident | watch | record | fixtures.

`record` runs the REAL pipeline against a canned cluster fixture and emits
the replay session the demo player consumes — same code path as a live
incident, minus the cluster.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .kube import FakeKubectl, Kubectl
from .llm import LLMDiagnoser
from .pipeline import Incident
from .signatures import ExtractiveDiagnoser

FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _fixtures() -> dict[str, Path]:
    return {p.stem: p for p in sorted(FIXTURE_DIR.glob("*.json"))}


def _ask_approval(proposal: dict) -> bool:
    print("\n─── PROPOSAL " + "─" * 47)
    print(f"  risk: {proposal['risk'].upper()}")
    print(f"  $ {proposal['command']}")
    print(f"  why: {proposal['explain']}")
    print(f"  rollback: {proposal['rollback']}")
    ans = input("\napply this fix? [y/N] ").strip().lower()
    return ans == "y"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="helmsman", description="Helmsman — agentic DevOps copilot with a hard human gate")
    sub = parser.add_subparsers(dest="command", required=True)

    inc = sub.add_parser("incident", help="triage + diagnose one incident on a real cluster")
    inc.add_argument("-n", "--namespace", required=True)
    inc.add_argument("-l", "--selector", required=True, help="label selector, e.g. app=checkout-api")
    inc.add_argument("--context", default=None, help="kubeconfig context")
    inc.add_argument("--llm", choices=["anthropic", "openai"], default=None,
                     help="rewrite the cause narrative with a model (fix stays templated)")
    inc.add_argument("--read-only", action="store_true",
                     help="never offer to apply; report and exit")

    wat = sub.add_parser("watch", help="poll a namespace, report anything unhealthy")
    wat.add_argument("-n", "--namespace", required=True)
    wat.add_argument("--context", default=None)
    wat.add_argument("--interval", type=int, default=60)

    rec = sub.add_parser("record", help="run the pipeline on a fixture, save a replay session")
    rec.add_argument("--fixture", required=True, choices=sorted(_fixtures()))
    rec.add_argument("-o", "--out", required=True)
    rec.add_argument("--decline", action="store_true",
                     help="record the operator declining at the gate")

    sub.add_parser("fixtures", help="list bundled incident fixtures")

    args = parser.parse_args(argv)

    if args.command == "fixtures":
        for name, path in _fixtures().items():
            meta = json.loads(path.read_text())
            print(f"{name:18} {meta['title']}")
        return 0

    if args.command == "record":
        fx = json.loads(_fixtures()[args.fixture].read_text())
        kube = FakeKubectl(fx)
        inc_run = Incident(kube, fx["namespace"], fx["selector"])
        session = inc_run.run(approve_cb=lambda p: not args.decline,
                              page_text=fx["page"])
        session.update({
            "id": fx["id"], "title": fx["title"], "tag": fx["tag"],
            "recorded": "fixture-replay", "board": fx["board"],
        })
        Path(args.out).write_text(json.dumps(session, indent=1, ensure_ascii=False))
        print(f"recorded → {args.out}  (resolved={session['resolved']})")
        return 0

    if args.command == "incident":
        kube = Kubectl(context=args.context)
        diagnoser = LLMDiagnoser(args.llm) if args.llm else ExtractiveDiagnoser()
        inc_run = Incident(kube, args.namespace, args.selector, diagnoser)
        approve = (lambda p: False) if args.read_only else _ask_approval
        session = inc_run.run(approve_cb=approve)
        last = session["timeline"][-1]
        print(f"\n{last.get('result', '—').upper()}: {last.get('text', '')}")
        return 0 if session["resolved"] else 1

    if args.command == "watch":
        import time
        kube = Kubectl(context=args.context)
        print(f"watching {args.namespace} every {args.interval}s — read-only, "
              f"run `helmsman incident` to act")
        while True:
            out = kube.run(f"get pods -n {args.namespace}")
            bad = [l for l in out.splitlines()[1:]
                   if l.strip() and (" Running " not in l or l.split()[1].split("/")[0]
                                     != l.split()[1].split("/")[1])]
            if bad:
                print(f"\nunhealthy pods in {args.namespace}:")
                for l in bad:
                    print("  " + l)
            time.sleep(args.interval)

    return 1


if __name__ == "__main__":
    sys.exit(main())
