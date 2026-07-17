import json
import subprocess
import sys

import pytest

from oracle.cli import build_seats
from oracle.council import parse_confidence, parse_vote, run_debate, score_confidence, stance


@pytest.fixture(scope="session")
def session():
    seats, moderator = build_seats(mock=True)
    return run_debate("Will the mock proposition hold?", seats, moderator)


def test_parsers():
    assert parse_confidence("blah CONFIDENCE: 72") == 72
    assert parse_confidence("no number here") == 50
    assert parse_vote("VOTE: qualified yes CONFIDENCE: 60") == "qualified yes"
    assert stance("qualified yes") == 1
    assert stance("no") == -1
    assert stance("abstain") == 0


def test_full_protocol_runs_keyless(session):
    assert [r["phase"] for r in session["rounds"]] == [
        "The briefing", "Opening positions", "Cross-examination", "Final votes",
    ]
    briefing = session["rounds"][0]["events"]
    assert len(briefing) == 1 and briefing[0]["agent"] == "scout"
    assert "dossier" in briefing[0]["text"].lower()
    for r in session["rounds"][1:]:
        assert len(r["events"]) == 4          # one per seat, wildcard included
    for r in session["rounds"]:
        for e in r["events"]:
            assert e["text"] and e["think"] >= 0
    assert session["moderator"]["text"]
    assert 1 <= session["result"]["confidence"] <= 99
    assert "how_scored" in session["result"]


def test_briefing_reaches_every_seat(session):
    # openings are generated with the dossier in-prompt; the mock provider
    # keys its opening line on that prompt, so all four seats must have seen it
    openings = session["rounds"][1]["events"]
    assert {e["agent"] for e in openings} == {"gpt", "claude", "gemini", "grok"}
    assert all("brief" in e["text"] for e in openings)


def test_session_matches_player_schema(session):
    # the exact keys the demo player consumes
    assert {"question", "recorded", "agents", "rounds", "moderator", "result"} <= set(session)
    for a in session["agents"]:
        assert {"id", "name", "role", "color"} <= set(a)
    finals = session["rounds"][3]["events"]
    assert all("vote" in e and "confidence" in e for e in finals)
    cbr = session["result"]["confidence_by_round"]
    assert all(len(v) == 3 for v in cbr.values())


def test_confidence_math_disagreement_lowers_score():
    op = {"a": {"confidence": 80}, "b": {"confidence": 75}, "c": {"confidence": 70}}
    agree = {"a": {"vote": "yes", "confidence": 80},
             "b": {"vote": "yes", "confidence": 75},
             "c": {"vote": "qualified yes", "confidence": 70}}
    split = {"a": {"vote": "yes", "confidence": 80},
             "b": {"vote": "no", "confidence": 75},
             "c": {"vote": "no", "confidence": 70}}
    high = score_confidence(agree, op)["confidence"]
    low = score_confidence(split, op)["confidence"]
    assert high > low
    assert "consensus" in score_confidence(agree, op)["how_scored"]


def test_mock_run_is_deterministic():
    seats, moderator = build_seats(mock=True)
    a = run_debate("Same question twice?", seats, moderator)
    seats, moderator = build_seats(mock=True)
    b = run_debate("Same question twice?", seats, moderator)
    assert a["result"]["confidence"] == b["result"]["confidence"]
    assert a["rounds"][1]["events"][0]["text"] == b["rounds"][1]["events"][0]["text"]


def test_cli_record_mock(tmp_path):
    out = tmp_path / "s.json"
    r = subprocess.run(
        [sys.executable, "-m", "oracle", "record", "--mock", "-o", str(out), "test", "question"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text())
    assert data["recorded"] == "live"
    assert len(data["rounds"]) == 4
