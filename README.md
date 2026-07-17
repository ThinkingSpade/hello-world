# Abacus — a data analyst you can interrogate

**No chatbox.** You build a question from the semantic layer's own pieces
— snap a metric card into the *measure* slot, drop dimension trays into
*group by*, click the time dial, toggle filter stamps — and the SQL
compiles **live** in a panel beside the board as you compose. Pull the
run lever and the query travels desk to desk through a pixel analytics
office. It doesn't just aggregate: a **Why did it move?** button on any
total runs a full driver decomposition (12+ compiled queries,
per-dimension contributions that partition the delta exactly, a
volume-vs-price split, a waterfall bridge); the reports shelf builds
**retention** cohorts and runs an **anomaly scan** (z-scores across a
seven-series watchlist over the window on the dial). A 125,000-row
e-commerce warehouse (openly synthetic, seeded, clock pinned to
2026-06-30) runs on SQLite-in-WebAssembly; a semantic layer defines every
metric once; a deterministic compiler is the only thing allowed to write
SQL — the board just hands it a plan object.

The bring-your-own-key LLM doesn't type into a box either: it **arranges
the cards on the board**, and you watch which tokens it picks land one by
one before the same guarded compiler runs.

Live demo: [hnguyen.dev/abacus](https://hnguyen.dev/abacus/)

## The architecture

```
question ──▶ planner ──▶ semantic layer ──▶ SQL compiler ──▶ SQLite (WASM) ──▶ chart + narration
              │                │
              │                └─ 11 metrics · 8 dimensions · join graph · pinned clock
              └─ keyless: deterministic parser (synonyms + time grammar)
                 BYO-key: a live LLM emits a JSON plan — validated against
                 the manifest, REJECTED if it names anything unknown.
                 Neither path ever writes raw SQL.
```

- **Semantic layer** (`semantics.py`) — metrics as data: expression, format,
  synonyms. `revenue` is `SUM(i.net_revenue)` exactly once, in one file,
  for both engines. Joins are pulled in only when something referenced
  needs them.
- **Deterministic planner** (`parser.py`) — longest-synonym matching, a
  time grammar (`last quarter`, `q4 2025`, `ytd`, `vs last year`), filter
  spotting from the value catalog, `top N`. Time words are stripped before
  dimension scanning so "last month" can't summon the month dimension.
- **Plan Board** (browser) — the semantic layer *is* the UI: metric
  cards, dimension trays, a time dial, filter stamps, compare toggles.
  Composing them builds a plan object; the compiler previews the SQL on
  every change. No free-text query path exists.
- **LLM planner** (browser, bring-your-own-key) — Anthropic or OpenAI,
  called directly from the visitor's browser (the key never touches a
  server). The model gets the manifest and must return a JSON plan, which
  is rendered as tokens landing on the board, validated key-by-key, and
  compiled by the same guarded compiler. A hallucinated metric is a
  rejected plan, not a creative query.

## The parity eval

35 golden questions are frozen by the Python engine — plans, SQL, and
result rows committed to the repo. The browser engine must reproduce all
35: **plans exactly, values to the cent**. The demo has a button that
runs the whole eval live in front of the visitor; pytest runs the same
goldens offline.

## The warehouse

`generate.py` builds it from one seed: 40k orders / 81k order items /
4.2k customers / 244 products across 2024→mid-2026, with seasonality
(Q4 peak, July lull), weekly cycle, YoY growth, mobile eating web's
share, VIP baskets, Black-Friday discounting, and category-dependent
return rates — so the answers have texture. Synthetic on purpose and
labeled as such; determinism is what makes the goldens possible.

```bash
pip install -e ".[dev]"
python -m pytest              # 50 tests: goldens, independent-SQL cross-checks,
                              # partition identities (drivers sum to the exact delta),
                              # waterfall reconciliation, retention invariants, determinism
abacus ask "margin % by category in 2025"
abacus eval                   # 35/35
abacus export                 # freeze the browser bundle (db + manifest + goldens)
```

## Layout

```
abacus/            generate.py · semantics.py · parser.py · analyst.py · engine.py · cli.py
abacus/goldens.py  the 30-question golden set
abacus/ui/         index.html (the desk) · engine.js (the JS twin) ·
                   vendor/ (sql.js, MIT) · data/ (warehouse + manifest + goldens)
tests/             pytest suite, fully offline
```
