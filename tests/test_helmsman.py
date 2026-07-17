import json
import subprocess
import sys
from pathlib import Path

import pytest

from helmsman.cli import _fixtures
from helmsman.kube import FakeKubectl, is_mutating
from helmsman.pipeline import Incident
from helmsman.signatures import ExtractiveDiagnoser

FX = {name: json.loads(p.read_text()) for name, p in _fixtures().items()}

EXPECT = {
    "oom-crashloop": {"signature": "oom-crashloop", "cmd_has": "memory=512Mi", "risk": "medium"},
    "image-pull": {"signature": "image-pull", "cmd_has": "rollout undo deploy/payments", "risk": "low"},
    "readiness-probe": {"signature": "readiness-probe", "cmd_has": '"value":8080', "risk": "medium"},
}


def run_fixture(name, approve=True):
    fx = FX[name]
    inc = Incident(FakeKubectl(fx), fx["namespace"], fx["selector"])
    return inc.run(approve_cb=lambda p: approve, page_text=fx["page"])


def test_mutation_guard():
    assert is_mutating("-n prod set resources deploy/x --limits=memory=512Mi")
    assert is_mutating("-n prod rollout undo deploy/payments")
    assert not is_mutating("get pods -n prod")
    assert not is_mutating("describe pod x -n prod")
    kube = FakeKubectl(FX["oom-crashloop"])
    with pytest.raises(PermissionError):
        kube.run("-n prod set resources deploy/checkout-api --limits=memory=512Mi "
                 "--requests=memory=256Mi")


@pytest.mark.parametrize("name", sorted(EXPECT))
def test_pipeline_resolves_each_fixture(name):
    s = run_fixture(name, approve=True)
    kinds = [x["t"] for x in s["timeline"]]
    assert kinds[0] == "page" and kinds[-1] == "verify"
    assert "diagnosis" in kinds and "proposal" in kinds and "approval" in kinds and "apply" in kinds
    diag = next(x for x in s["timeline"] if x["t"] == "diagnosis")
    prop = next(x for x in s["timeline"] if x["t"] == "proposal")
    assert diag["signature"] == EXPECT[name]["signature"]
    assert diag["receipts"], "diagnosis must carry verbatim evidence"
    assert EXPECT[name]["cmd_has"] in prop["command"]
    assert prop["risk"] == EXPECT[name]["risk"]
    assert prop["rollback"], "every proposal ships its undo"
    assert s["resolved"] is True
    assert s["timeline"][-1]["result"] == "green"


def test_declined_gate_means_no_mutation():
    fx = FX["oom-crashloop"]
    kube = FakeKubectl(fx)
    s = Incident(kube, fx["namespace"], fx["selector"]).run(approve_cb=lambda p: False)
    kinds = [x["t"] for x in s["timeline"]]
    assert "apply" not in kinds
    assert kube.applied == []                      # cluster literally untouched
    assert s["resolved"] is False
    assert s["timeline"][-1]["result"] == "held"


def test_unknown_signature_stays_read_only():
    fx = json.loads(json.dumps(FX["oom-crashloop"]))          # deep copy
    for k in fx["commands"]:
        fx["commands"][k] = (fx["commands"][k]
                             .replace("OOMKilled", "Completed")
                             .replace("Exit Code:    137", "Exit Code:    0"))
    kube = FakeKubectl(fx)
    called = []
    s = Incident(kube, fx["namespace"], fx["selector"]).run(
        approve_cb=lambda p: called.append(p) or True)
    assert called == []                            # never even asked
    diag = next(x for x in s["timeline"] if x["t"] == "diagnosis")
    assert diag["signature"] == "unknown"
    assert kube.applied == []


def test_extractive_is_deterministic():
    a = run_fixture("image-pull")
    b = run_fixture("image-pull")
    da = next(x for x in a["timeline"] if x["t"] == "diagnosis")
    db = next(x for x in b["timeline"] if x["t"] == "diagnosis")
    assert da == db


def test_ctx_extraction_from_describe():
    fx = FX["readiness-probe"]
    bundle = "\n".join(fx["commands"].values())
    d = ExtractiveDiagnoser().diagnose("prod", bundle)
    assert d is not None
    diag, prop = d
    assert "8081" in diag.cause and "8080" in diag.cause
    assert "deploy/notifications" in prop.command


def test_cli_record_matches_player_schema(tmp_path):
    out = tmp_path / "s.json"
    r = subprocess.run(
        [sys.executable, "-m", "helmsman", "record", "--fixture", "oom-crashloop",
         "-o", str(out)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    s = json.loads(out.read_text())
    assert s["recorded"] == "fixture-replay"
    assert {"id", "title", "tag", "board", "timeline", "resolved"} <= set(s)
    assert s["board"]["nodes"] and s["resolved"] is True
