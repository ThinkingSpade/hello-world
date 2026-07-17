"""CLI: pulse brief [--offline DIR] | pulse json [--offline DIR]

Live mode hits the same three public, keyless feeds the web page uses.
Offline mode replays recorded fixture responses through the identical
parse + compose path — that's what the test suite runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

from .brief import compose
from .feeds import fetch_all

FIXTURE_URLS = {
    "frankfurter": "fx.json",
    "debt_to_penny": "debt.json",
    "NY.GDP.MKTP.KD.ZG": "gdp.json",
    "FP.CPI.TOTL.ZG": "cpi.json",
    "SP.POP.TOTL": "pop.json",
}


def offline_get(fixture_dir: str):
    def get(url: str):
        for marker, fname in FIXTURE_URLS.items():
            if marker in url:
                return json.loads((Path(fixture_dir) / fname).read_text())
        raise KeyError(f"no fixture for {url}")
    return get


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="pulse", description="Pulse — the morning macro brief that writes itself")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("brief", "json"):
        p = sub.add_parser(name)
        p.add_argument("--offline", metavar="DIR", default=None,
                       help="replay recorded fixture responses instead of the network")
        p.add_argument("--days", type=int, default=90, help="FX window (days)")
    args = parser.parse_args(argv)

    get = offline_get(args.offline) if args.offline else None
    today = date.today()
    data = fetch_all(fx_start=str(today - timedelta(days=args.days)),
                     debt_since=str(today - timedelta(days=370)), get=get)

    if args.command == "json":
        print(json.dumps(data, indent=1))
        return 0

    print("PULSE — the morning brief")
    print("=" * 60)
    for line in compose(data):
        print("• " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
