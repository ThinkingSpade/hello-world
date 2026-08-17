"""Deterministic synthetic demo corpus - the Meridian retention case. Seeded
LCG only, no `random`, so the committed workbook is reproducible from this
script. Run with an optional output directory argument; default is the
directory this script lives in."""
import openpyxl, datetime, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

class R:                      # tiny reproducible LCG (same recurrence as ../generate.py)
    def __init__(s, seed): s.x = seed & 0xFFFFFFFF
    def u(s):
        s.x = (1664525 * s.x + 1013904223) & 0xFFFFFFFF
        return s.x / 0x100000000
    def n(s, lo, hi): return lo + (hi - lo) * s.u()

rng = R(20260817)

# ---- calendar: Jan 2024 .. Jul 2025, monthly ------------------------------
MONTHS = [(2024, m) for m in range(1, 13)] + [(2025, m) for m in range(1, 8)]
def month_end(y, m):
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - datetime.timedelta(days=1)).isoformat()
def quarter(y, m): return f"{y}-Q{(m - 1) // 3 + 1}"

# quarter-close months carry a mid-month billing true-up: the extract arrives
# as two files. Flows are split across the files; the end-of-month subscriber
# snapshot is repeated on both. (July 2025 is the partial month - never split.)
SPLIT = {(2024, 3), (2024, 6), (2024, 9), (2024, 12), (2025, 3), (2025, 6)}
MIGRATION = (2025, 3)          # Team/Standard -> Core, Plus -> Scale, eff. 1 Mar
RENAME = (2024, 11)            # EMEA-UK is re-keyed as UK&I from Nov 2024
FINAL = (2025, 7)              # extract cut 14 Jul: flows cover ~45% of the month
FINAL_FRAC = 14 / 31
FINAL_REGIONS = {"NORTH AMERICA", "UK"}   # only these had reported by the cut

# region internal id, share of the installed base, churn multiplier
REGIONS = [
    ("NORTH AMERICA", 0.34, 0.92),
    ("UK",            0.22, 0.95),   # displayed as EMEA-UK, then UK&I
    ("DACH",          0.16, 1.02),
    ("APAC",          0.15, 1.12),
    ("LATAM",         0.13, 1.18),
]
def region_label(rid, ym):
    if rid != "UK": return rid
    return "UK&I" if ym >= RENAME else "EMEA-UK"

# cohorts carry the behaviour; plans are what the workbook reports.
# base = launch subscribers, churn = monthly churn rate, adds = monthly
# additions as a fraction of the cohort base.
COHORT = {
    "team": {"base": 6200,  "churn": 0.080, "adds": 0.044,  "churn_post": 0.077},
    "std":  {"base": 41500, "churn": 0.027, "adds": 0.0275, "churn_post": 0.026},
    "plus": {"base": 21800, "churn": 0.011, "adds": 0.0127, "churn_post": 0.0105},
}
PLAN_PRE  = {"team": "Team", "std": "Standard", "plus": "Plus"}
PLAN_POST = {"team": "Core", "std": "Core", "plus": "Scale"}
# one-time non-conversion at migration, booked as March churn
MIG_LOSS = {"team": 0.12, "std": 0.03, "plus": 0.02}
# new sales post-migration land on the successor plans (into the sticky cohort)
POST_ADDS = {"Core": ("std", 0.019), "Scale": ("plus", 0.012)}

subs = {(rid, c): int(round(COHORT[c]["base"] * share))
        for rid, share, _ in REGIONS for c in COHORT}

