"""Report charts. Palette and rules follow the portfolio design system:
light paper surface, validated categorical inks (blue #3f5aa0 / gold
#8f6f1d), thin marks, recessive grid, direct labels over legend boxes."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from .data import TARGET, load
from .train import TrainResult

PAPER = "#F7F5EF"
INK = "#1c1a17"
DIM = "#5f5a51"
GRID = "#d9d4c8"
BLUE = "#3f5aa0"
GOLD = "#8f6f1d"


def _style(ax, title):
    ax.set_facecolor(PAPER)
    ax.figure.set_facecolor(PAPER)
    ax.set_title(title, color=INK, fontsize=11, loc="left", pad=12)
    ax.tick_params(colors=DIM, labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def churn_by_contract(out: Path) -> None:
    df = load()
    rate = df.groupby("Contract", observed=True)[TARGET].mean().reindex(
        ["Month-to-month", "One year", "Two year"]
    )
    fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=150)
    bars = ax.bar(rate.index, rate.values * 100, color=BLUE, width=0.55, zorder=3)
    for b, v in zip(bars, rate.values):
        ax.text(b.get_x() + b.get_width() / 2, v * 100 + 1, f"{v*100:.0f}%",
                ha="center", color=INK, fontsize=9, fontweight="bold")
    _style(ax, "Churn rate by contract type — the single loudest signal")
    ax.set_ylabel("churn rate (%)", color=DIM, fontsize=8)
    ax.set_ylim(0, 50)
    fig.tight_layout()
    fig.savefig(out, facecolor=PAPER)
    plt.close(fig)


def roc_chart(result: TrainResult, out: Path) -> None:
    fig, ax = plt.subplots(figsize=(5.4, 4.4), dpi=150)
    lr = list(zip(*result.roc["lr"]))
    gb = list(zip(*result.roc["gb"]))
    ax.plot(lr[0], lr[1], color=BLUE, linewidth=2, zorder=3)
    ax.plot(gb[0], gb[1], color=GOLD, linewidth=2, zorder=3)
    ax.plot([0, 1], [0, 1], color=GRID, linewidth=1, linestyle="--")
    m = result.metrics
    ax.text(0.42, 0.62, f"logistic regression\nAUC {m['lr']['auc']:.3f}",
            color=BLUE, fontsize=9, fontweight="bold")
    ax.text(0.6, 0.35, f"gradient boosting\nAUC {m['gb']['auc']:.3f}",
            color=GOLD, fontsize=9, fontweight="bold")
    _style(ax, "ROC — what gradient boosting buys over a readable model")
    ax.set_xlabel("false positive rate", color=DIM, fontsize=8)
    ax.set_ylabel("true positive rate", color=DIM, fontsize=8)
    fig.tight_layout()
    fig.savefig(out, facecolor=PAPER)
    plt.close(fig)


def calibration(result: TrainResult, out: Path) -> None:
    """Reliability diagram: do predicted probabilities mean what they say?"""
    import numpy as np
    from sklearn.calibration import calibration_curve

    fig, ax = plt.subplots(figsize=(5.4, 4.2), dpi=150)
    probs = {"logistic regression": (result.lr_test_prob, BLUE)}
    frac, mean = calibration_curve(result.y_test, result.lr_test_prob, n_bins=10)
    ax.plot(mean, frac, color=BLUE, linewidth=2, marker="o", markersize=4, zorder=3)
    ax.plot([0, 1], [0, 1], color=GRID, linewidth=1, linestyle="--")
    ax.text(0.55, 0.34, "perfectly calibrated", color=DIM, fontsize=8, rotation=38)
    _style(ax, "Calibration — predicted probability vs observed churn rate")
    ax.set_xlabel("predicted churn probability (bin mean)", color=DIM, fontsize=8)
    ax.set_ylabel("observed churn rate", color=DIM, fontsize=8)
    fig.tight_layout()
    fig.savefig(out, facecolor=PAPER)
    plt.close(fig)


def top_drivers(result: TrainResult, out: Path) -> None:
    rows = []
    for f in result.spec["features"]:
        if f["kind"] == "numeric":
            rows.append((f["name"], f["coef"]))
        else:
            for v in f["values"]:
                if v["coef"] != 0.0:
                    rows.append((f"{f['name']}: {v['value']}", v["coef"]))
    rows.sort(key=lambda r: abs(r[1]), reverse=True)
    top = rows[:10][::-1]
    labels = [r[0] for r in top]
    vals = [r[1] for r in top]
    fig, ax = plt.subplots(figsize=(6.8, 4.2), dpi=150)
    colors = [GOLD if v > 0 else BLUE for v in vals]
    ax.barh(labels, vals, color=colors, height=0.6, zorder=3)
    _style(ax, "Top drivers (log-odds) — gold pushes toward churn, blue away")
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    ax.grid(axis="y", visible=False)
    ax.axvline(0, color=GRID, linewidth=1)
    fig.tight_layout()
    fig.savefig(out, facecolor=PAPER)
    plt.close(fig)
