# Pulse — the morning brief that writes itself

A business dashboard with **no database, no server, and no stale numbers**:
when you open [hnguyen.dev/pulse](https://hnguyen.dev/pulse/), your browser
fetches live data straight from free public feeds, charts it, and composes
the day's plain-English brief on the spot — every claim traceable to a wire,
every wire visibly up or down.

## The wires (all keyless, all CORS-open, fetched client-side)

| Wire | What | Cadence |
|---|---|---|
| [Frankfurter](https://frankfurter.dev) | ECB reference FX rates (EUR, GBP, JPY, MXN, CNY, CAD per USD), with history | daily (business days) |
| [US Treasury Fiscal Data](https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny) | Debt to the Penny — total public debt outstanding, daily ledger | daily (business days) |
| [World Bank Open Data](https://data.worldbank.org) | GDP growth, CPI inflation, population — latest annuals, labeled by year | yearly |

## What gets computed (not fetched)

- **Dollar scoreboard** — % change of USD against each currency over the
  window; strongest/weakest called out.
- **Debt pace** — the 1-year delta turned into $/day and $/second; the hero
  number ticks between daily Treasury postings at the observed pace, clearly
  labeled as extrapolation.
- **Per-resident debt** — latest total over World Bank population (year labeled).
- **The brief** — templates plus arithmetic, composed in the browser.
  No model, no tokens, deterministic given the same numbers.

## Honesty rules

- A down wire is reported down — the page never invents, caches, or proxies
  a number. Each card names its source, endpoint, and fetch time.
- Annual World Bank figures are labeled with their year; the debt
  extrapolation is labeled as extrapolation.

## The same engine as a CLI

```bash
pip install -e ".[dev]"
pulse brief                        # live: hits the same three feeds
pulse brief --offline tests/fixtures   # replay recorded responses
python -m pytest                   # 10 tests, fully offline
```

`pulse/feeds.py` (stdlib fetchers, injectable transport), `pulse/brief.py`
(the composer — the ground truth for the math the page's JS mirrors).

## Layout

```
pulse/            feeds.py, brief.py, cli.py — stdlib only
pulse/ui/         the live page (vanilla JS + hand-rolled SVG charts)
tests/            pytest suite with recorded fixture responses
```
