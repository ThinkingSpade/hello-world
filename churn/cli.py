"""CLI: churn train — fit both models, export the browser spec + charts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="churn", description="Churn Radar")
    sub = parser.add_subparsers(dest="command", required=True)
    tr = sub.add_parser("train", help="train, evaluate, export model.json + charts")
    tr.add_argument("--out", default="churn/ui/model.json")
    tr.add_argument("--charts", default="assets")
    args = parser.parse_args(argv)

    if args.command == "train":
        from . import charts
        from .train import save, train

        from .train import save_rows

        result = train()
        save(result, args.out)
        save_rows(result, Path(args.out).parent / "rows.json")
        charts_dir = Path(args.charts)
        charts_dir.mkdir(parents=True, exist_ok=True)
        charts.churn_by_contract(charts_dir / "churn-by-contract.png")
        charts.roc_chart(result, charts_dir / "roc.png")
        charts.calibration(result, charts_dir / "calibration.png")
        charts.top_drivers(result, charts_dir / "top-drivers.png")
        print(json.dumps(result.metrics, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
