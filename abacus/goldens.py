"""The golden eval set: 30 questions with their expected plans. Pytest
runs them against the Python engine; `abacus export` freezes questions,
plans, SQL, and result rows to goldens.json; the browser engine replays
all 30 and must match plans exactly and values to the cent — that's the
Python↔JS parity harness, and the demo page lets visitors run it live.
"""

GOLDENS = [
    ("revenue by region last quarter",
     {"metric": "revenue", "dims": ["region"], "time_label": "Q1 2026 (last quarter)"}),
    ("gross margin by category in 2025",
     {"metric": "gross_margin", "dims": ["category"], "time_label": "2025"}),
    ("margin % by category in 2025",
     {"metric": "margin_pct", "dims": ["category"], "time_label": "2025"}),
    ("revenue by month in 2025",
     {"metric": "revenue", "dims": ["month"], "time_label": "2025"}),
    ("monthly revenue",
     {"metric": "revenue", "dims": ["month"], "time_label": "all time (2024 → today)"}),
    ("aov by channel ytd",
     {"metric": "aov", "dims": ["channel"], "time_label": "2026 YTD"}),
    ("orders by channel in q4 2025",
     {"metric": "orders", "dims": ["channel"], "time_label": "Q4 2025"}),
    ("top 5 products by revenue last quarter",
     {"metric": "revenue", "dims": ["product"], "top": 5,
      "time_label": "Q1 2026 (last quarter)"}),
    ("top 10 products by units in 2025",
     {"metric": "units", "dims": ["product"], "top": 10, "time_label": "2025"}),
    ("revenue in q2 2026",
     {"metric": "revenue", "dims": [], "time_label": "Q2 2026"}),
    ("revenue this quarter vs last quarter",
     {"metric": "revenue", "dims": [], "compare": True,
      "time_label": "Q2 2026 (this quarter)"}),
    ("revenue ytd vs last year",
     {"metric": "revenue", "dims": [], "compare": True, "time_label": "2026 YTD"}),
    ("aov in 2025 vs prior year",
     {"metric": "aov", "dims": [], "compare": True, "time_label": "2025"}),
    ("return rate by category in 2025",
     {"metric": "return_rate", "dims": ["category"], "time_label": "2025"}),
    ("discount rate by month in 2025",
     {"metric": "discount_rate", "dims": ["month"], "time_label": "2025"}),
    ("new customers by month in 2026",
     {"metric": "new_customers", "dims": ["month"], "time_label": "2026"}),
    ("customers by segment last quarter",
     {"metric": "customers", "dims": ["segment"], "time_label": "Q1 2026 (last quarter)"}),
    ("revenue per customer by segment in 2025",
     {"metric": "rev_per_customer", "dims": ["segment"], "time_label": "2025"}),
    ("electronics revenue by month in 2025",
     {"metric": "revenue", "dims": ["month"],
      "filters": [{"dim": "category", "value": "Electronics"}], "time_label": "2025"}),
    ("revenue in the west by channel in 2025",
     {"metric": "revenue", "dims": ["channel"],
      "filters": [{"dim": "region", "value": "West"}], "time_label": "2025"}),
    ("mobile revenue by month in 2026",
     {"metric": "revenue", "dims": ["month"],
      "filters": [{"dim": "channel", "value": "mobile"}], "time_label": "2026"}),
    ("vip aov last quarter",
     {"metric": "aov", "dims": [],
      "filters": [{"dim": "segment", "value": "vip"}],
      "time_label": "Q1 2026 (last quarter)"}),
    ("units by category last month",
     {"metric": "units", "dims": ["category"], "time_label": "May 2026 (last month)"}),
    ("orders in november 2025",
     {"metric": "orders", "dims": [], "time_label": "November 2025"}),
    ("margin % by channel last 6 months",
     {"metric": "margin_pct", "dims": ["channel"], "time_label": "last 6 months"}),
    ("gross margin by quarter",
     {"metric": "gross_margin", "dims": ["quarter"],
      "time_label": "all time (2024 → today)"}),
    ("revenue by year",
     {"metric": "revenue", "dims": ["year"], "time_label": "all time (2024 → today)"}),
    ("top 3 categories by gross margin ytd",
     {"metric": "gross_margin", "dims": ["category"], "top": 3,
      "time_label": "2026 YTD"}),
    ("return rate for electronics in 2025 vs prior year",
     {"metric": "return_rate", "dims": [], "compare": True,
      "filters": [{"dim": "category", "value": "Electronics"}], "time_label": "2025"}),
    ("best sellers by revenue in june 2026",
     {"metric": "revenue", "dims": ["product"], "time_label": "June 2026"}),
    # ---- analyst kinds: investigations a lookup tool can't do ----
    ("why did revenue jump in q4 2025 vs the previous quarter",
     {"kind": "investigate", "metric": "revenue", "time_label": "Q4 2025",
      "compare": True}),
    ("why did revenue dip in july 2025",
     {"kind": "investigate", "metric": "revenue", "time_label": "July 2025",
      "compare": True}),
    ("what drove gross margin last quarter",
     {"kind": "investigate", "metric": "gross_margin",
      "time_label": "Q1 2026 (last quarter)", "compare": True}),
    ("retention by signup cohort",
     {"kind": "retention", "time_label": "all time (2024 \u2192 today)"}),
    ("scan 2025 for anomalies",
     {"kind": "anomalies", "time_label": "2025"}),
]


def canonical_check(plan: dict, result: dict) -> list:
    """A kind-independent, numerically comparable fingerprint of a result —
    what the browser engine must reproduce for parity."""
    kind = plan.get("kind", "aggregate")
    if kind == "aggregate":
        return result["rows"]
    if kind == "investigate":
        out = [["_total", round(result["cur"], 4), round(result["prior"], 4)]]
        out += [[d["dim"], d["value"], round(d["delta"], 4)]
                for d in result["drivers"]]
        return out
    if kind == "retention":
        return [[r["cohort"], r["size"], *r["cells"]] for r in result["matrix"]]
    if kind == "anomalies":
        return [[f["series"], f["month"], f["z"]] for f in result["flags"]]
    raise ValueError(kind)
