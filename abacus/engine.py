"""Run a plan against the warehouse and narrate the answer.
Narration is templates + arithmetic over the actual result rows — the
same lines the browser types out, so the CLI is the ground truth."""

from __future__ import annotations

import sqlite3

from .semantics import DIMENSIONS, METRICS, compile_plan


def fmt(v, kind: str) -> str:
    if v is None:
        return "—"
    if kind == "money":
        if abs(v) >= 1e6:
            return f"${v / 1e6:,.2f}M"
        if abs(v) >= 1e3:
            return f"${v / 1e3:,.1f}K"
        return f"${v:,.0f}"
    if kind == "money2":
        return f"${v:,.2f}"
    if kind == "pct":
        return f"{v:,.1f}%"
    return f"{v:,.0f}"


def run_any(conn: sqlite3.Connection, plan: dict) -> tuple[dict, str]:
    """Dispatch on plan kind → (result, narration). Aggregates go through
    the compiler; the analyst kinds live in abacus.analyst."""
    kind = plan.get("kind", "aggregate")
    if kind == "aggregate":
        r = run_plan(conn, plan)
        return r, narrate(plan, r)
    from . import analyst
    if kind == "investigate":
        inv = analyst.investigate(conn, plan)
        return inv, analyst.narrate_investigation(plan, inv)
    if kind == "retention":
        ret = analyst.retention(conn)
        return ret, analyst.narrate_retention(ret)
    if kind == "anomalies":
        an = analyst.anomalies(conn, plan["time"])
        return an, analyst.narrate_anomalies(an)
    raise ValueError(f"unknown plan kind {kind!r}")


def run_plan(conn: sqlite3.Connection, plan: dict) -> dict:
    sql = compile_plan(plan)
    cur = conn.execute(sql)
    cols = [d[0] for d in cur.description]
    rows = [list(r) for r in cur.fetchall()]
    out = {"sql": sql, "columns": cols, "rows": rows}
    if plan.get("compare"):
        prior = dict(plan, time=plan["compare"], compare=None)
        psql = compile_plan(prior)
        prow = conn.execute(psql).fetchone()
        out["prior"] = {"sql": psql, "value": prow[-1] if prow else None}
    return out


def narrate(plan: dict, result: dict) -> str:
    m = METRICS[plan["metric"]]
    label, kind = m["label"], m["fmt"]
    t = plan["time"]["label"]
    rows = result["rows"]
    where = "".join(f" · {f['value']}" for f in plan.get("filters", []))

    if not plan["dims"]:
        v = rows[0][-1] if rows else None
        line = f"{label}{where}, {t}: {fmt(v, kind)}."
        prior = result.get("prior")
        if prior and prior["value"] not in (None, 0) and v is not None:
            d = 100 * (v - prior["value"]) / abs(prior["value"])
            line += (f" That's {d:+.1f}% vs {plan['compare']['label']} "
                     f"({fmt(prior['value'], kind)}).")
        return line

    if not rows:
        return f"{label}{where}, {t}: no rows matched."

    dim0 = plan["dims"][0]
    if DIMENSIONS[dim0].get("time"):
        vals = [r[-1] for r in rows if r[-1] is not None]
        total = sum(vals)
        peak = max(rows, key=lambda r: r[-1] or 0)
        chg = (100 * (rows[-1][-1] - rows[0][-1]) / abs(rows[0][-1])
               if rows[0][-1] not in (None, 0) else 0)
        agg = fmt(total, kind) if kind in ("money", "int") else fmt(sum(vals) / len(vals), kind)
        aggword = "total" if kind in ("money", "int") else "average"
        return (f"{label}{where} by {dim0}, {t}: {aggword} {agg} across "
                f"{len(rows)} {dim0}s — peak {peak[0]} at {fmt(peak[-1], kind)}, "
                f"{chg:+.1f}% first-to-last.")

    top = rows[0]
    line = f"{label}{where} by {dim0}, {t}: {top[0]} leads at {fmt(top[-1], kind)}"
    if len(rows) > 1:
        tail = rows[-1]
        line += f"; {tail[0]} trails at {fmt(tail[-1], kind)}"
    if kind in ("money", "int"):
        total = sum(r[-1] for r in rows if r[-1] is not None)
        if total:
            line += f" ({100 * top[-1] / total:.0f}% of the shown total)"
    return line + "."
