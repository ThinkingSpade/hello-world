"""A small synthetic warehouse in SQLite, plus the three ways we break it.

Everything is deterministic (seeded RNG, pinned clock) so the same scenario
always produces the same incident, the same diagnosis, and the same fix —
that's what makes the replay demo an honest recording of a real run.
The data is openly synthetic; the SQL that breaks and gets repaired is real.
"""

from __future__ import annotations

import random
import sqlite3

TODAY = "2026-07-11"          # pinned clock: determinism over realism
DAYS = 14
REGIONS = ["gulf-coast", "midwest", "northeast", "pacific", "mountain"]
STATUSES = ["placed", "placed", "placed", "shipped", "shipped", "cancelled"]


def _dates() -> list[str]:
    # last DAYS calendar days ending at TODAY (July 2026 is easy math)
    day = int(TODAY.split("-")[2])
    return [f"2026-07-{d:02d}" if d > 0 else f"2026-06-{30 + d:02d}"
            for d in range(day - DAYS + 1, day + 1)]


def seed(conn: sqlite3.Connection) -> None:
    rng = random.Random(42)
    c = conn.cursor()
    c.executescript("""
        DROP TABLE IF EXISTS customers_raw;
        CREATE TABLE customers_raw (customer_id INTEGER, region TEXT, signup_date TEXT);
        DROP TABLE IF EXISTS orders_raw;
        CREATE TABLE orders_raw (order_id INTEGER, customer_id INTEGER,
                                 order_ts TEXT, order_total REAL,
                                 status TEXT, load_batch TEXT);
    """)
    for cid in range(1000, 1600):
        c.execute("INSERT INTO customers_raw VALUES (?,?,?)",
                  (cid, rng.choice(REGIONS), f"2025-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}"))
    oid = 500000
    for day in _dates():
        n = 110 + rng.randint(-25, 40)
        for _ in range(n):
            oid += 1
            c.execute("INSERT INTO orders_raw VALUES (?,?,?,?,?,?)", (
                oid, rng.randint(1000, 1599),
                f"{day} {rng.randint(6,23):02d}:{rng.randint(0,59):02d}:00",
                round(rng.uniform(8, 240), 2),
                rng.choice(STATUSES), f"batch-{day}-01"))
    conn.commit()


# ---------------------------------------------------------------- breakages
def break_schema_drift(conn: sqlite3.Connection) -> None:
    """The vendor's nightly export renamed order_total → total_amount.
    The loader recreates orders_raw from the export, so the whole table
    arrives with the new column name."""
    conn.executescript("""
        ALTER TABLE orders_raw RENAME COLUMN order_total TO total_amount;
    """)
    conn.commit()


def break_null_join(conn: sqlite3.Connection) -> None:
    """Today's upstream export switched to formatted customer IDs
    ('CUST-1042'). They land as TEXT, the join to customers_raw stops
    matching, and region goes NULL for every order loaded today."""
    conn.execute(
        "UPDATE orders_raw SET customer_id = 'CUST-' || customer_id "
        "WHERE date(order_ts) = ?", (TODAY,))
    conn.commit()


def break_dup_load(conn: sqlite3.Connection) -> None:
    """Yesterday's file got loaded twice (a retry after a timeout that had
    actually succeeded). Same orders, second batch tag — revenue doubles."""
    yday = _dates()[-2]
    conn.execute(
        "INSERT INTO orders_raw "
        "SELECT order_id, customer_id, order_ts, order_total, status, "
        f"       'batch-{yday}-02' "
        "FROM orders_raw WHERE date(order_ts) = ? AND load_batch = ?",
        (yday, f"batch-{yday}-01"))
    conn.commit()


SCENARIOS = {
    "schema-drift": {
        "title": "nightly-revenue derailed — vendor renamed a column overnight",
        "tag": "warehouse · P2 · schema drift",
        "page": ("Airflow — nightly-revenue failed at stg_orders: "
                 "OperationalError: no such column: o.order_total (0 of 3 marts refreshed, "
                 "finance dashboard is stale)"),
        "break": break_schema_drift,
    },
    "null-join": {
        "title": "region gone NULL — a join quietly stopped matching",
        "tag": "warehouse · P3 · data quality",
        "page": ("Data-quality alarm — fct_daily_revenue: not_null(region) failing on "
                 "today's partition; revenue by region under-reporting in every dashboard"),
        "break": break_null_join,
    },
    "dup-load": {
        "title": "revenue doubled overnight — yesterday loaded twice",
        "tag": "warehouse · P2 · duplicate load",
        "page": ("Data-quality alarm — stg_orders: unique(order_id) failing; "
                 "yesterday's revenue reads 2× and the CFO noticed before we did"),
        "break": break_dup_load,
    },
}


def build(scenario: str) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    seed(conn)
    SCENARIOS[scenario]["break"](conn)
    return conn
