"""Compose the morning brief from fetched numbers — templates plus
arithmetic, fully deterministic. Every sentence traces to a number that
came off a wire; a down wire gets reported as down, never papered over.
The browser demo ships this same logic in JS; this module is the CLI/test
ground truth for the math.
"""

from __future__ import annotations


def fx_stats(fx: dict) -> dict:
    """Percent change of USD against each currency over the window.
    rate = units of currency per 1 USD, so rate up = dollar stronger."""
    out = {}
    for sym, vals in fx["series"].items():
        pts = [v for v in vals if v is not None]
        if len(pts) < 2:
            continue
        out[sym] = round(100 * (pts[-1] - pts[0]) / pts[0], 2)
    strongest = max(out, key=out.get)
    weakest = min(out, key=out.get)
    return {"moves": out, "strongest": strongest, "weakest": weakest,
            "window": (fx["dates"][0], fx["dates"][-1])}


def debt_stats(rows: list[dict], population: float | None = None) -> dict:
    first, last = rows[0], rows[-1]
    days = max(1, _days_between(first["date"], last["date"]))
    delta = last["total"] - first["total"]
    per_second = delta / (days * 86400)
    out = {
        "latest": last["total"], "as_of": last["date"],
        "delta": delta, "window_days": days,
        "per_second": round(per_second, 2),
        "per_day": round(delta / days, 2),
    }
    if population:
        out["per_capita"] = round(last["total"] / population, 2)
    return out


def _days_between(a: str, b: str) -> int:
    from datetime import date
    ya, ma, da = map(int, a.split("-"))
    yb, mb, db = map(int, b.split("-"))
    return (date(yb, mb, db) - date(ya, ma, da)).days


def _money(x: float) -> str:
    if abs(x) >= 1e12:
        return f"${x / 1e12:,.2f} trillion"
    if abs(x) >= 1e9:
        return f"${x / 1e9:,.1f} billion"
    if abs(x) >= 1e6:
        return f"${x / 1e6:,.1f} million"
    return f"${x:,.0f}"


def compose(data: dict) -> list[str]:
    """The brief, one line per wire. Reads like a colleague, adds up like
    an accountant."""
    lines = []

    fx = data.get("fx")
    if fx and "error" not in fx:
        s = fx_stats(fx)
        mv = s["moves"]
        a, b = s["window"]
        lines.append(
            f"FX, {a} → {b} (ECB reference): the dollar gained most against "
            f"{s['strongest']} ({mv[s['strongest']]:+.1f}%) and did worst against "
            f"{s['weakest']} ({mv[s['weakest']]:+.1f}%). Full board: "
            + ", ".join(f"{k} {v:+.1f}%" for k, v in sorted(mv.items())) + ".")
    else:
        lines.append("FX wire is down — no exchange-rate read this morning.")

    debt = data.get("debt")
    if isinstance(debt, list):
        pop = None
        p = data.get("pop")
        if p and "error" not in p:
            pop = next(iter(p.values()))["value"]
        d = debt_stats(debt, population=pop)
        line = (f"US federal debt: {_money(d['latest'])} as of {d['as_of']} — up "
                f"{_money(d['delta'])} over the window, about "
                f"{_money(d['per_day'])} a day (≈ ${d['per_second']:,.0f} every second).")
        if "per_capita" in d:
            year = next(iter(p.values()))["year"]
            line += (f" That's {_money(d['per_capita'])} per US resident "
                     f"(World Bank population, {year}).")
        lines.append(line)
    else:
        lines.append("Treasury wire is down — no debt read this morning.")

    gdp, cpi = data.get("gdp"), data.get("cpi")
    if gdp and "error" not in gdp:
        year = next(iter(gdp.values()))["year"]
        gl = ", ".join(f"{c} {v['value']:+.1f}%" for c, v in gdp.items())
        line = f"Growth (World Bank annuals, {year}): {gl}."
        if cpi and "error" not in cpi:
            cl = ", ".join(f"{c} {v['value']:.1f}%" for c, v in cpi.items())
            line += f" Inflation: {cl}."
        lines.append(line)
    else:
        lines.append("World Bank wire is down — no growth/inflation read.")

    up = sum(1 for k in ("fx", "debt", "gdp") if k in data
             and not (isinstance(data[k], dict) and "error" in data[k]))
    lines.append(f"Wire check: {up} of 3 sources answering. Every number above "
                 f"came off a public feed this run — nothing cached, nothing typed in.")
    return lines
