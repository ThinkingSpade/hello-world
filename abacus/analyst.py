"""The analyst brain — what separates Abacus from a lookup tool.

Three investigations a retrieval system fundamentally can't do, all pure
arithmetic over real query results (no model, deterministic, testable):

- investigate: "why did X change?" — decompose a period-over-period delta
  into per-dimension driver contributions (which partition exactly, and
  the tests prove it), plus a volume-vs-price split for revenue.
- retention: behavioral cohorts from first purchase date — the classic
  retention triangle.
- anomalies: z-scores on month-over-month changes across every
  metric × dimension series worth watching; |z| >= 2 gets flagged.
"""

from __future__ import annotations

import sqlite3
import statistics

from .engine import fmt, run_plan
from .semantics import DIMENSIONS, METRICS

DRIVER_DIMS = ["category", "region", "channel", "segment"]
ADDITIVE = {"revenue", "gross_margin", "orders", "units"}


# --------------------------------------------------------------- investigate
def _totals(conn, metric, time, filters):
    plan = {"metric": metric, "dims": [], "filters": filters, "time": time, "top": None}
    r = run_plan(conn, plan)
    return (r["rows"][0][-1] if r["rows"] else 0) or 0


def _by(conn, metric, dim, time, filters):
    plan = {"metric": metric, "dims": [dim], "filters": filters, "time": time, "top": None}
    return {row[0]: (row[-1] or 0) for row in run_plan(conn, plan)["rows"]}


def investigate(conn: sqlite3.Connection, plan: dict) -> dict:
    """Decompose metric change: plan.time vs plan.compare (required)."""
    metric = plan["metric"]
    cur_t, pri_t = plan["time"], plan["compare"]
    filters = plan.get("filters", [])
    queries = 0

    cur = _totals(conn, metric, cur_t, filters); queries += 1
    pri = _totals(conn, metric, pri_t, filters); queries += 1
    delta = cur - pri
    additive = metric in ADDITIVE

    drivers, by_dim = [], {}
    for dim in DRIVER_DIMS:
        a = _by(conn, metric, dim, cur_t, filters); queries += 1
        b = _by(conn, metric, dim, pri_t, filters); queries += 1
        rows = []
        for k in sorted(set(a) | set(b)):
            d = (a.get(k, 0) or 0) - (b.get(k, 0) or 0)
            rows.append({"value": k, "cur": a.get(k, 0), "prior": b.get(k, 0), "delta": d})
        by_dim[dim] = rows
        if additive:
            for r in rows:
                drivers.append({"dim": dim, "value": r["value"], "delta": r["delta"]})
    drivers.sort(key=lambda d: -abs(d["delta"]))
    top_drivers = drivers[:6]

    vol_price = None
    if metric == "revenue" and additive:
        o1 = _totals(conn, "orders", cur_t, filters); queries += 1
        o0 = _totals(conn, "orders", pri_t, filters); queries += 1
        a1 = cur / o1 if o1 else 0
        a0 = pri / o0 if o0 else 0
        vol = (o1 - o0) * a0
        price = o0 * (a1 - a0)
        vol_price = {"orders_cur": o1, "orders_prior": o0,
                     "aov_cur": a1, "aov_prior": a0,
                     "volume_effect": vol, "price_effect": price,
                     "interaction": delta - vol - price}

    # the waterfall dimension: whichever dimension owns the largest single swing
    water = None
    if additive and delta != 0 and top_drivers:
        wdim = top_drivers[0]["dim"]
        rows = sorted(by_dim[wdim], key=lambda r: -abs(r["delta"]))
        shown = rows[:6]
        other = delta - sum(r["delta"] for r in shown)
        water = {"dim": wdim, "start": pri, "end": cur,
                 "steps": [{"label": r["value"], "delta": r["delta"]} for r in shown]
                 + ([{"label": "everything else", "delta": other}]
                    if abs(other) > 1e-9 else [])}

    return {"kind": "investigate", "metric": metric, "cur": cur, "prior": pri,
            "delta": delta, "additive": additive, "drivers": top_drivers,
            "by_dim": by_dim, "vol_price": vol_price, "waterfall": water,
            "queries": queries}


def narrate_investigation(plan: dict, inv: dict) -> str:
    m = METRICS[plan["metric"]]
    kind = m["fmt"]
    pct = (100 * inv["delta"] / abs(inv["prior"])) if inv["prior"] else 0
    verb = "rose" if inv["delta"] > 0 else "fell"
    line = (f"{m['label']} {verb} {abs(pct):.1f}% in {plan['time']['label']} vs "
            f"{plan['compare']['label']} ({fmt(inv['prior'], kind)} → "
            f"{fmt(inv['cur'], kind)}, {'+' if inv['delta'] >= 0 else '−'}"
            f"{fmt(abs(inv['delta']), kind)}).")
    if inv["additive"] and inv["drivers"]:
        d0 = inv["drivers"][0]
        share = 100 * d0["delta"] / inv["delta"] if inv["delta"] else 0
        line += (f" The move concentrates in {d0['dim']}: {d0['value']} "
                 f"{'+' if d0['delta'] >= 0 else '−'}{fmt(abs(d0['delta']), kind)}"
                 f" ({share:.0f}% of the change)")
        offs = [d for d in inv["drivers"] if (d["delta"] > 0) != (inv["delta"] > 0)]
        if offs:
            o = offs[0]
            line += (f"; biggest offset {o['value']} "
                     f"{'+' if o['delta'] >= 0 else '−'}{fmt(abs(o['delta']), kind)}")
        line += "."
    vp = inv["vol_price"]
    if vp and inv["delta"]:
        vshare = 100 * vp["volume_effect"] / inv["delta"]
        pshare = 100 * vp["price_effect"] / inv["delta"]
        line += (f" Volume vs price: order count explains {vshare:.0f}% of it "
                 f"(orders {vp['orders_prior']:,} → {vp['orders_cur']:,}), "
                 f"basket size {pshare:.0f}% (AOV {fmt(vp['aov_prior'], 'money2')} → "
                 f"{fmt(vp['aov_cur'], 'money2')}).")
    if not inv["additive"]:
        line += (" (Rate metric — showing level shifts per dimension rather than "
                 "additive contributions.)")
    return line


