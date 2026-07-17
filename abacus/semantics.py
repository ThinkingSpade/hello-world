"""The semantic layer: every metric and dimension Abacus knows, defined
once as data. Both engines — this Python one and the browser's JS port —
compile questions against this exact manifest, so parity is by
construction, and the LLM planner (bring-your-own-key mode) is only ever
allowed to pick from these keys. Nobody, human or model, writes raw SQL
into the warehouse.
"""

from __future__ import annotations

TODAY = "2026-06-30"

# Base relation: order items joined to orders. Product / customer joins are
# pulled in only when something referenced needs them.
BASE = "FROM fact_order_items i JOIN fact_orders o ON i.order_id = o.order_id"
JOINS = {
    "p": "JOIN dim_product p ON i.product_id = p.product_id",
    "c": "JOIN dim_customer c ON o.customer_id = c.customer_id",
}

METRICS = {
    "revenue": {
        "label": "Net revenue", "fmt": "money",
        "syn": ["revenue", "sales", "net revenue", "gmv", "turnover"],
        "sql": "SUM(i.net_revenue)"},
    "gross_margin": {
        "label": "Gross margin", "fmt": "money",
        "syn": ["gross margin", "margin dollars", "profit", "gross profit"],
        "sql": "SUM(i.net_revenue - i.total_cost)"},
    "margin_pct": {
        "label": "Gross margin %", "fmt": "pct",
        "syn": ["margin %", "margin rate", "margin percent", "profitability",
                "margin percentage", "gross margin %", "margin"],
        "sql": "100.0 * SUM(i.net_revenue - i.total_cost) / NULLIF(SUM(i.net_revenue), 0)"},
    "orders": {
        "label": "Orders", "fmt": "int",
        "syn": ["orders", "order count", "number of orders", "order volume"],
        "sql": "COUNT(DISTINCT i.order_id)"},
    "units": {
        "label": "Units sold", "fmt": "int",
        "syn": ["units", "quantity", "items sold", "units sold"],
        "sql": "SUM(i.qty)"},
    "aov": {
        "label": "Average order value", "fmt": "money2",
        "syn": ["aov", "average order value", "avg order value", "basket size"],
        "sql": "SUM(i.net_revenue) / NULLIF(COUNT(DISTINCT i.order_id), 0)"},
    "customers": {
        "label": "Active customers", "fmt": "int",
        "syn": ["customers", "buyers", "active customers", "unique customers"],
        "sql": "COUNT(DISTINCT o.customer_id)"},
    "new_customers": {
        "label": "New customers", "fmt": "int",
        "syn": ["new customers", "first-time buyers", "acquisitions",
                "customer acquisition"],
        "sql": ("COUNT(DISTINCT CASE WHEN c.first_order_date >= '{start}' "
                "AND c.first_order_date <= '{end}' THEN o.customer_id END)")},
    "discount_rate": {
        "label": "Discount rate", "fmt": "pct",
        "syn": ["discount rate", "discounting", "avg discount", "discount %",
                "promo rate", "discounts"],
        "sql": "100.0 * SUM(i.discount_amt) / NULLIF(SUM(i.gross_revenue), 0)"},
    "return_rate": {
        "label": "Return rate (units)", "fmt": "pct",
        "syn": ["return rate", "returns", "refund rate", "returned"],
        "sql": ("100.0 * SUM(CASE WHEN i.returned = 1 THEN i.qty ELSE 0 END) "
                "/ NULLIF(SUM(i.qty), 0)")},
    "rev_per_customer": {
        "label": "Revenue per customer", "fmt": "money2",
        "syn": ["revenue per customer", "spend per customer", "arpu",
                "average spend per customer"],
        "sql": "SUM(i.net_revenue) / NULLIF(COUNT(DISTINCT o.customer_id), 0)"},
}

DIMENSIONS = {
    "category": {"label": "category", "sql": "p.category",
                 "syn": ["category", "categories", "product category",
                         "product categories", "by product type"]},
    "region": {"label": "region", "sql": "c.region",
               "syn": ["region", "regions", "by geography", "geographies"]},
    "channel": {"label": "channel", "sql": "o.channel",
                "syn": ["channel", "channels", "sales channel"]},
    "segment": {"label": "segment", "sql": "c.segment",
                "syn": ["segment", "segments", "customer segment", "tier",
                        "customer type"]},
    "product": {"label": "product", "sql": "p.product_name", "top_default": 10,
                "syn": ["product", "products", "sku", "skus", "item", "best sellers",
                        "bestsellers", "sellers"]},
    "month": {"label": "month", "sql": "strftime('%Y-%m', o.order_date)", "time": True,
              "syn": ["month", "monthly", "by month", "over time", "trend",
                      "trended", "per month", "monthly trend"]},
    "quarter": {"label": "quarter", "time": True,
                "sql": ("strftime('%Y', o.order_date) || '-Q' || "
                        "((CAST(strftime('%m', o.order_date) AS INTEGER) + 2) / 3)"),
                "syn": ["by quarter", "quarterly", "per quarter"]},
    "year": {"label": "year", "sql": "strftime('%Y', o.order_date)", "time": True,
             "syn": ["by year", "yearly", "annually", "per year"]},
}

# filterable values (also exported so the parser can spot them in questions)
VALUES = {
    "category": ["Electronics", "Home", "Apparel", "Beauty", "Outdoors", "Grocery"],
    "region": ["West", "South", "Midwest", "Northeast"],
    "channel": ["web", "mobile", "store"],
    "segment": ["consumer", "business", "vip"],
}


def manifest() -> dict:
    """The JSON contract shared with the browser engine and the LLM planner."""
    return {"today": TODAY, "metrics": METRICS, "dimensions": DIMENSIONS,
            "values": VALUES}


def _needs(alias: str, *chunks: str) -> bool:
    return any(f"{alias}." in c for c in chunks if c)


def compile_plan(plan: dict) -> str:
    """plan -> a single SQL statement. The only SQL author in the system."""
    metric = METRICS[plan["metric"]]
    dims = [DIMENSIONS[d] for d in plan.get("dims", [])]
    filters = plan.get("filters", [])
    start, end = plan["time"]["start"], plan["time"]["end"]

    msql = metric["sql"].replace("{start}", start).replace("{end}", end)
    dsqls = [d["sql"] for d in dims]
    fsqls = [f"{DIMENSIONS[f['dim']]['sql']} = '{f['value']}'" for f in filters]
    if plan["metric"] == "new_customers":
        fsqls_all = fsqls + ["c.customer_id IS NOT NULL"]
    else:
        fsqls_all = fsqls

    chunks = [msql] + dsqls + fsqls
    joins = "".join(
        " " + JOINS[a] for a in ("p", "c") if _needs(a, *chunks))

    sel = [f"{d['sql']} AS {name}" for d, name in zip(dims, plan.get("dims", []))]
    sel.append(f"{msql} AS value")
    where = [f"o.order_date >= '{start}'", f"o.order_date <= '{end}'"] + fsqls_all

    sql = f"SELECT {', '.join(sel)}\n{BASE}{joins}\nWHERE {' AND '.join(where)}"
    if dims:
        sql += f"\nGROUP BY {', '.join(str(i + 1) for i in range(len(dims)))}"
        time_dim = any(d.get("time") for d in dims)
        sql += "\nORDER BY 1" if time_dim else f"\nORDER BY value DESC"
    top = plan.get("top")
    if not top and dims and any(d.get("top_default") for d in dims):
        top = max(d.get("top_default", 0) for d in dims)
    if top and dims:
        sql += f"\nLIMIT {int(top)}"
    return sql
