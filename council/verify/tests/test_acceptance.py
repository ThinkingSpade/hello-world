"""Acceptance suite.

Every expected figure lives in ``fixtures/*.json``. Not one appears here, and
none appears in ``reference.py``. The test's job is to say *how* a fixture
value is computed; the fixture's job is to say *what* it should be. Keeping
those apart is what makes the suite a check rather than a restatement.

Each acceptance value is its own test case, so a failure names the exact
measure rather than the whole run.

    pip install -r ../requirements.txt
    COUNCIL_WORKBOOK=/path/to/book.xlsx pytest -q

Without a workbook the whole module skips cleanly, so a repository that does
not carry the confidential source data still passes CI.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import reference as R  # noqa: E402

FIXTURE_DIR = Path(__file__).parent / "fixtures"


# --------------------------------------------------------------------------
# fixture + workbook wiring
# --------------------------------------------------------------------------

def load_fixture() -> dict:
    files = sorted(FIXTURE_DIR.glob("*.json"))
    if not files:
        pytest.skip("no acceptance fixture present")
    return json.loads(files[0].read_text())


FIXTURE = load_fixture()
WORKBOOK = R.workbook_path()

pytestmark = pytest.mark.skipif(
    WORKBOOK is None,
    reason=(
        "Set COUNCIL_WORKBOOK to the source workbook to run the acceptance suite. "
        "The workbook is deliberately not committed; the fixture holds only expected values."
    ),
)


class Case:
    """Everything the measure registry needs, discovered from the workbook."""

    def __init__(self, path: str):
        self.engine, self.sheet, self.contract, self.sheets = R.build(path)
        attr = next(s for s in self.sheets.values()
                    if s is not self.sheet and 1 < len(s.rows) <= 200)
        self.attr = attr

        def col_with(values: set[str]) -> str | None:
            for c in attr.header:
                if {str(v).strip() for v in attr.values(c)} == values:
                    return c
            return None

        def col_named(*needles: str) -> str | None:
            for c in attr.header:
                low = c.lower()
                if any(n in low for n in needles):
                    return c
            return None

        self.key = self.engine.weight_dim                      # e.g. "SKU"
        self.attr_key = next(c for c in attr.header
                             if {str(v) for v in attr.values(c)} >=
                             {d for f in self.engine.facts for d in [f.dims.get(self.key)] if d})
        self.cls_col = col_with({"Legacy", "New"}) or col_named("legacy", "new")
        self.colour_col = col_named("black/color", "colour", "color") or col_with({"Black", "Color"})
        self.ytype_col = col_named("yield type")
        self.yield_col = col_named("yield") if col_named("yield") != self.ytype_col else None
        if self.yield_col is None:
            self.yield_col = next(c for c in attr.header
                                  if c != self.ytype_col and "yield" in c.lower())
        self.msrp_col = col_named("msrp", "price index")

        ki = attr.col(self.attr_key)
        self.attrs = {str(r[ki]): {c: r[attr.col(c)] for c in attr.header} for r in attr.rows}
        self.new_keys = {k for k, a in self.attrs.items() if str(a[self.cls_col]) == "New"}
        self.legacy_keys = set(self.attrs) - self.new_keys

        e = self.engine
        self.last = e.periods[-1]
        self.launch = min(
            f.period for f in e.facts
            if f.dims.get(self.key) in self.new_keys
            and any(v > 0 for k, v in f.measures.items()
                    if self.contract.roles.get(k) == "stock")
        )
        self.flow = next(c for c, r in self.contract.roles.items() if r == "flow")
        self.stock = next(c for c, r in self.contract.roles.items() if r == "stock")
        self.entity = next(d for d in self.contract.grain
                           if d not in (self.contract.period_col, self.key))

        self.anchors_inv, self.anchors_sale = {}, {}
        for ent in sorted({f.dims[self.entity] for f in e.facts}):
            self.anchors_inv[ent] = e.first_period_where(
                self.entity, ent,
                lambda f: f.dims.get(self.key) in self.new_keys and f.measures.get(self.stock, 0) > 0)
            self.anchors_sale[ent] = e.first_period_where(
                self.entity, ent,
                lambda f: f.dims.get(self.key) in self.new_keys and f.measures.get(self.flow, 0) > 0)

    # --- predicates ------------------------------------------------------
    def by_colour(self, name: str):
        return lambda f: str(self.attrs.get(f.dims.get(self.key), {}).get(self.colour_col)) == name

    def by_entity(self, name: str):
        return lambda f: f.dims.get(self.entity) == name

    def by_key(self, k: str):
        return lambda f: f.dims.get(self.key) == k

    def tier_key(self, k: str) -> str:
        a = self.attrs[k]
        std = "xl" if "high" in str(a[self.ytype_col]).lower() else "std"
        return f"{std}_{str(a[self.colour_col]).lower()}"

    def successor(self, k: str) -> str:
        colour = self.attrs[k][self.colour_col]
        return next(n for n in self.new_keys if self.attrs[n][self.colour_col] == colour)


CASE = Case(WORKBOOK) if WORKBOOK else None


# --------------------------------------------------------------------------
# measure registry: fixture id -> how to compute it
# --------------------------------------------------------------------------

def _pages(c: Case, a: str, b: str, where=None) -> float:
    return c.engine.total(c.flow, a, b, where, weight=c.yield_col)


def _yoy_pages(c: Case, a: str, b: str, where=None):
    return c.engine.matched(c.flow, a, b, where, weight=c.yield_col)[2]


def compute(mid: str, c: Case):
    e = c.engine
    base, _, arg = mid.partition("::")
    full_a, full_b = c.launch, c.last
    y1a, y1b = R.shift_days(full_a, -364), R.shift_days(full_b, -364)
    y2a, y2b = R.shift_days(full_a, -728), R.shift_days(full_b, -728)

    if base == "headline_pages_current":  return _pages(c, full_a, full_b)
    if base == "headline_pages_prior":    return _pages(c, y1a, y1b)
    if base == "headline_pages_yoy":      return _yoy_pages(c, full_a, full_b)
    if base == "hist_pages_yoy_y2":       return _yoy_pages(c, y1a, y1b)
    if base == "hist_pages_yoy_y3":       return _yoy_pages(c, y2a, y2b)

    if base == "units_current":  return e.total(c.flow, full_a, full_b)
    if base == "units_prior":    return e.total(c.flow, y1a, y1b)
    if base == "units_yoy":      return e.matched(c.flow, full_a, full_b)[2]

    if base == "pages_per_unit_current": return _pages(c, full_a, full_b) / e.total(c.flow, full_a, full_b)
    if base == "pages_per_unit_prior":   return _pages(c, y1a, y1b) / e.total(c.flow, y1a, y1b)
    if base == "pages_per_unit_delta":
        return (_pages(c, full_a, full_b) / e.total(c.flow, full_a, full_b)) / \
               (_pages(c, y1a, y1b) / e.total(c.flow, y1a, y1b)) - 1

    if base in ("bridge_yield_normalization_units", "bridge_demand_effect_units"):
        cur_u, pri_u = e.total(c.flow, full_a, full_b), e.total(c.flow, y1a, y1b)
        ypu = _pages(c, full_a, full_b) / cur_u
        flat = _pages(c, y1a, y1b) / ypu
        return (flat - pri_u) if base.endswith("normalization_units") else (cur_u - flat)

    if base.startswith("latest") and base.endswith("w_pages_yoy"):
        n = int(base[len("latest"):-len("w_pages_yoy")])
        return _yoy_pages(c, *e.trailing(n))

    if base == "black_full_pages_yoy":  return _yoy_pages(c, full_a, full_b, c.by_colour("Black"))
    if base == "color_full_pages_yoy":  return _yoy_pages(c, full_a, full_b, c.by_colour("Color"))
    if base == "black_hist_avg_pages_yoy":
        return (_yoy_pages(c, y1a, y1b, c.by_colour("Black")) +
                _yoy_pages(c, y2a, y2b, c.by_colour("Black"))) / 2
    if base == "color_latest4w_pages_yoy":
        return _yoy_pages(c, *e.trailing(4), where=c.by_colour("Color"))

    if base == "adoption_new_unit_share_last_week":
        tot = e.at(c.flow, c.last)
        new = e.at(c.flow, c.last, lambda f: f.dims.get(c.key) in c.new_keys)
        return new / tot

    if base == "legacy_inventory_remaining":
        return e.at(c.stock, c.last, lambda f: f.dims.get(c.key) in c.legacy_keys)
    if base == "legacy_inventory_top2_share":
        per = Counter()
        for f in e.window(c.last, c.last):
            if f.dims.get(c.key) in c.legacy_keys:
                per[f.dims[c.entity]] += f.measures.get(c.stock, 0)
        return sum(v for _, v in per.most_common(2)) / sum(per.values())
    if base == "legacy_inventory_drawdown_from_launch":
        at = lambda p: e.at(c.stock, p, lambda f: f.dims.get(c.key) in c.legacy_keys)
        return at(c.last) / at(c.launch) - 1

    if base in ("std_black_prelaunch_units", "prelaunch_units_total", "std_black_prelaunch_share"):
        # Fiscal-year membership comes from the RAW segment tag, not from a date
        # range -- a split period straddles the boundary and the two readings
        # differ. This is the definition the fixture records.
        fy_col = next(c2 for c2 in c.contract.demoted_labels
                      if len({str(v) for v in c.sheet.values(c2)}) <= 8)
        ki, fi = c.sheet.col(c.key), c.sheet.col(fy_col)
        pi = c.sheet.col(c.contract.period_col)
        mi = c.sheet.col(c.flow)
        latest_fy = max({str(r[fi]) for r in c.sheet.rows})
        tot = std = 0.0
        for r in c.sheet.rows:
            if str(r[fi]) != latest_fy:
                continue
            if (R.as_date(r[pi]) or "") >= c.launch:
                continue
            v = R.as_num(r[mi]) or 0
            tot += v
            a = c.attrs.get(str(r[ki]), {})
            if str(a.get(c.colour_col)) == "Black" and "high" not in str(a.get(c.ytype_col)).lower():
                std += v
        if base == "std_black_prelaunch_units":  return std
        if base == "prelaunch_units_total":      return tot
        return std / tot

    if base == "retailer_latest4w_pages_yoy":
        return _yoy_pages(c, *e.trailing(4), where=c.by_entity(arg))

    if base.startswith("wos_new_"):
        colour = "Black" if base.endswith("black") else "Color"
        sku = next(k for k in c.new_keys if str(c.attrs[k][c.colour_col]) == colour)
        inv = e.at(c.stock, c.last, lambda f: f.dims.get(c.key) == sku and f.dims.get(c.entity) == arg)
        a, b = e.trailing(4)
        sold = e.total(c.flow, a, b, lambda f: f.dims.get(c.key) == sku and f.dims.get(c.entity) == arg) / 4
        return inv / sold

    if base in ("price_unit_delta", "price_yield_delta", "price_cpp_delta"):
        old = next(k for k in c.legacy_keys if c.tier_key(k) == arg)
        new = c.successor(old)
        o, n = c.attrs[old], c.attrs[new]
        if base == "price_unit_delta":  return n[c.msrp_col] / o[c.msrp_col] - 1
        if base == "price_yield_delta": return n[c.yield_col] / o[c.yield_col] - 1
        return (n[c.msrp_col] / n[c.yield_col]) / (o[c.msrp_col] / o[c.yield_col]) - 1

    if base in ("revenue_proxy_yoy", "asp_index_delta"):
        where = None if arg == "total" else c.by_colour(arg.capitalize())
        rev = lambda a, b: e.total(c.flow, a, b, where, weight=c.msrp_col)
        if base == "revenue_proxy_yoy":
            return rev(full_a, full_b) / rev(y1a, y1b) - 1
        # Average selling price must divide by the units of the SAME slice --
        # dividing a colour's price-weighted total by all units measures mix,
        # not price.
        units = lambda a, b: e.total(c.flow, a, b, where)
        return (rev(full_a, full_b) / units(full_a, full_b)) / \
               (rev(y1a, y1b) / units(y1a, y1b)) - 1

    if base.startswith("split_inventory_sum_inflation_"):
        period = base[len("split_inventory_sum_inflation_"):].replace("_", "-")
        pi, si = c.sheet.col(c.contract.period_col), c.sheet.col(c.stock)
        idx = [c.sheet.col(g) for g in c.contract.grain]
        groups = defaultdict(list)
        for r in c.sheet.rows:
            if (R.as_date(r[pi]) or "") == period:
                groups[tuple(str(r[i]) for i in idx)].append(R.as_num(r[si]) or 0)
        return sum(sum(v) for v in groups.values()) / sum(max(v) for v in groups.values()) - 1

    if base.startswith("eventtime_"):
        n = 10
        if base == "eventtime_prelaunch10_pages_yoy":
            return e.event_matched(c.flow, c.anchors_inv, n, c.entity, before=True, weight=c.yield_col)
        anchors = c.anchors_inv if "inventory" in base else c.anchors_sale
        return e.event_matched(c.flow, anchors, n, c.entity, weight=c.yield_col)

    pytest.skip(f"no computation registered for acceptance id '{mid}'")


# --------------------------------------------------------------------------
# tests
# --------------------------------------------------------------------------

@pytest.mark.parametrize("key", sorted(k for k in FIXTURE["contract"] if not isinstance(FIXTURE["contract"][k], dict)))
def test_contract(key):
    """The data contract must be rediscovered, not configured."""
    expected = FIXTURE["contract"][key]
    c = CASE
    actual = {
        "rawRows": c.contract.raw_rows,
        "collapsedKeys": c.contract.collapsed_rows,
        "splitSegments": c.contract.raw_rows - c.contract.collapsed_rows,
        "splitWeeks": len(c.contract.extras.get("splitPeriods", [])),
        "weeks": len(c.engine.periods) + len(c.contract.incomplete_periods),
        "retailers": len({f.dims[c.entity] for f in c.engine.facts}),
        "skus": len({f.dims[c.key] for f in c.engine.facts}),
        "partialWeeks": c.contract.incomplete_periods,
        "lastCompleteWeek": c.engine.periods[-1],
        "firstInventoryWeek": c.launch,
        "firstSaleWeek": min(f.period for f in c.engine.facts
                             if f.dims.get(c.key) in c.new_keys and f.measures.get(c.flow, 0) > 0),
        "grain": c.contract.grain,
    }.get(key, "__unchecked__")

    if actual == "__unchecked__" or actual is None:
        pytest.skip(f"contract key '{key}' is descriptive only")
    if key == "grain":
        assert set(actual) == set(expected), f"grain: expected {expected}, got {actual}"
    else:
        assert actual == expected, f"{key}: expected {expected}, got {actual}"


@pytest.mark.parametrize(
    "entry", FIXTURE["acceptance"], ids=[a["id"] for a in FIXTURE["acceptance"]]
)
def test_acceptance(entry):
    actual = compute(entry["id"], CASE)
    assert actual is not None, f"{entry['id']} produced no value"
    expected, tol = entry["value"], entry.get("tol", 0)
    delta = abs(actual - expected)
    assert delta <= max(tol, tol * abs(expected)), (
        f"{entry['id']}\n"
        f"  definition: {entry.get('definition','')}\n"
        f"  expected:   {expected}\n"
        f"  actual:     {actual}\n"
        f"  delta:      {delta} (tolerance {tol})"
    )
