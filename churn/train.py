"""Train logistic regression (the shipped, explainable model) and gradient
boosting (the complexity benchmark) on a stratified train/test split."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score, brier_score_loss, roc_auc_score, roc_curve,
)
from sklearn.model_selection import cross_val_score, train_test_split

from .data import CATEGORICAL, NUMERIC, TARGET, load

SEED = 42


@dataclass
class TrainResult:
    spec: dict                      # the browser model: preprocessing + coefficients
    metrics: dict
    roc: dict                       # fpr/tpr for both models (for the chart)
    X_test: pd.DataFrame = field(repr=False, default=None)
    y_test: np.ndarray = field(repr=False, default=None)
    lr_test_prob: np.ndarray = field(repr=False, default=None)


def _design_matrix(df: pd.DataFrame, categories: dict[str, list[str]],
                   means: dict[str, float], stds: dict[str, float]) -> pd.DataFrame:
    """Explicit one-hot + standardization so every column maps 1:1 to a
    coefficient the browser (and a human) can read."""
    cols = {}
    for c in NUMERIC:
        cols[c] = (df[c] - means[c]) / stds[c]
    for c in CATEGORICAL:
        base = categories[c][0]  # first category is the baseline (coef 0)
        for v in categories[c][1:]:
            cols[f"{c}={v}"] = (df[c] == v).astype(float)
    return pd.DataFrame(cols, index=df.index)


def train(path=None) -> TrainResult:
    df = load(path) if path else load()
    y = df[TARGET].to_numpy()
    X_raw = df.drop(columns=[TARGET])

    train_raw, test_raw, y_train, y_test = train_test_split(
        X_raw, y, test_size=0.25, stratify=y, random_state=SEED
    )

    categories = {c: sorted(train_raw[c].unique().tolist()) for c in CATEGORICAL}
    means = {c: float(train_raw[c].mean()) for c in NUMERIC}
    stds = {c: float(train_raw[c].std()) or 1.0 for c in NUMERIC}

    X_train = _design_matrix(train_raw, categories, means, stds)
    X_test = _design_matrix(test_raw, categories, means, stds)

    lr = LogisticRegression(max_iter=2000, C=1.0, random_state=SEED)
    lr.fit(X_train, y_train)
    lr_prob = lr.predict_proba(X_test)[:, 1]

    gb = HistGradientBoostingClassifier(random_state=SEED)
    gb.fit(X_train, y_train)
    gb_prob = gb.predict_proba(X_test)[:, 1]

    cv_auc = cross_val_score(
        LogisticRegression(max_iter=2000, C=1.0, random_state=SEED),
        X_train, y_train, cv=5, scoring="roc_auc",
    )

    metrics = {
        "rows": int(len(df)),
        "churn_rate": round(float(y.mean()), 4),
        "test_size": int(len(y_test)),
        "lr": {
            "auc": round(float(roc_auc_score(y_test, lr_prob)), 4),
            "auc_cv_mean": round(float(cv_auc.mean()), 4),
            "auc_cv_std": round(float(cv_auc.std()), 4),
            "avg_precision": round(float(average_precision_score(y_test, lr_prob)), 4),
            "brier": round(float(brier_score_loss(y_test, lr_prob)), 4),
        },
        "gb": {
            "auc": round(float(roc_auc_score(y_test, gb_prob)), 4),
            "avg_precision": round(float(average_precision_score(y_test, gb_prob)), 4),
            "brier": round(float(brier_score_loss(y_test, gb_prob)), 4),
        },
    }

    features = []
    for c in NUMERIC:
        features.append({
            "name": c, "kind": "numeric",
            "mean": round(means[c], 6), "std": round(stds[c], 6),
            "coef": round(float(lr.coef_[0][list(X_train.columns).index(c)]), 6),
        })
    for c in CATEGORICAL:
        entries = [{"value": categories[c][0], "coef": 0.0}]
        for v in categories[c][1:]:
            idx = list(X_train.columns).index(f"{c}={v}")
            entries.append({"value": v, "coef": round(float(lr.coef_[0][idx]), 6)})
        features.append({
            "name": c, "kind": "categorical", "values": entries,
            "mode": str(train_raw[c].mode().iloc[0]),
        })

    audit = []
    for dim in ("Contract", "InternetService", "SeniorCitizen"):
        for val in categories[dim]:
            mask = (test_raw[dim] == val).to_numpy()
            n = int(mask.sum())
            if n < 100 or len(set(y_test[mask])) < 2:
                continue
            audit.append({
                "segment": f"{dim}: {val}",
                "n": n,
                "auc": round(float(roc_auc_score(y_test[mask], lr_prob[mask])), 3),
                "observed_churn": round(float(y_test[mask].mean()), 3),
                "predicted_churn": round(float(lr_prob[mask].mean()), 3),
            })

    spec = {
        "model": "logistic-regression",
        "audit": audit,
        "trained_on": "IBM Telco Customer Churn — 7,043 real customer records",
        "intercept": round(float(lr.intercept_[0]), 6),
        "features": features,
        "metrics": metrics,
    }

    lr_fpr, lr_tpr, _ = roc_curve(y_test, lr_prob)
    gb_fpr, gb_tpr, _ = roc_curve(y_test, gb_prob)
    roc = {
        "lr": [[round(float(a), 4), round(float(b), 4)] for a, b in zip(lr_fpr[::4], lr_tpr[::4])],
        "gb": [[round(float(a), 4), round(float(b), 4)] for a, b in zip(gb_fpr[::4], gb_tpr[::4])],
    }
    return TrainResult(spec=spec, metrics=metrics, roc=roc, X_test=test_raw,
                       y_test=y_test, lr_test_prob=lr_prob)


def save(result: TrainResult, out: str = "churn/ui/model.json") -> None:
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result.spec, f)


def save_rows(result: TrainResult, out: str = "churn/ui/rows.json") -> None:
    """All 7,043 real rows, columnar + code-compressed: every model feature
    (so the browser can explain any customer), the real customer IDs, and
    each row's exact model score (parity with sklearn by construction)."""
    from .data import DATA_FILE

    df = load()
    ids = pd.read_csv(DATA_FILE)["customerID"].tolist()
    cols: dict = {
        "tenure": [int(v) for v in df["tenure"]],
        "MonthlyCharges": [round(float(v), 1) for v in df["MonthlyCharges"]],
        "Churn": [int(v) for v in df[TARGET]],
    }
    for c in CATEGORICAL:
        values = sorted(df[c].unique().tolist())
        idx = {v: i for i, v in enumerate(values)}
        cols[c] = {"values": values, "codes": [idx[v] for v in df[c]]}

    # score the full dataset with the exported spec's own arithmetic
    spec = result.spec
    z = np.full(len(df), spec["intercept"])
    for f in spec["features"]:
        if f["kind"] == "numeric":
            z += f["coef"] * ((df[f["name"]].to_numpy() - f["mean"]) / f["std"])
        else:
            coefs = {v["value"]: v["coef"] for v in f["values"]}
            z += df[f["name"]].map(coefs).to_numpy()
    score = 1 / (1 + np.exp(-z))

    with open(out, "w", encoding="utf-8") as f:
        json.dump({
            "n": int(len(df)),
            "ids": ids,
            "score": [round(float(s), 4) for s in score],
            "cols": cols,
        }, f)
