"""CLI: abacus build | ask | eval | export.

`export` freezes everything the browser needs: the warehouse file, the
semantic manifest, and goldens.json — the 30 questions with the Python
engine's plans, SQL, and results, which the browser engine must reproduce
exactly. The demo's "run the parity eval" button replays that file live.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from .engine import fmt, narrate, run_any, run_plan
from .generate import build, stats
from .goldens import GOLDENS, canonical_check
from .parser import parse
from .semantics import METRICS, manifest


def _conn(db: str | None) -> sqlite3.Connection:
    if db and Path(db).exists():
        return sqlite3.connect(db)
    return build(db or ":memory:")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="abacus", description="Abacus — a data analyst you can interrogate")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="generate the warehouse")
    b.add_argument("-o", "--out", default="warehouse.sqlite")

    a = sub.add_parser("ask", help="ask a question in plain English")
    a.add_argument("question", nargs="+")
    a.add_argument("--db", default=None)

    sub.add_parser("eval", help="run the 30-question golden eval")

    e = sub.add_parser("export", help="write the browser bundle (db + manifest + goldens)")
    e.add_argument("-o", "--out", default="abacus/ui/data")

    args = p.parse_args(argv)

    if args.cmd == "build":
        conn = build(args.out)
        print(f"built {args.out}: {stats(conn)}")
        return 0

    if args.cmd == "ask":
        conn = _conn(args.db)
        q = " ".join(args.question)
        try:
            plan = parse(q)
        except ValueError as err:
            print(f"couldn't parse that: {err}", file=sys.stderr)
            return 2
        print(f"plan     {json.dumps({k: v for k, v in plan.items() if v})}")
        if plan.get("kind", "aggregate") == "aggregate":
            r = run_plan(conn, plan)
            print("sql      " + r["sql"].replace("\n", "\n         "))
            kind = METRICS[plan["metric"]]["fmt"]
            for row in r["rows"][:12]:
                label = " · ".join(str(x) for x in row[:-1]) or plan["time"]["label"]
                print(f"  {label:<28} {fmt(row[-1], kind)}")
            if len(r["rows"]) > 12:
                print(f"  … {len(r['rows']) - 12} more rows")
            print("\n" + narrate(plan, r))
        else:
            res, story = run_any(conn, plan)
            for row in canonical_check(plan, res)[:12]:
                print("  " + " · ".join(str(x) for x in row))
            print("\n" + story)
        return 0

    if args.cmd == "eval":
        conn = build()
        ok = 0
        for q, exp in GOLDENS:
            plan = parse(q)
            kind = exp.get("kind", "aggregate")
            good = (plan.get("kind", "aggregate") == kind
                    and plan["time"]["label"] == exp["time_label"]
                    and (plan.get("compare") is not None) == exp.get("compare", False))
            if kind == "aggregate":
                good = good and (plan["metric"] == exp["metric"]
                                 and plan["dims"] == exp.get("dims", [])
                                 and plan.get("top") == exp.get("top")
                                 and plan.get("filters", []) == exp.get("filters", []))
            elif kind == "investigate":
                good = good and plan["metric"] == exp["metric"]
            check = canonical_check(plan, run_any(conn, plan)[0]) if good else []
            ok += bool(good and check)
            print(("PASS " if good and check else "FAIL ") + q)
        print(f"\n{ok}/{len(GOLDENS)}")
        return 0 if ok == len(GOLDENS) else 1

    if args.cmd == "export":
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "warehouse.sqlite").unlink(missing_ok=True)   # rebuild from seed
        conn = build(str(out / "warehouse.sqlite"))
        st = stats(conn)
        cases = []
        for q, _exp in GOLDENS:
            plan = parse(q)
            res, story = run_any(conn, plan)
            kind = plan.get("kind", "aggregate")
            sql = (res["sql"] if kind == "aggregate" else
                   f"-- {res.get('queries', '?')} compiled queries (kind: {kind})")
            case = {"q": q, "plan": plan, "sql": sql,
                    "rows": canonical_check(plan, res), "narration": story}
            if kind == "aggregate" and "prior" in res:
                case["prior_value"] = res["prior"]["value"]
            cases.append(case)
        (out / "goldens.json").write_text(json.dumps(cases))
        (out / "manifest.json").write_text(json.dumps({**manifest(), "stats": {
            "orders": st["orders"], "items": st["items"],
            "customers": st["customers"], "products": st["products"],
            "rows_total": st["orders"] + st["items"] + st["customers"] + st["products"],
        }}))
        print(f"exported → {out}  ({st['orders']:,} orders, "
              f"{st['items']:,} items, goldens: {len(cases)})")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
