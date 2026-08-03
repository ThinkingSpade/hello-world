"""Parity between the Python reference and the browser engine's JS reducers.

The application computes every figure twice already — SQL and a JavaScript
reducer — but both run in the same process. This test runs the *same* reducers
under Node against the *same* collapsed rows the Python reference produced, and
checks the two languages agree.

It is a narrower check than ``test_acceptance.py`` on purpose: acceptance tests
ask "is the number right", this asks "do the two engines that ship in the
product still agree with the reference". Both can fail independently, and
knowing which one did is most of the diagnosis.

Skips cleanly when Node is unavailable or when ``calc.js`` cannot be found.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import reference as R  # noqa: E402

CALC_JS = Path(__file__).resolve().parents[2] / "calc.js"
UTIL_JS = Path(__file__).resolve().parents[2] / "util.js"
WORKBOOK = R.workbook_path()
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    WORKBOOK is None or NODE is None or not CALC_JS.exists(),
    reason="needs Node, calc.js, and COUNCIL_WORKBOOK",
)

# calc.js imports util.js for its ids; the reducers themselves are pure, so we
# extract and evaluate just the reducer registrations rather than loading the
# whole module (which expects a browser and a WebAssembly build of SQLite).
HARNESS = r"""
import fs from "node:fs";
const src = fs.readFileSync(process.argv[2], "utf8");

// Collect the registered reducers without booting SQLite or the DOM.
const reducers = new Map();
const Calc = { registerReducer: (n, f) => reducers.set(n, f) };
const body = src.slice(src.indexOf("/* ---------- built-in reducers"));
new Function("Calc", body.replace(/^export\s+/gm, ""))(Calc);

const payload = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const out = {};
for (const c of payload.cases) {
  const fn = reducers.get(c.reducer);
  out[c.id] = fn ? fn(payload.rows, c.params, {}) : null;
}
process.stdout.write(JSON.stringify(out));
"""


def _rows_and_cases():
    engine, sheet, contract, _ = R.build(WORKBOOK)
    period_col = contract.period_col
    entity = next(d for d in contract.grain if d not in (period_col, engine.weight_dim))
    flow = next(c for c, r in contract.roles.items() if r == "flow")
    stock = next(c for c, r in contract.roles.items() if r == "stock")
    yield_col = next((c for c in engine.weights if c.lower() == "yield"), sorted(engine.weights)[0])

    rows = [
        {period_col: f.period, **f.dims, flow: f.measures.get(flow, 0), stock: f.measures.get(stock, 0)}
        for f in engine.facts
    ]

    last = engine.periods[-1]
    windows = {"full": (engine.periods[-16], last), "l4": engine.trailing(4), "l8": engine.trailing(8)}

    cases, expected = [], {}
    for name, (a, b) in windows.items():
        pa, pb = R.shift_days(a, -364), R.shift_days(b, -364)
        cases.append({
            "id": f"pages_{name}", "reducer": "ratio_of_windows",
            "params": {"col": flow, "dateCol": period_col,
                       "fromA": a, "toA": b, "fromB": pa, "toB": pb,
                       "weightKey": engine.weight_dim, "weights": engine.weights[yield_col],
                       "filters": []},
        })
        expected[f"pages_{name}"] = engine.matched(flow, a, b, weight=yield_col)[2]

        cases.append({
            "id": f"units_{name}", "reducer": "ratio_of_windows",
            "params": {"col": flow, "dateCol": period_col,
                       "fromA": a, "toA": b, "fromB": pa, "toB": pb, "filters": []},
        })
        expected[f"units_{name}"] = engine.matched(flow, a, b)[2]

    cases.append({
        "id": "stock_last", "reducer": "sum_where",
        "params": {"col": stock, "filters": [{"col": period_col, "op": "eq", "value": last}]},
    })
    expected["stock_last"] = engine.at(stock, last)

    ents = sorted({f.dims[entity] for f in engine.facts})
    cases.append({
        "id": "entities", "reducer": "distinct_count",
        "params": {"col": entity, "filters": []},
    })
    expected["entities"] = len(ents)
    return rows, cases, expected


def test_js_reducers_match_python_reference():
    rows, cases, expected = _rows_and_cases()
    with tempfile.TemporaryDirectory() as tmp:
        harness = Path(tmp) / "harness.mjs"
        payload = Path(tmp) / "payload.json"
        harness.write_text(HARNESS)
        payload.write_text(json.dumps({"rows": rows, "cases": cases}))
        proc = subprocess.run(
            [NODE, str(harness), str(CALC_JS), str(payload)],
            capture_output=True, text=True, timeout=120,
        )
    if proc.returncode != 0:
        pytest.skip(f"could not run the JS reducers under Node: {proc.stderr.strip()[:300]}")

    actual = json.loads(proc.stdout)
    mismatches = []
    for key, want in expected.items():
        got = actual.get(key)
        if want is None and got is None:
            continue
        if got is None or want is None:
            mismatches.append(f"{key}: python {want!r}, js {got!r}")
            continue
        if abs(got - want) > max(1e-9, 1e-9 * abs(want)):
            mismatches.append(f"{key}: python {want!r}, js {got!r}")
    assert not mismatches, "JS reducers disagree with the Python reference:\n  " + "\n  ".join(mismatches)
