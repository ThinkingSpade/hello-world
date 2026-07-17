import json
import subprocess
import sys

import pytest

from abacus.analyst import anomalies, investigate, retention
from abacus.engine import narrate, run_any, run_plan
from abacus.generate import build, stats
from abacus.goldens import GOLDENS
from abacus.parser import parse
from abacus.semantics import METRICS, compile_plan, manifest


@pytest.fixture(scope="session")
def conn():
    return build()


@pytest.mark.parametrize("q,exp", GOLDENS, ids=[g[0][:40] for g in GOLDENS])
def test_golden_plans_and_results(conn, q, exp):
    plan = parse(q)
    kind = exp.get("kind", "aggregate")
    assert plan.get("kind", "aggregate") == kind
    assert plan["time"]["label"] == exp["time_label"]
    assert (plan.get("compare") is not None) == exp.get("compare", False)
    if kind == "aggregate":
        assert plan["metric"] == exp["metric"]
        assert plan["dims"] == exp.get("dims", [])
        assert plan.get("top") == exp.get("top")
        assert plan.get("filters", []) == exp.get("filters", [])
    elif kind == "investigate":
        assert plan["metric"] == exp["metric"]
    res, story = run_any(conn, plan)
    from abacus.goldens import canonical_check
    assert canonical_check(plan, res), "every golden must produce a result"
    assert story


def test_compiled_sql_matches_independent_query(conn):
    """The compiler's answer must equal a hand-written query nobody shares
    code with — revenue by region, Q1 2026."""
    r = run_plan(conn, parse("revenue by region last quarter"))
    truth = dict(conn.execute("""
        SELECT c.region, ROUND(SUM(i.net_revenue), 4)
        FROM fact_order_items i, fact_orders o, dim_customer c
        WHERE i.order_id = o.order_id AND o.customer_id = c.customer_id
          AND o.order_date BETWEEN '2026-01-01' AND '2026-03-31'
        GROUP BY 1""").fetchall())
    got = {row[0]: round(row[1], 4) for row in r["rows"]}
    assert got == truth


def test_aov_equals_revenue_over_orders(conn):
    aov = run_plan(conn, parse("aov in 2025"))["rows"][0][-1]
    rev = run_plan(conn, parse("revenue in 2025"))["rows"][0][-1]
    orders = run_plan(conn, parse("orders in 2025"))["rows"][0][-1]
    assert aov == pytest.approx(rev / orders)


def test_filter_slices_are_a_partition(conn):
    total = run_plan(conn, parse("revenue in 2025"))["rows"][0][-1]
    parts = sum(run_plan(conn, parse(f"{ch} revenue in 2025"))["rows"][0][-1]
                for ch in ["web", "mobile", "store"])
    assert parts == pytest.approx(total, rel=1e-9)


def test_compare_math(conn):
    plan = parse("revenue ytd vs last year")
    r = run_plan(conn, plan)
    this_v = r["rows"][0][-1]
    prior = r["prior"]["value"]
    line = narrate(plan, r)
    expect = 100 * (this_v - prior) / abs(prior)
    assert f"{expect:+.1f}%" in line


def test_unknown_metric_is_a_helpful_error():
    with pytest.raises(ValueError, match="no metric recognized"):
        parse("vibes by region last quarter")


def test_compiler_rejects_unknown_keys():
    with pytest.raises(KeyError):
        compile_plan({"metric": "drop_tables", "dims": [],
                      "time": {"start": "2024-01-01", "end": "2026-06-30"}})


def test_generator_is_deterministic():
    assert stats(build())["revenue"] == stats(build())["revenue"]


def test_manifest_covers_all_synonyms_uniquely():
    man = manifest()
    seen = {}
    for kind in ("metrics", "dimensions"):
        for key, spec in man[kind].items():
            for s in spec["syn"]:
                assert s not in seen, f"synonym clash: {s!r} in {seen.get(s)} and {key}"
                seen[s] = key


def test_cli_ask_and_eval(tmp_path):
    r = subprocess.run([sys.executable, "-m", "abacus", "ask",
                        "margin % by category in 2025"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "Gross margin %" in r.stdout and "GROUP BY" in r.stdout
    r2 = subprocess.run([sys.executable, "-m", "abacus", "eval"],
                        capture_output=True, text=True)
    assert r2.returncode == 0, r2.stdout
    assert "35/35" in r2.stdout


def test_export_bundle(tmp_path):
    r = subprocess.run([sys.executable, "-m", "abacus", "export", "-o", str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    goldens = json.loads((tmp_path / "goldens.json").read_text())
    assert len(goldens) == 35 and all(g["rows"] for g in goldens)
    man = json.loads((tmp_path / "manifest.json").read_text())
    assert man["stats"]["rows_total"] > 100000
    assert (tmp_path / "warehouse.sqlite").stat().st_size > 1_000_000


def test_investigation_contributions_partition_the_delta(conn):
    plan = parse("why did revenue jump in q4 2025 vs the previous quarter")
    inv = investigate(conn, plan)
    for dim, rows in inv["by_dim"].items():
        assert sum(r["delta"] for r in rows) == pytest.approx(inv["delta"]), dim
    w = inv["waterfall"]
    assert w["start"] + sum(s["delta"] for s in w["steps"]) == pytest.approx(w["end"])
    vp = inv["vol_price"]
    assert vp["volume_effect"] + vp["price_effect"] + vp["interaction"] == \
        pytest.approx(inv["delta"])


def test_investigation_totals_match_plain_aggregates(conn):
    plan = parse("why did revenue dip in july 2025")
    inv = investigate(conn, plan)
    direct = run_plan(conn, {"metric": "revenue", "dims": [], "filters": [],
                             "time": plan["time"], "top": None})["rows"][0][-1]
    assert inv["cur"] == pytest.approx(direct)


def test_retention_starts_at_100(conn):
    ret = retention(conn)
    assert len(ret["matrix"]) >= 8
    for row in ret["matrix"]:
        if row["size"]:
            assert row["cells"][0] == 100.0
            assert all(0 <= c <= 100 for c in row["cells"])


def test_anomaly_scan_finds_black_friday(conn):
    an = anomalies(conn, {"start": "2025-01-01", "end": "2025-12-31", "label": "2025"})
    assert an["flags"], "2025 contains Black Friday; the scan must see something"
    months = {f["month"] for f in an["flags"]}
    assert {"2025-11", "2025-12"} & months, "Nov/Dec discount+revenue spike expected"
    assert all(abs(f["z"]) >= 2 for f in an["flags"])


def test_rate_metric_investigation_is_not_additive(conn):
    plan = parse("why did return rate change in q1 2026")
    assert plan["kind"] == "investigate" and plan["metric"] == "return_rate"
    inv = investigate(conn, plan)
    assert inv["additive"] is False and inv["waterfall"] is None
