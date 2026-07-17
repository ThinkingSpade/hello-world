"""The pipeline: three SQL tasks and their data-quality checks, executed
for real on SQLite. The runner halts on the first failed task or check —
that halt is the incident the agent gets paged for.
"""

from __future__ import annotations

import copy
import sqlite3

PIPELINE = {
    "name": "nightly-revenue",
    "tasks": [
        {
            "id": "stg_customers",
            "sql": ("DROP TABLE IF EXISTS stg_customers;\n"
                    "CREATE TABLE stg_customers AS\n"
                    "SELECT customer_id, region, signup_date\n"
                    "FROM customers_raw;"),
            "checks": [
                {"type": "row_count_min", "table": "stg_customers", "min": 500},
                {"type": "unique", "table": "stg_customers", "column": "customer_id"},
            ],
        },
        {
            "id": "stg_orders",
            "sql": ("DROP TABLE IF EXISTS stg_orders;\n"
                    "CREATE TABLE stg_orders AS\n"
                    "SELECT o.order_id,\n"
                    "       o.customer_id,\n"
                    "       o.order_ts,\n"
                    "       o.order_total AS order_total,\n"
                    "       o.status\n"
                    "FROM orders_raw o\n"
                    "WHERE o.status != 'cancelled';"),
            "checks": [
                {"type": "unique", "table": "stg_orders", "column": "order_id"},
                {"type": "not_null", "table": "stg_orders", "column": "order_total"},
            ],
        },
        {
            "id": "fct_daily_revenue",
            "sql": ("DROP TABLE IF EXISTS fct_daily_revenue;\n"
                    "CREATE TABLE fct_daily_revenue AS\n"
                    "SELECT date(o.order_ts) AS day,\n"
                    "       c.region AS region,\n"
                    "       COUNT(*) AS orders,\n"
                    "       ROUND(SUM(o.order_total), 2) AS revenue\n"
                    "FROM stg_orders o\n"
                    "LEFT JOIN stg_customers c ON o.customer_id = c.customer_id\n"
                    "GROUP BY 1, 2;"),
            "checks": [
                {"type": "not_null", "table": "fct_daily_revenue", "column": "region"},
                {"type": "row_count_min", "table": "fct_daily_revenue", "min": 10},
            ],
        },
    ],
}

BOARD = {
    "nodes": [
        {"id": "orders_raw", "label": "orders_raw", "kind": "source", "col": 0},
        {"id": "customers_raw", "label": "customers_raw", "kind": "source", "col": 0},
        {"id": "stg_orders", "label": "stg_orders", "kind": "task", "col": 1},
        {"id": "stg_customers", "label": "stg_customers", "kind": "task", "col": 1},
        {"id": "fct_daily_revenue", "label": "fct_daily_revenue", "kind": "task", "col": 2},
    ],
    "edges": [["orders_raw", "stg_orders"], ["customers_raw", "stg_customers"],
              ["stg_orders", "fct_daily_revenue"], ["stg_customers", "fct_daily_revenue"]],
}


def fmt_rows(cur: sqlite3.Cursor, limit: int = 12) -> str:
    """Format a result set as an aligned text table (what the terminal shows)."""
    cols = [d[0] for d in cur.description]
    rows = cur.fetchmany(limit)
    cells = [cols] + [["" if v is None else str(v) for v in r] for r in rows]
    widths = [max(len(row[i]) for row in cells) for i in range(len(cols))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(row, widths)).rstrip() for row in cells]
    lines.insert(1, "  ".join("-" * w for w in widths))
    extra = cur.fetchone()
    if extra:
        lines.append(f"… ({limit}+ rows)")
    return "\n".join(lines)


def q(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> str:
    cur = conn.execute(sql, args)
    return fmt_rows(cur)


class CheckResult(dict):
    @property
    def failed(self) -> bool:
        return self["status"] == "fail"


def run_check(conn: sqlite3.Connection, check: dict) -> CheckResult:
    t, table = check["type"], check["table"]
    if t == "row_count_min":
        n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        ok = n >= check["min"]
        detail = f"{n:,} rows (min {check['min']:,})"
    elif t == "unique":
        col = check["column"]
        dupes = conn.execute(
            f"SELECT COUNT(*) FROM (SELECT {col} FROM {table} "
            f"GROUP BY {col} HAVING COUNT(*) > 1)").fetchone()[0]
        ok = dupes == 0
        detail = "no duplicate keys" if ok else f"{dupes:,} duplicated {col} values"
    elif t == "not_null":
        col = check["column"]
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        nulls = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {col} IS NULL").fetchone()[0]
        ok = nulls == 0
        detail = ("no NULLs" if ok else
                  f"{nulls:,} NULL {col} rows of {total:,} ({100 * nulls / max(total, 1):.1f}%)")
    else:
        raise ValueError(f"unknown check type {t}")
    name = f"{t}({check.get('column', check.get('min', ''))})"
    return CheckResult(name=name, table=table, status="pass" if ok else "fail",
                       detail=detail)


class Runner:
    """Executes the pipeline on a live connection. Owns a mutable copy of
    the spec so the agent's approved patch can amend a task and re-run."""

    def __init__(self, conn: sqlite3.Connection, spec: dict | None = None):
        self.conn = conn
        self.spec = copy.deepcopy(spec or PIPELINE)

    def task(self, task_id: str) -> dict:
        return next(t for t in self.spec["tasks"] if t["id"] == task_id)

    def patch_task(self, task_id: str, old: str, new: str) -> None:
        t = self.task(task_id)
        if old not in t["sql"]:
            raise ValueError(f"patch target not found in {task_id}")
        t["sql"] = t["sql"].replace(old, new)

    def run(self) -> dict:
        """Returns {"events": [...], "failed": task_id|None, "error"|"check": ...}."""
        events = []
        for t in self.spec["tasks"]:
            try:
                self.conn.executescript(t["sql"])
            except sqlite3.OperationalError as e:
                events.append({"task": t["id"], "status": "fail", "detail": str(e)})
                return {"events": events, "failed": t["id"], "error": str(e)}
            n = self.conn.execute(f"SELECT COUNT(*) FROM {t['id']}").fetchone()[0]
            results = [run_check(self.conn, c) for c in t["checks"]]
            bad = [r for r in results if r.failed]
            events.append({"task": t["id"],
                           "status": "fail" if bad else "ok",
                           "detail": f"rebuilt — {n:,} rows",
                           "checks": [dict(r) for r in results]})
            if bad:
                return {"events": events, "failed": t["id"], "check": dict(bad[0])}
        return {"events": events, "failed": None}
