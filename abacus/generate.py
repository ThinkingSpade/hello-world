"""Build the demo warehouse: an e-commerce star schema in SQLite.

Openly synthetic, fully seeded, deliberately non-uniform: seasonality
(Q4 peak, summer dip), a weekly cycle, year-over-year growth, a mobile
channel that's eating web, VIPs with fatter baskets, Black-Friday
discounting, and category-dependent return rates — so the questions the
analyst answers have real texture, and every number is reproducible.

The warehouse clock is pinned: "today" is 2026-06-30, so relative dates
("last quarter", "ytd") mean the same thing in every test, the CLI, and
every visitor's browser.
"""

from __future__ import annotations

import math
import random
import sqlite3
from datetime import date, timedelta

TODAY = "2026-06-30"
START = date(2024, 1, 1)
END = date(2026, 6, 30)

REGIONS = ["West", "South", "Midwest", "Northeast"]
REGION_W = [0.32, 0.27, 0.22, 0.19]
CHANNELS = ["web", "mobile", "store"]
SEGMENTS = ["consumer", "business", "vip"]
SEGMENT_W = [0.72, 0.22, 0.06]

CATS = {
    "Electronics": (40, 420, 0.62, 0.11),   # (price lo, hi, cost ratio, return rate)
    "Home": (15, 190, 0.55, 0.05),
    "Apparel": (12, 120, 0.48, 0.09),
    "Beauty": (8, 75, 0.42, 0.04),
    "Outdoors": (20, 260, 0.58, 0.06),
    "Grocery": (4, 40, 0.68, 0.01),
}
ADJ = ["Aurora", "Summit", "Cedar", "Nimbus", "Ember", "Harbor", "Atlas", "Juniper",
       "Cobalt", "Meadow", "Drift", "Quartz", "Willow", "Onyx", "Breeze", "Sable"]
NOUN = {
    "Electronics": ["Headphones", "Speaker", "Monitor", "Keyboard", "Webcam", "Charger", "Router", "Earbuds"],
    "Home": ["Lamp", "Blanket", "Cookware Set", "Air Purifier", "Shelf", "Kettle", "Mirror", "Rug"],
    "Apparel": ["Hoodie", "Jacket", "Sneakers", "Tee", "Cap", "Socks Pack", "Joggers", "Flannel"],
    "Beauty": ["Serum", "Moisturizer", "Cleanser", "Sunscreen", "Balm", "Face Mask", "Toner", "Oil"],
    "Outdoors": ["Tent", "Daypack", "Water Bottle", "Camp Stove", "Sleeping Bag", "Trekking Poles", "Cooler", "Headlamp"],
    "Grocery": ["Coffee Beans", "Olive Oil", "Trail Mix", "Hot Sauce", "Pasta", "Granola", "Tea Sampler", "Honey"],
}


def _season(d: date) -> float:
    """Demand multiplier: Q4 ramp, summer dip, weekend bump, YoY growth."""
    yday = d.timetuple().tm_yday
    seasonal = 1.0 + 0.38 * math.exp(-((yday - 330) % 365) ** 2 / 900)   # Nov-Dec peak
    seasonal -= 0.10 * math.exp(-((yday - 200) ** 2) / 1800)             # July lull
    weekly = 1.12 if d.weekday() >= 5 else 1.0
    growth = 1.0 + 0.28 * ((d - START).days / 365)
    return seasonal * weekly * growth


def _mobile_share(d: date) -> float:
    """Mobile grows from 24% to 41% across the window."""
    t = (d - START).days / max(1, (END - START).days)
    return 0.24 + 0.17 * t


