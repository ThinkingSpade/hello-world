"""CLI: conductor scenarios | run | record.

`record` runs the REAL pipeline + agent against a scenario warehouse and
emits the replay session the demo player consumes — the SQL executes, the
data actually breaks and actually gets repaired; the demo just plays back
the ledger.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .agent import Agent
from .warehouse import SCENARIOS, build


def _ask_approval(proposal: dict) -> bool:
    print("\n─── PROPOSAL " + "─" * 47)
    print(f"  risk: {proposal['risk'].upper()}")
    print(proposal["command"])
    print(f"  why: {proposal['explain']}")
    print(f"  rollback: {proposal['rollback']}")
    ans = input("\napply this repair? [y/N] ").strip().lower()
    return ans == "y"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="conductor",
        description="Conductor — data-pipeline reliability agent with a hard human gate")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("scenarios", help="list the bundled derailments")

    run = sub.add_parser("run", help="run a scenario interactively (you are the gate)")
    run.add_argument("--scenario", required=True, choices=sorted(SCENARIOS))

    rec = sub.add_parser("record", help="run a scenario, save the replay session")
    rec.add_argument("--scenario", required=True, choices=sorted(SCENARIOS))
    rec.add_argument("-o", "--out", required=True)
    rec.add_argument("--decline", action="store_true",
                     help="record the dispatcher declining at the gate")

    args = parser.parse_args(argv)

    if args.command == "scenarios":
        for name, meta in SCENARIOS.items():
            print(f"{name:14} {meta['title']}")
        return 0

    meta = SCENARIOS[args.scenario]
    conn = build(args.scenario)
    agent = Agent(conn)

    if args.command == "run":
        session = agent.run(approve_cb=_ask_approval, page_text=meta["page"])
        last = session["timeline"][-1]
        print(f"\n{last.get('result', '—').upper()}: {last.get('text', '')}")
        return 0 if session["resolved"] else 1

    session = agent.run(approve_cb=lambda p: not args.decline, page_text=meta["page"])
    session.update({"id": args.scenario, "title": meta["title"], "tag": meta["tag"],
                    "recorded": "scenario-replay"})
    Path(args.out).write_text(json.dumps(session, indent=1, ensure_ascii=False))
    print(f"recorded → {args.out}  (resolved={session['resolved']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
