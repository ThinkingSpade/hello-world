"""The deterministic question parser: plain English -> plan dict.

No model, no magic — longest-synonym matching against the semantic layer,
a small time grammar, and value spotting for filters. The browser engine
ports this logic verbatim (same manifest, same precedence rules), and the
golden eval suite pins the two implementations together.

Plan shape (also what the LLM planner must emit in BYO-key mode):
    {"metric": "revenue", "dims": ["region"], "filters": [{"dim","value"}],
     "time": {"start","end","label"}, "top": None|int,
     "compare": None|{"start","end","label"}}
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from .semantics import DIMENSIONS, METRICS, TODAY, VALUES

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}


def _q_bounds(y: int, q: int) -> tuple[str, str]:
    sm = 3 * (q - 1) + 1
    em = sm + 2
    last = (date(y + (em == 12), (em % 12) + 1, 1) - timedelta(days=1)).day
    return f"{y}-{sm:02d}-01", f"{y}-{em:02d}-{last:02d}"


def _m_bounds(y: int, m: int) -> tuple[str, str]:
    last = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
    return f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}"


def _shift_year(t: dict) -> dict:
    s, e = t["start"], t["end"]
    return {"start": str(int(s[:4]) - 1) + s[4:], "end": str(int(e[:4]) - 1) + e[4:],
            "label": "same period, prior year"}


def _prev_period(t: dict) -> dict:
    s = date(*map(int, t["start"].split("-")))
    e = date(*map(int, t["end"].split("-")))
    n = (e - s).days + 1
    return {"start": str(s - timedelta(days=n)), "end": str(s - timedelta(days=1)),
            "label": "previous period"}


# phrases that are ABOUT time — stripped before dimension/filter scanning so
# "last month" can't summon the month dimension
_CMP_RE = (r"\bvs\.?\s+(?:the\s+)?(?:last|prior|previous)\s+"
           r"(?:year|quarter|month|period)\b|\byoy\b|\byear over year\b")
_TIME_STRIP = [
    _CMP_RE,
    r"\bq[1-4]\s*20\d\d\b",
    r"\b(?:" + "|".join(MONTHS) + r")\s*(?:20\d\d)?\b",
    r"\blast quarter\b", r"\bthis quarter\b",
    r"\blast \d+ months?\b", r"\blast month\b",
    r"\bytd\b", r"\byear to date\b", r"\bthis year\b", r"\blast year\b",
    r"\b20\d\d\b",
]


def strip_time(q: str) -> str:
    for pat in _TIME_STRIP:
        q = re.sub(pat, " ", q)
    return q


def parse_time(q: str) -> tuple[dict, dict | None]:
    """Returns (time, compare|None). Warehouse clock pinned to TODAY."""
    today = date(*map(int, TODAY.split("-")))
    cur_q = (today.month + 2) // 3
    t = None

    # the compare clause is parsed first and removed, so "vs last quarter"
    # can't be mistaken for the question's own time window
    wants_yoy = bool(re.search(r"\bvs\.?\s+(?:the\s+)?(?:last|prior|previous) year\b"
                               r"|\byoy\b|\byear over year\b", q))
    wants_prev = bool(re.search(r"\bvs\.?\s+(?:the\s+)?(?:last|prior|previous) "
                                r"(?:quarter|month|period)\b", q))
    q = re.sub(_CMP_RE, " ", q)

    m = re.search(r"\bq([1-4])\s*(20\d\d)\b", q)
    if m:
        s, e = _q_bounds(int(m.group(2)), int(m.group(1)))
        t = {"start": s, "end": e, "label": f"Q{m.group(1)} {m.group(2)}"}
    if not t:
        m = re.search(r"\b(" + "|".join(MONTHS) + r")\s*(20\d\d)?\b", q)
        if m:
            y = int(m.group(2)) if m.group(2) else (today.year if MONTHS[m.group(1)] <= today.month else today.year - 1)
            s, e = _m_bounds(y, MONTHS[m.group(1)])
            t = {"start": s, "end": e, "label": f"{m.group(1).title()} {y}"}
    if not t and re.search(r"\blast quarter\b", q):
        y, qq = (today.year, cur_q - 1) if cur_q > 1 else (today.year - 1, 4)
        s, e = _q_bounds(y, qq)
        t = {"start": s, "end": e, "label": f"Q{qq} {y} (last quarter)"}
    if not t and re.search(r"\bthis quarter\b", q):
        s, e = _q_bounds(today.year, cur_q)
        t = {"start": s, "end": min(e, str(today)), "label": f"Q{cur_q} {today.year} (this quarter)"}
    if not t and re.search(r"\blast (\d+) months?\b", q):
        n = int(re.search(r"\blast (\d+) months?\b", q).group(1))
        anchor = date(today.year, today.month, 1)
        for _ in range(n - 1):
            anchor = (anchor - timedelta(days=1)).replace(day=1)
        t = {"start": str(anchor), "end": str(today), "label": f"last {n} months"}
    if not t and re.search(r"\blast month\b", q):
        anchor = (date(today.year, today.month, 1) - timedelta(days=1))
        s, e = _m_bounds(anchor.year, anchor.month)
        t = {"start": s, "end": e, "label": f"{anchor.strftime('%B')} {anchor.year} (last month)"}
    if not t and re.search(r"\bytd\b|\byear to date\b|\bthis year\b", q):
        t = {"start": f"{today.year}-01-01", "end": str(today), "label": f"{today.year} YTD"}
    if not t and re.search(r"\blast year\b", q) and not re.search(r"\bvs\.?\s+last year\b", q):
        t = {"start": f"{today.year - 1}-01-01", "end": f"{today.year - 1}-12-31",
             "label": str(today.year - 1)}
    if not t:
        m = re.search(r"\b(?:in|for|during)?\s*(20\d\d)\b", q)
        if m:
            y = m.group(1)
            t = {"start": f"{y}-01-01", "end": f"{y}-12-31", "label": y}
    if not t:
        t = {"start": "2024-01-01", "end": TODAY, "label": "all time (2024 → today)"}

    compare = _shift_year(t) if wants_yoy else _prev_period(t) if wants_prev else None
    return t, compare


def _find(q: str, table: dict) -> list[tuple[str, int, int]]:
    """All (key, pos, length) synonym hits, longest synonyms first."""
    hits = []
    for key, spec in table.items():
        for syn in sorted(spec["syn"], key=len, reverse=True):
            m = re.search(rf"(?<![a-z]){re.escape(syn)}(?![a-z])", q)
            if m:
                hits.append((key, m.start(), len(syn)))
                break
    return hits


INVESTIGATE_RE = (r"^why\b|\bwhy did\b|\bwhy is\b|\bwhat (?:drove|caused)\b|"
                  r"\bexplain the (?:change|drop|dip|spike|jump|move)\b")
RETENTION_RE = r"\bretention\b|\bcohorts?\b"
ANOMALY_RE = r"\banomal|\boutlier|\bunusual\b|\bweird\b|\bscan\b|\bwhat changed\b"


def parse(question: str) -> dict:
    q = question.lower().strip()
    time, compare = parse_time(q)

    # ---- analyst kinds outrank plain aggregation ----
    if re.search(RETENTION_RE, q):
        return {"kind": "retention", "metric": None, "dims": [], "filters": [],
                "time": time, "top": None, "compare": None}
    if re.search(ANOMALY_RE, q):
        return {"kind": "anomalies", "metric": None, "dims": [], "filters": [],
                "time": time, "top": None, "compare": None}
    if re.search(INVESTIGATE_RE, q):
        mh = _find(q, METRICS)
        mh.sort(key=lambda h: (-h[2], h[1]))
        metric = mh[0][0] if mh else "revenue"
        qd0 = strip_time(q)
        filters = []
        for dim, vals in VALUES.items():
            for v in vals:
                if re.search(rf"(?<![a-z]){re.escape(v.lower())}(?![a-z])", qd0):
                    filters.append({"dim": dim, "value": v})
        if compare is None:
            compare = _prev_period(time)      # "why" always needs a baseline
        return {"kind": "investigate", "metric": metric, "dims": [],
                "filters": filters, "time": time, "top": None, "compare": compare}

    # metric: longest synonym match wins; position breaks ties
    mhits = _find(q, METRICS)
    if not mhits:
        known = sorted({s for m in METRICS.values() for s in m["syn"][:2]})
        raise ValueError("no metric recognized — try one of: " + ", ".join(known))
    mhits.sort(key=lambda h: (-h[2], h[1]))
    metric = mhits[0][0]

    # dims: scan with time phrases stripped, so "last month" isn't a group-by
    qd = strip_time(q)
    dims = []
    for key, pos, _ln in sorted(_find(qd, DIMENSIONS), key=lambda h: h[1]):
        spec = DIMENSIONS[key]
        syn_hit = next(s for s in sorted(spec["syn"], key=len, reverse=True)
                       if re.search(rf"(?<![a-z]){re.escape(s)}(?![a-z])", qd))
        before = qd[max(0, pos - 12):pos]
        if re.search(r"\bby\s+$|\bper\s+$|\bacross\s+$|\btop\s+\d+\s*$", before) \
                or spec.get("time") or syn_hit.startswith("by ") \
                or spec.get("top_default"):
            if key not in dims:
                dims.append(key)

    # filters: any known value name in the question (skip dims already grouped)
    filters = []
    for dim, vals in VALUES.items():
        for v in vals:
            if re.search(rf"(?<![a-z]){re.escape(v.lower())}(?![a-z])", qd):
                if dim not in dims:
                    filters.append({"dim": dim, "value": v})

    top = None
    m = re.search(r"\btop\s+(\d+)\b", qd)
    if m:
        top = int(m.group(1))
        if not dims:
            dims.append("product")   # "top 5" with no dim means products

    if len(dims) > 2:
        dims = dims[:2]
    if compare and any(not DIMENSIONS[d].get("time") for d in dims):
        compare = None               # compare only for totals / time series

    return {"kind": "aggregate", "metric": metric, "dims": dims, "filters": filters,
            "time": time, "top": top, "compare": compare}