def build(path: str = ":memory:") -> sqlite3.Connection:
    rng = random.Random(20260630)
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE TABLE dim_product (
            product_id INTEGER PRIMARY KEY, product_name TEXT, category TEXT,
            unit_price REAL, unit_cost REAL, return_rate REAL);
        CREATE TABLE dim_customer (
            customer_id INTEGER PRIMARY KEY, region TEXT, segment TEXT,
            signup_date TEXT, first_order_date TEXT);
        CREATE TABLE fact_orders (
            order_id INTEGER PRIMARY KEY, customer_id INTEGER, order_date TEXT,
            channel TEXT);
        CREATE TABLE fact_order_items (
            item_id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER,
            order_date TEXT, qty INTEGER, gross_revenue REAL, discount_amt REAL,
            net_revenue REAL, total_cost REAL, returned INTEGER);
    """)

    # products
    products = []
    pid = 100
    for cat, (lo, hi, cost_ratio, ret) in CATS.items():
        names = set()
        for noun in NOUN[cat]:
            for _ in range(6):
                name = f"{rng.choice(ADJ)} {noun}"
                if name in names:
                    continue
                names.add(name)
                pid += 1
                price = round(rng.uniform(lo, hi), 2)
                cost = round(price * rng.uniform(cost_ratio - 0.06, cost_ratio + 0.06), 2)
                products.append((pid, name, cat, price, cost,
                                 max(0.005, rng.gauss(ret, ret * 0.3))))
    c.executemany("INSERT INTO dim_product VALUES (?,?,?,?,?,?)", products)

    # customers
    customers = []
    for cid in range(10000, 14200):
        region = rng.choices(REGIONS, REGION_W)[0]
        seg = rng.choices(SEGMENTS, SEGMENT_W)[0]
        signup = START + timedelta(days=int(rng.random() ** 1.3 * (END - START).days))
        customers.append([cid, region, seg, str(signup), None])

    # orders + items
    oid, iid = 700000, 900000
    orders, items = [], []
    day = START
    cust_pool = customers
    while day <= END:
        n = max(8, int(rng.gauss(52 * _season(day), 6)))
        mob = _mobile_share(day)
        ch_w = [0.46 - mob * 0.35, mob, 0.54 - mob * 0.65]
        bf = day.month == 11 and 24 <= day.day <= 30           # Black Friday week
        for _ in range(n):
            cust = rng.choice(cust_pool)
            if str(day) < cust[3]:                              # not signed up yet
                continue
            oid += 1
            channel = rng.choices(CHANNELS, ch_w)[0]
            orders.append((oid, cust[0], str(day), channel))
            if cust[4] is None:
                cust[4] = str(day)
            basket = rng.choices([1, 2, 3, 4, 5], [0.44, 0.30, 0.15, 0.08, 0.03])[0]
            if cust[2] == "vip":
                basket += rng.choice([1, 1, 2])
            for _ in range(basket):
                p = rng.choice(products)
                qty = rng.choices([1, 2, 3], [0.78, 0.17, 0.05])[0]
                gross = round(p[3] * qty, 2)
                disc_p = 0.0
                if bf:
                    disc_p = rng.uniform(0.15, 0.35)
                elif rng.random() < 0.18:
                    disc_p = rng.uniform(0.05, 0.20)
                if cust[2] == "business":
                    disc_p = max(disc_p, 0.06)
                disc = round(gross * disc_p, 2)
                returned = 1 if rng.random() < p[5] else 0
                iid += 1
                items.append((iid, oid, p[0], str(day), qty, gross, disc,
                              round(gross - disc, 2), round(p[4] * qty, 2), returned))
        day += timedelta(days=1)

    c.executemany("INSERT INTO fact_orders VALUES (?,?,?,?)", orders)
    c.executemany("INSERT INTO fact_order_items VALUES (?,?,?,?,?,?,?,?,?,?)", items)
    c.executemany("INSERT INTO dim_customer VALUES (?,?,?,?,?)",
                  [tuple(x) for x in customers])
    conn.commit()
    return conn


def stats(conn: sqlite3.Connection) -> dict:
    q = lambda s: conn.execute(s).fetchone()[0]
    return {
        "orders": q("SELECT COUNT(*) FROM fact_orders"),
        "items": q("SELECT COUNT(*) FROM fact_order_items"),
        "customers": q("SELECT COUNT(*) FROM dim_customer"),
        "products": q("SELECT COUNT(*) FROM dim_product"),
        "revenue": round(q("SELECT SUM(net_revenue) FROM fact_order_items"), 2),
        "span": (q("SELECT MIN(order_date) FROM fact_orders"),
                 q("SELECT MAX(order_date) FROM fact_orders")),
    }


if __name__ == "__main__":
    conn = build()
    print(stats(conn))
