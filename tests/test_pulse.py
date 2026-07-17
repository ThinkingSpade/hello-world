import json
import subprocess
import sys
from pathlib import Path

import pytest

from pulse.brief import compose, debt_stats, fx_stats
from pulse.cli import offline_get
from pulse.feeds import FeedDown, debt_series, fetch_all, fx_range, worldbank

FIX = str(Path(__file__).parent / "fixtures")
GET = offline_get(FIX)


def data():
    return fetch_all(fx_start="2026-04-13", debt_since="2025-07-10", get=GET)


def test_fx_parse_and_alignment():
    fx = fx_range("2026-04-13", get=GET)
    n = len(fx["dates"])
    assert n > 40 and all(len(v) == n for v in fx["series"].values())
    assert fx["dates"] == sorted(fx["dates"])


def test_fx_stats_direction():
    s = fx_stats(fx_range("2026-04-13", get=GET))
    assert set(s["moves"]) == {"EUR", "GBP", "JPY", "MXN", "CNY", "CAD"}
    assert s["moves"][s["strongest"]] >= s["moves"][s["weakest"]]


def test_debt_math_adds_up():
    rows = debt_series("2025-07-10", get=GET)
    d = debt_stats(rows, population=334914895)
    assert d["latest"] == rows[-1]["total"]
    assert d["delta"] == pytest.approx(rows[-1]["total"] - rows[0]["total"])
    # per_second × window seconds reconstructs the delta
    assert d["per_second"] * d["window_days"] * 86400 == pytest.approx(d["delta"], rel=1e-4)
    assert d["per_capita"] == pytest.approx(d["latest"] / 334914895, rel=1e-6)


def test_worldbank_latest_values():
    g = worldbank("NY.GDP.MKTP.KD.ZG", get=GET)
    assert g["United States"]["value"] == 2.8
    assert g["World"]["year"] == "2024"


def test_compose_full_brief_cites_windows():
    lines = compose(data())
    text = "\n".join(lines)
    assert "2026-04-13 → 2026-07-10" in text            # FX window named
    assert "as of 2026-07-09" in text                    # debt as-of named
    assert "World Bank annuals, 2024" in text            # annuals labeled by year
    assert "3 of 3 sources answering" in text


def test_down_wire_is_reported_not_invented():
    def broken(url):
        if "frankfurter" in url:
            raise OSError("connection refused")
        return GET(url)
    d = fetch_all(fx_start="2026-04-13", debt_since="2025-07-10", get=broken)
    assert "error" in d["fx"]
    lines = compose(d)
    text = "\n".join(lines)
    assert "FX wire is down" in text
    assert "2 of 3 sources answering" in text
    assert "%" not in lines[0]        # no FX numbers were fabricated


def test_feed_down_raises_cleanly():
    with pytest.raises(FeedDown):
        fx_range("2026-04-13", get=lambda url: {"rates": {}})


def test_deterministic():
    assert compose(data()) == compose(data())


def test_cli_offline():
    r = subprocess.run(
        [sys.executable, "-m", "pulse", "brief", "--offline", FIX],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "US federal debt" in r.stdout and "every second" in r.stdout


def test_cli_json_offline():
    r = subprocess.run(
        [sys.executable, "-m", "pulse", "json", "--offline", FIX],
        capture_output=True, text=True,
    )
    assert r.returncode == 0
    d = json.loads(r.stdout)
    assert {"fx", "debt", "gdp", "cpi", "pop"} <= set(d)