rows = []
for ym in MONTHS:
    y, m = ym
    me, q = month_end(y, m), quarter(y, m)
    post = ym >= MIGRATION
    frac = FINAL_FRAC if ym == FINAL else 1.0
    for rid, share, mult in REGIONS:
        # per-plan totals for the month, built from the cohort ledger
        plan_rows = {}   # plan -> [churned, new]
        for c in COHORT:
            k = (rid, c)
            rate = COHORT[c]["churn_post"] if post else COHORT[c]["churn"]
            lost = 0
            if ym == MIGRATION:
                lost = int(round(subs[k] * MIG_LOSS[c]))
                subs[k] -= lost
            churn = min(subs[k], int(round(subs[k] * rate * mult * frac * rng.n(0.9, 1.1))))
            adds = int(round(subs[k] * COHORT[c]["adds"] * frac * rng.n(0.9, 1.1))) if not post else 0
            subs[k] += adds - churn
            plan = PLAN_POST[c] if post else PLAN_PRE[c]
            pr = plan_rows.setdefault(plan, [0, 0])
            pr[0] += churn + lost
            pr[1] += adds
        if post:
            for plan, (cohort, addrate) in POST_ADDS.items():
                base = sum(subs[(rid, c)] for c in COHORT if PLAN_POST[c] == plan)
                adds = int(round(base * addrate * mult * frac * rng.n(0.9, 1.1)))
                subs[(rid, cohort)] += adds
                plan_rows[plan][1] += adds
        if ym == FINAL and rid not in FINAL_REGIONS:
            continue                       # not yet reported at the cut
        for plan in sorted(plan_rows):
            churned, new = plan_rows[plan]
            eom = sum(subs[(rid, c)] for c in COHORT
                      if (PLAN_POST[c] if post else PLAN_PRE[c]) == plan)
            label = region_label(rid, ym)
            if ym in SPLIT:
                # mid-month true-up: two files, one flow split across them,
                # and the SAME end-of-month snapshot repeated on both.
                ca = int(round(churned * rng.n(0.28, 0.45)))
                na = int(round(new * rng.n(0.28, 0.45)))
                rows.append([me, q, label, plan, "CB-1", eom, ca, na])
                rows.append([me, q, label, plan, "CB-2",
                             int(round(eom * rng.n(0.986, 0.998))), churned - ca, new - na])
            else:
                rows.append([me, q, label, plan, "CB-1", eom, churned, new])

wb = openpyxl.Workbook()
# pin document metadata so a re-run is byte-identical
stamp = datetime.datetime(2026, 8, 1, 0, 0, 0)
wb.properties.created = stamp
wb.properties.modified = stamp
wb.properties.creator = "generate.py"

ws = wb.active; ws.title = "Raw Data"
ws.append(["Month Ending", "Quarter", "Region", "Plan", "Billing File",
           "Subscribers (EOM)", "Churned Accounts", "New Accounts"])
for r in rows: ws.append(r)

rf = wb.create_sheet("Reference")
rf.append(["Plan", "Status", "Successor Plan", "Lineage", "Contract Type",
           "List Price / Seat / Month (USD)", "Notes"])
for r in [
    ["Team",     "Legacy",  "Core",  "Core",  "Month-to-month", 9,
     "Closed to new sales May 2023; migrated 1 Mar 2025"],
    ["Standard", "Legacy",  "Core",  "Core",  "Month-to-month", 19,
     "Migrated 1 Mar 2025"],
    ["Plus",     "Legacy",  "Scale", "Scale", "Annual",         49,
     "Migrated 1 Mar 2025"],
    ["Core",     "Current", "",      "Core",  "Month-to-month", 29,
     "Launched 1 Mar 2025"],
    ["Scale",    "Current", "",      "Scale", "Annual",         59,
     "Launched 1 Mar 2025"],
]: rf.append(r)

path = os.path.join(OUT, "retention-demo.xlsx")
wb.save(path)

keys = {}
for r in rows: keys[(r[0], r[2], r[3])] = keys.get((r[0], r[2], r[3]), 0) + 1
print("rows:", len(rows), "keys:", len(keys),
      "split groups:", sum(1 for v in keys.values() if v > 1))
print("months:", len({r[0] for r in rows}),
      "regions:", len({r[2] for r in rows}), "plans:", len({r[3] for r in rows}))
print("saved", path, os.path.getsize(path), "bytes")
