import math

import pytest

from churn.data import CATEGORICAL, NUMERIC, load
from churn.train import train


@pytest.fixture(scope="session")
def result():
    return train()


def test_data_loads_clean():
    df = load()
    assert len(df) == 7043                      # every real record present
    assert abs(df["Churn"].mean() - 0.2654) < 0.001
    assert "customerID" not in df.columns
    assert "TotalCharges" not in df.columns     # dropped as collinear
    assert not df.isna().any().any()


def test_model_beats_baseline(result):
    m = result.metrics
    assert m["lr"]["auc"] > 0.83                # honest, known-good range
    assert m["gb"]["auc"] > 0.80
    assert abs(m["lr"]["auc_cv_mean"] - m["lr"]["auc"]) < 0.03  # no split luck


def test_spec_shape(result):
    spec = result.spec
    names = {f["name"] for f in spec["features"]}
    assert names == set(NUMERIC) | set(CATEGORICAL)
    for f in spec["features"]:
        if f["kind"] == "categorical":
            assert f["values"][0]["coef"] == 0.0    # first category = baseline
            assert f["mode"] in {v["value"] for v in f["values"]}


def test_spec_scores_match_sklearn(result):
    """The browser-model spec must reproduce sklearn's probabilities exactly
    — this is the contract that makes the in-browser demo honest."""
    spec = result.spec
    rows = result.X_test.head(25)

    def score(row):
        z = spec["intercept"]
        for f in spec["features"]:
            if f["kind"] == "numeric":
                z += f["coef"] * ((row[f["name"]] - f["mean"]) / f["std"])
            else:
                entry = next(v for v in f["values"] if v["value"] == row[f["name"]])
                z += entry["coef"]
        return 1 / (1 + math.exp(-z))

    manual = [score(r) for _, r in rows.iterrows()]
    sk = result.lr_test_prob[:25]
    worst = max(abs(a - b) for a, b in zip(manual, sk))
    assert worst < 5e-5, f"spec drifts from sklearn by {worst}"


def test_training_is_deterministic(result):
    again = train()
    assert again.spec["intercept"] == result.spec["intercept"]
    assert again.spec["features"][0]["coef"] == result.spec["features"][0]["coef"]


def test_rows_export(tmp_path, result):
    import json

    from churn.data import CATEGORICAL
    from churn.train import save_rows

    out = tmp_path / "rows.json"
    save_rows(result, str(out))
    d = json.loads(out.read_text())
    assert d["n"] == 7043
    assert len(d["ids"]) == 7043 and d["ids"][0]
    assert len(d["score"]) == 7043
    assert all(0.0 <= s <= 1.0 for s in d["score"][:200])
    for c in CATEGORICAL:                     # every model feature ships
        assert len(d["cols"][c]["codes"]) == 7043
    assert sum(d["cols"]["Churn"]) == 1869    # the real churned-customer count


def test_segment_audit(result):
    audit = result.spec["audit"]
    segs = {a["segment"] for a in audit}
    assert "Contract: Month-to-month" in segs
    for a in audit:
        assert a["n"] >= 100
        assert 0.5 < a["auc"] <= 1.0
        # calibration holds segment-wise within a few points
        assert abs(a["observed_churn"] - a["predicted_churn"]) < 0.05
