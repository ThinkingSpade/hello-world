"""Feed fetchers — free, keyless, public sources; stdlib only.

Every fetcher takes an optional `get` callable (url -> parsed JSON) so the
whole engine runs offline against recorded fixtures — that's how the tests
work and how `pulse brief --offline` demos without a network. The live
`get` is a thin urllib wrapper with a timeout; failures raise FeedDown and
the composer degrades honestly instead of inventing numbers.
"""

from __future__ import annotations

import json
import urllib.request

FX_SYMBOLS = ["EUR", "GBP", "JPY", "MXN", "CNY", "CAD"]
UA = {"User-Agent": "pulse-briefing/0.1 (+https://hnguyen.dev/pulse/)"}

SOURCES = {
    "fx": "Frankfurter (ECB reference rates)",
    "debt": "US Treasury Fiscal Data — Debt to the Penny",
    "wb": "World Bank Open Data",
}


class FeedDown(Exception):
    def __init__(self, feed: str, why: str):
        self.feed = feed
        super().__init__(f"{feed}: {why}")


def http_get(url: str, timeout: int = 12):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(get, feed: str, url: str):
    try:
        return (get or http_get)(url)
    except Exception as e:                    # noqa: BLE001 — any transport error
        raise FeedDown(feed, str(e)) from e


# ---------------------------------------------------------------- FX (ECB)
def fx_range(start: str, end: str = "", get=None) -> dict:
    """Daily USD-base rates from `start` (ISO date) to `end`/latest.
    Returns {"dates": [...], "series": {sym: [rate...]}} aligned lists."""
    url = (f"https://api.frankfurter.dev/v1/{start}..{end}"
           f"?base=USD&symbols={','.join(FX_SYMBOLS)}")
    raw = _get(get, "fx", url)
    dates = sorted(raw.get("rates", {}))
    if not dates:
        raise FeedDown("fx", "empty rate series")
    series = {s: [raw["rates"][d].get(s) for d in dates] for s in FX_SYMBOLS}
    return {"dates": dates, "series": series, "base": "USD"}


# ------------------------------------------------- US Treasury (fiscal data)
def debt_series(since: str, get=None) -> list[dict]:
    """Daily total public debt outstanding since `since` (ISO date)."""
    url = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
           "/v2/accounting/od/debt_to_penny"
           f"?fields=record_date,tot_pub_debt_out_amt"
           f"&filter=record_date:gte:{since}&sort=record_date&page[size]=500")
    raw = _get(get, "debt", url)
    rows = [{"date": r["record_date"], "total": float(r["tot_pub_debt_out_amt"])}
            for r in raw.get("data", []) if r.get("tot_pub_debt_out_amt")]
    if len(rows) < 2:
        raise FeedDown("debt", "not enough rows to compute a pace")
    return rows


# --------------------------------------------------------------- World Bank
def worldbank(indicator: str, countries: str = "USA;CHN;DEU;WLD", get=None) -> dict:
    """Most recent non-empty annual value per country for one indicator.
    Returns {country_name: {"year": "2024", "value": 2.8}}."""
    url = (f"https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}"
           f"?format=json&mrnev=1&per_page=20")
    raw = _get(get, "wb", url)
    if not isinstance(raw, list) or len(raw) < 2 or not raw[1]:
        raise FeedDown("wb", "unexpected response shape")
    out = {}
    for row in raw[1]:
        if row.get("value") is None:
            continue
        out[row["country"]["value"]] = {"year": row["date"],
                                        "value": round(float(row["value"]), 2)}
    if not out:
        raise FeedDown("wb", "no values returned")
    return out


def fetch_all(fx_start: str, debt_since: str, get=None) -> dict:
    """Fetch every wire independently; a down feed becomes {"error": ...}
    instead of sinking the whole briefing."""
    out = {}
    for key, fn in [
        ("fx", lambda: fx_range(fx_start, get=get)),
        ("debt", lambda: debt_series(debt_since, get=get)),
        ("gdp", lambda: worldbank("NY.GDP.MKTP.KD.ZG", get=get)),
        ("cpi", lambda: worldbank("FP.CPI.TOTL.ZG", get=get)),
        ("pop", lambda: worldbank("SP.POP.TOTL", countries="USA", get=get)),
    ]:
        try:
            out[key] = fn()
        except FeedDown as e:
            out[key] = {"error": str(e)}
    return out
