"""Deterministic synthetic demo corpus. Seeded LCG only - no `random`, so the
committed workbook is byte-reproducible from this script."""
import openpyxl, datetime, json, os

OUT = "/home/user/hello-world/council/demo"
os.makedirs(OUT, exist_ok=True)

class R:                      # tiny reproducible LCG
    def __init__(s, seed): s.x = seed & 0xFFFFFFFF
    def u(s):
        s.x = (1664525 * s.x + 1013904223) & 0xFFFFFFFF
        return s.x / 0x100000000
    def n(s, lo, hi): return lo + (hi - lo) * s.u()

rng = R(20260803)

RET = ["NORTHWIND SUPPLY", "ORCHARD RETAIL", "PACIFIC DEPOT", "STONEBRIDGE CO", "VERDE MARKET"]
SKU = [
    # sku, class, family, desc, colour, yield type, yield, msrp index
    ("SKU-A1", "Legacy", "400", "400 Black",        "Black", "Standard",   180, 100),
    ("SKU-A2", "Legacy", "400", "400 Tri-color",    "Color", "Standard",   160, 138),
    ("SKU-B1", "Legacy", "400", "400 XL Black",     "Black", "High Yield", 450, 218),
    ("SKU-B2", "Legacy", "400", "400 XL Tri-color", "Color", "High Yield", 320, 232),
    ("SKU-N1", "New",    "400", "400 XL Black",     "Black", "High Yield", 380, 168),
    ("SKU-N2", "New",    "400", "400 Tri-color",    "Color", "Standard",   210, 178),
]
NEW = {"SKU-N1", "SKU-N2"}
SUCC = {"Black": "SKU-N1", "Color": "SKU-N2"}

WEEKS = 128
START = datetime.date(2024, 1, 7)                  # Sundays
weeks = [START + datetime.timedelta(days=7 * i) for i in range(WEEKS)]
LAUNCH_INV = 110                                    # index of first new-SKU inventory week
STAGGER = {"NORTHWIND SUPPLY": 110, "ORCHARD RETAIL": 111, "PACIFIC DEPOT": 111,
           "STONEBRIDGE CO": 114, "VERDE MARKET": 111}

# Fiscal calendar: 4-4-5, month boundary lands mid-week for ~1 week in 4 -> split rows.
def fiscal(w, i):
    fy = 24 + (i // 52)
    per = i // 4 + 1
    fm = ((per - 1) % 12) + 1
    fq = (fm - 1) // 3 + 1
    return f"FY{fy}", f"FY{fy}-Q{fq}", f"FY{fy}M{fm:02d}"

BASE = {"NORTHWIND SUPPLY": 5200, "ORCHARD RETAIL": 3100, "PACIFIC DEPOT": 4400,
        "STONEBRIDGE CO": 2600, "VERDE MARKET": 1900}
SHARE = {"SKU-A1": .42, "SKU-B1": .34, "SKU-A2": .10, "SKU-B2": .14}

rows = []
inv = {(r, s): BASE[r] * SHARE.get(s, .2) * 4 for r in RET for s, *_ in SKU}

for i, wk in enumerate(weeks):
    fy, fq, fm = fiscal(wk, i)
    split = (i % 4 == 3)                            # every 4th week straddles a month
    nfy, nfq, nfm = fiscal(wk, i + 1)
    decline = (1 - 0.0032) ** i                     # series is ageing out before launch
    season = 1 + 0.12 * __import__("math").sin(i / 52 * 2 * 3.14159)
    for ret in RET:
        launched = i >= STAGGER[ret]
        for sku, cls, *_rest in [(s[0], s[1]) for s in SKU]:
            colour = [s[4] for s in SKU if s[0] == sku][0]
            legacy = sku not in NEW
            if not legacy and not launched:
                continue
            if legacy and i >= STAGGER[ret]:
                # mandated return: legacy sell-through collapses, stock is pulled back
                fade = max(0.0, 1 - (i - STAGGER[ret]) / 5.0)
            else:
                fade = 1.0
            if not legacy:
                # the new SKU absorbs the colour's demand
                sh = sum(v for k, v in SHARE.items()
                         if [s[4] for s in SKU if s[0] == k][0] == colour)
                base = BASE[ret] * sh * (1 - min(1, (i - STAGGER[ret]) / 5.0) * 0)
                ramp = min(1.0, max(0.0, (i - STAGGER[ret]) / 4.0))
                # demand measured in pages carries over; units fall because yield rose
                legacy_yield = sum(
                    [s[6] for s in SKU if s[0] == k][0] * SHARE[k]
                    for k in SHARE if [s[4] for s in SKU if s[0] == k][0] == colour) / sh
                new_yield = [s[6] for s in SKU if s[0] == sku][0]
                units = base * decline * season * ramp * (legacy_yield / new_yield) * rng.n(.92, 1.08)
            else:
                units = BASE[ret] * SHARE[sku] * decline * season * fade * rng.n(.9, 1.1)
            units = max(0, int(round(units)))

            k = (ret, sku)
            sell_in = units * rng.n(.85, 1.25) if (not legacy or fade > 0) else 0
            inv[k] = max(0, inv[k] - units + sell_in)
            if legacy and i >= STAGGER[ret]:
                inv[k] *= 0.62                       # returns pulled from the shelf
            if not legacy and i == STAGGER[ret]:
                inv[k] = units * 8 + BASE[ret] * 0.9  # initial sell-in lands before any sale
            on_hand = int(round(inv[k]))
            if units == 0 and on_hand == 0:
                continue

            if split:
                # the week straddles a fiscal month: two segments, one flow split
                # across them, and the SAME stock snapshot repeated on both.
                a = int(round(units * rng.n(.2, .5)))
                rows.append([fy, fq, fm, wk.isoformat(), ret, sku, a, on_hand])
                rows.append([nfy, nfq, nfm, wk.isoformat(), ret, sku, units - a,
                             int(round(on_hand * rng.n(.985, 1.0)))])
            else:
                rows.append([fy, fq, fm, wk.isoformat(), ret, sku, units, on_hand])

# final week is partial: only one retailer has reported
last = weeks[-1].isoformat()
rows = [r for r in rows if r[3] != last or r[4] == "PACIFIC DEPOT"]

wb = openpyxl.Workbook()
ws = wb.active; ws.title = "Raw Data"
ws.append(["Fiscal Year", "Fiscal Quarter", "Fiscal Month", "Fiscal Week Ending",
           "Retailer", "SKU", "Sales (Units)", "Inventory (Units)"])
for r in rows: ws.append(r)
rf = wb.create_sheet("Reference")
rf.append(["SKU List", "Legacy/New", "Selectability/SKU Family", "Short Description",
           "Black/Color", "Yield Type", "Yield", "MSRP Index"])
for s in SKU: rf.append(list(s))
path = os.path.join(OUT, "portfolio-demo.xlsx")
wb.save(path)

splits = {}
for r in rows: splits[(r[3], r[4], r[5])] = splits.get((r[3], r[4], r[5]), 0) + 1
print("rows:", len(rows), "keys:", len(splits), "split groups:", sum(1 for v in splits.values() if v > 1))
print("weeks:", len(set(r[3] for r in rows)), "partial:", last)
print("saved", path, os.path.getsize(path), "bytes")
