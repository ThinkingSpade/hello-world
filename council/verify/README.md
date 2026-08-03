# Acceptance harness

An independent Python implementation of the same calculations the browser
engine performs, plus a pytest suite that holds both to a fixed set of expected
values.

## Why a third implementation

The application already computes every figure twice — once in SQL over
SQLite-WASM, once in a JavaScript reducer that shares no code path with it. That
catches a mistake in either one. It does not catch a mistake in the *idea*,
because both run in the same process, written by the same hand, against the same
in-memory rows.

`reference.py` is written in another language, structured differently, and
arrives at the grain, the flow/stock split and the incomplete periods by its own
route. When it agrees, three independent implementations agree.

## Where expected figures live

**Only in `tests/fixtures/*.json`.** Not in `reference.py`, not in any test
file, and not in the application. A test says *how* a value is computed; the
fixture says *what* it should be. Keeping those apart is what makes this a check
rather than a restatement.

Each fixture entry carries its own definition and tolerance:

```json
{ "id": "headline_pages_yoy",
  "value": -0.184205,
  "tol": 5e-05,
  "unit": "ratio",
  "definition": "headline_pages_current / headline_pages_prior - 1" }
```

Every entry becomes its own test case, so a failure names the exact measure.

## Running it

```bash
pip install -r requirements.txt
COUNCIL_WORKBOOK=/path/to/workbook.xlsx pytest -q
```

Without `COUNCIL_WORKBOOK` the suite skips cleanly, so a checkout that does not
carry the source data still passes. The workbook is deliberately not committed:
the fixture holds expected values only, never the underlying records.

Inspect what the reference discovered:

```bash
python reference.py --workbook /path/to/workbook.xlsx --json
```

## What the suite covers

- **`test_acceptance.py`** — the data contract (grain, split records, flow/stock
  roles, incomplete periods) plus every acceptance value: matched-window
  comparisons, the units-to-capacity bridge, trailing cuts, per-segment and
  per-entity breakdowns, weeks of supply, price and cost-per-unit indices,
  event-time (staggered) alignment, and the overstatement that would result from
  folding a stock column by summing it.
- **`test_parity.py`** — runs the application's own JavaScript reducers under
  Node against the rows the Python reference produced, and requires the two
  languages to agree to 1e-9.

## Nothing here is dataset-specific

`reference.py` discovers the grain, demotes calendar labels that ride along with
a finer column, classifies numeric columns as flows or stocks from how their
segments behave, and detects incomplete periods from reporting coverage. Point
it at a different workbook of the same shape and it will profile that one
instead. The fixture is what ties a run to a particular case.