# ----------------------------------------------------------------- retention
def retention(conn: sqlite3.Connection, unit: str = "quarter") -> dict:
    """Behavioral cohorts: quarter of first order × quarters since."""
    firsts = dict(conn.execute(
        "SELECT customer_id, first_order_date FROM dim_customer "
        "WHERE first_order_date IS NOT NULL").fetchall())
    qidx = lambda d: int(d[:4]) * 4 + (int(d[5:7]) + 2) // 3 - 1
    active = conn.execute(
        "SELECT DISTINCT customer_id, "
        " CAST(strftime('%Y', order_date) AS INTEGER) * 4 "
        " + (CAST(strftime('%m', order_date) AS INTEGER) + 2) / 3 - 1 "
        "FROM fact_orders").fetchall()

    cohorts: dict[int, set] = {}
    for cid, f in firsts.items():
        cohorts.setdefault(qidx(f), set()).add(cid)
    act_by_c: dict[int, set] = {}
    for cid, per in active:
        act_by_c.setdefault(per, set()).add(cid)

    qlabel = lambda i: f"{i // 4}-Q{i % 4 + 1}"
    keys = sorted(cohorts)
    maxper = max(act_by_c)
    matrix = []
    for c in keys:
        size = len(cohorts[c])
        row = {"cohort": qlabel(c), "size": size, "cells": []}
        k = 0
        while c + k <= maxper:
            hit = len(cohorts[c] & act_by_c.get(c + k, set()))
            row["cells"].append(round(100 * hit / size, 1) if size else 0)
            k += 1
        matrix.append(row)
    return {"kind": "retention", "matrix": matrix}


def narrate_retention(ret: dict) -> str:
    rows = [r for r in ret["matrix"] if len(r["cells"]) >= 2 and r["size"] >= 50]
    q1 = [r["cells"][1] for r in rows]
    if not q1:
        return "Cohort retention computed — matrix below."
    best = max(rows, key=lambda r: r["cells"][1])
    worst = min(rows, key=lambda r: r["cells"][1])
    return (f"Behavioral cohorts (quarter of first purchase): next-quarter "
            f"retention averages {sum(q1) / len(q1):.0f}% across {len(rows)} "
            f"cohorts — best {best['cohort']} at {best['cells'][1]:.0f}%, "
            f"softest {worst['cohort']} at {worst['cells'][1]:.0f}%. Every row "
            f"starts at 100% by construction (the first purchase defines the cohort).")


# ----------------------------------------------------------------- anomalies
WATCHLIST = [
    ("revenue", None, None),
    ("revenue", "category", None),
    ("revenue", "channel", None),
    ("aov", None, None),
    ("return_rate", None, None),
    ("discount_rate", None, None),
    ("new_customers", None, None),
]


def anomalies(conn: sqlite3.Connection, time: dict, z_floor: float = 2.0) -> dict:
    """z-scores on month-over-month % changes, per watched series."""
    flags, queries = [], 0
    for metric, dim, flt in WATCHLIST:
        dims = ["month"] if dim is None else ["month", dim]
        plan = {"metric": metric, "dims": dims, "filters": flt or [],
                "time": time, "top": None}
        rows = run_plan(conn, plan)["rows"]; queries += 1
        series: dict[str, list] = {}
        for r in rows:
            key = r[1] if dim else "overall"
            series.setdefault(key, []).append((r[0], r[-1] or 0))
        for key, pts in series.items():
            pts.sort()
            if len(pts) < 8:
                continue
            moms = []
            for i in range(1, len(pts)):
                prev = pts[i - 1][1]
                if prev:
                    moms.append((pts[i][0], 100 * (pts[i][1] - prev) / abs(prev),
                                 pts[i][1]))
            if len(moms) < 6:
                continue
            vals = [m[1] for m in moms]
            mu, sd = statistics.mean(vals), statistics.pstdev(vals)
            if not sd:
                continue
            for mi, (month, mom, level) in enumerate(moms):
                z = (mom - mu) / sd
                if abs(z) >= z_floor:
                    label = METRICS[metric]["label"] + (f" · {key}" if key != "overall" else "")
                    flags.append({"series": label, "metric": metric, "month": month,
                                  "mom_pct": round(mom, 1), "z": round(z, 2),
                                  "level": level, "idx": mi + 1,
                                  "points": [p[1] for p in pts]})
    flags.sort(key=lambda f: -abs(f["z"]))
    return {"kind": "anomalies", "flags": flags[:10], "queries": queries,
            "method": f"z-score on month-over-month changes, |z| ≥ {z_floor}",
            "window": time["label"]}


def narrate_anomalies(an: dict) -> str:
    if not an["flags"]:
        return (f"Scanned {an['queries']} series over {an['window']} — nothing "
                f"beats the {an['method']} bar. A quiet warehouse is a finding too.")
    f0 = an["flags"][0]
    return (f"Scanned {an['queries']} metric series over {an['window']} "
            f"({an['method']}): {len(an['flags'])} months flagged. Loudest: "
            f"{f0['series']} in {f0['month']}, {f0['mom_pct']:+.1f}% "
            f"month-over-month (z {f0['z']:+.1f}).")
