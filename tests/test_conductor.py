import json
import subprocess
import sys

import pytest

from conductor.agent import Agent
from conductor.pipeline import PIPELINE, Runner
from conductor.warehouse import SCENARIOS, TODAY, build, seed
import sqlite3

EXPECT = {
    "schema-drift": {"sig": "schema-drift", "risk": "low", "patch_has": "total_amount"},
    "null-join": {"sig": "key-format-drift", "risk": "medium", "patch_has": "REPLACE"},
    "dup-load": {"sig": "duplicate-load", "risk": "high", "patch_has": "backup"},
}


def run_scenario(name, approve=True):
    conn = build(name)
    agent = Agent(conn)
    session = agent.run(approve_cb=lambda p: approve,
                        page_text=SCENARIOS[name]["page"])
    return conn, agent, session


def get(timeline, kind):
    return next(x for x in timeline if x["t"] == kind)


@pytest.mark.parametrize("name", sorted(EXPECT))
def test_each_scenario_resolves(name):
    conn, agent, s = run_scenario(name)
    assert s["resolved"] is True
    assert s["timeline"][-1]["result"] == "green"
    diag, prop = get(s["timeline"], "diagnosis"), get(s["timeline"], "proposal")
    assert diag["signature"] == EXPECT[name]["sig"]
    assert diag["receipts"], "diagnosis must quote its evidence"
    assert prop["risk"] == EXPECT[name]["risk"]
    assert EXPECT[name]["patch_has"] in prop["command"].lower() or \
           EXPECT[name]["patch_has"] in prop["command"]
    assert prop["rollback"], "every proposal ships its undo"
    # the repaired warehouse is actually healthy — checks pass on a fresh run
    assert Runner(conn, agent.runner.spec).run()["failed"] is None


def test_schema_drift_fix_maps_the_right_column():
    conn, agent, s = run_scenario("schema-drift")
    prop = get(s["timeline"], "proposal")
    assert "o.total_amount AS order_total" in prop["command"]
    assert "order_ts" not in prop["command"]        # the similarity trap
    row = conn.execute("SELECT revenue FROM fct_daily_revenue LIMIT 1").fetchone()
    assert isinstance(row[0], float) and 0 < row[0] < 100000


def test_null_join_backfills_today():
    conn, agent, s = run_scenario("null-join")
    n = conn.execute(
        "SELECT COUNT(*) FROM fct_daily_revenue WHERE region IS NULL").fetchone()[0]
    assert n == 0


def test_dup_load_dedupes_and_backs_up():
    conn, agent, s = run_scenario("dup-load")
    dupes = conn.execute(
        "SELECT COUNT(*) FROM (SELECT order_id FROM orders_raw "
        "GROUP BY order_id HAVING COUNT(*) > 1)").fetchone()[0]
    assert dupes == 0
    backup = conn.execute(
        "SELECT COUNT(*) FROM orders_raw_backup_dedup").fetchone()[0]
    assert backup > 0, "destructive repair must snapshot first"


def test_declined_gate_leaves_warehouse_untouched():
    conn, agent, s = run_scenario("dup-load", approve=False)
    assert s["resolved"] is False
    assert "apply" not in [x["t"] for x in s["timeline"]]
    assert s["timeline"][-1]["result"] == "held"
    # the duplicate rows are still there — nothing was rewritten
    dupes = conn.execute(
        "SELECT COUNT(*) FROM (SELECT order_id FROM orders_raw "
        "GROUP BY order_id HAVING COUNT(*) > 1)").fetchone()[0]
    assert dupes > 0
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "orders_raw_backup_dedup" not in tables


def test_healthy_pipeline_is_a_false_alarm():
    conn = sqlite3.connect(":memory:")
    seed(conn)
    s = Agent(conn).run(approve_cb=lambda p: pytest.fail("gate asked on healthy run"),
                        page_text="page")
    assert s["resolved"] is True
    kinds = [x["t"] for x in s["timeline"]]
    assert "diagnosis" not in kinds and "proposal" not in kinds


def test_deterministic():
    _, _, a = run_scenario("null-join")
    _, _, b = run_scenario("null-join")
    assert get(a["timeline"], "diagnosis") == get(b["timeline"], "diagnosis")
    assert get(a["timeline"], "proposal") == get(b["timeline"], "proposal")


def test_cli_record_matches_player_schema(tmp_path):
    out = tmp_path / "s.json"
    r = subprocess.run(
        [sys.executable, "-m", "conductor", "record", "--scenario", "dup-load",
         "-o", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    s = json.loads(out.read_text())
    assert s["recorded"] == "scenario-replay"
    assert {"id", "title", "tag", "board", "timeline", "resolved"} <= set(s)
    assert s["board"]["nodes"] and s["board"]["edges"]
