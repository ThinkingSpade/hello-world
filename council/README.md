# Council

An evidence-gated audit workbench. Upload a case, and fifteen specialist
auditors go through it while the numbers are computed twice by two engines that
share no code. Everything runs in the browser. Nothing is uploaded anywhere.

The premise is narrow and, I think, correct: a language model is very good at
noticing what a analysis failed to consider, and completely unfit to be the
thing that decides what is true. So this application separates the two jobs. The
models argue. The engines compute. A person signs.

## What it does

1. **Ingest.** Parses `.xlsx`, `.csv`, `.tsv`, `.docx`, `.pptx`, `.pdf`, `.txt`
   and `.md` in the browser. Every extracted table cell and prose span keeps a
   precise locator — sheet, page, slide, paragraph, row, range — so any figure
   can be traced back to the cell it came from. Macros are never executed.
2. **Index.** Builds a deterministic hybrid retrieval index. The same corpus
   always produces the same vectors, so a retrieved citation is reproducible
   rather than merely plausible.
3. **Profile.** Measures what the data actually is: the grain, the keys that
   repeat, whether a repeated key is a duplicate or a split record, which
   numeric columns are flows and which are levels, and which periods are
   structurally incomplete. This is arithmetic, not inference — no model is
   consulted, because if the grain is wrong every number downstream is wrong.
4. **Compute.** Every figure is produced by SQL over SQLite-WASM *and*
   independently by a JavaScript reducer. If they disagree, the figure is
   blocked from becoming a claim.
5. **Convene.** Fifteen seats review the analysis, each with a different lens.
6. **Resolve.** Disagreement is settled by a fixed ladder — source quality, then
   formula reproducibility, then definition consistency, then a human. Never by
   counting votes.
7. **Sign.** Four gates, each a hard stop. The decision lens draws every signal
   the run produced converging on one verdict — derived from the gates, the
   reconciliation and the ledger, never written by a model. Then export a run
   bundle that replays the whole analysis without the source files, or
   re-executes it against them to prove the figures still hold.

## The design principles, and where each one lives

| Principle | Enforced in |
|---|---|
| Source files are evidence; model output is not | `claims.js` — an `observed` or `calculated` claim authored by a council seat is rejected |
| Models never do authoritative arithmetic | `calc.js` — a model emits a `CalcSpec`; only SQL and the reducer produce figures |
| No majority vote | `council.js` — a four-rung resolution ladder; agreement is recorded, never counted |
| The verdict is derived, never authored | `lens.js` — a pure function of the gates, the reconciliation results, the resolution outcomes and the ledger; no model writes it, and it is never stored |
| Every claim is typed | `claims.js` — seven types, each with its own validity invariants |
| Precise provenance on every fact | `claims.js` + `ingest.js` — file, sha256, locator, transformation, period, unit, run id |
| External research stays isolated | `council.js` + the quarantine panel — external items can only become `external_context`, and only after Gate 3 |
| Uploaded content is data, not instruction | `ingest.js` scans for injection; every model call wraps source text in an untrusted envelope |
| Human approval gates | Gates 1–4; nothing downstream of a pending gate executes |
| No hardcoded case | Every measure is derived from the approved contract at run time; expected figures live only in `verify/tests/fixtures/` |

## The seats

| Seat | Looks for |
|---|---|
| Data contract | grain, keys, split rows, partial periods |
| Math audit | independent recomputation and reconciliation deltas |
| Analytics audit | window fairness, denominators, seasonality, mix |
| Definition consistency | one metric meaning one thing everywhere |
| Causal inference | confounds, staggered rollout, mandated behaviour |
| Uncertainty & sensitivity | how far the conclusion moves under other defensible choices |
| Visualization integrity | axis truncation, window selection, chart-versus-claim mismatch |
| Narrative red team | the strongest counter-story |
| Story audit | does each headline actually follow from its evidence |
| Defensibility audit | the follow-up question that breaks each claim |
| Assumption ledger | implicit assumptions, surfaced and typed |
| Decision quality | owner, threshold, next step, reversibility |
| Executive communication | brevity, headline quality, leadership fit |
| External research | context and questions — quarantined, never evidence |
| Provenance & injection sentinel | provenance completeness, untrusted content |

## Running it

It is a static site with no build step.

```bash
python -m http.server 8000     # from the repository root
```

Then open <http://localhost:8000/council/>. Serving over HTTP is required — the
SQLite WebAssembly module and the sample case are fetched relative to the page.

Click **Load the sample case** to run end to end with no upload and no API key.

## Models

Optional. Without a key the council runs in a clearly-labelled dry-run mode that
produces deterministic findings derived from your actual corpus — real column
names, real counts, never invented numbers.

With a key, calls go straight from your browser to Anthropic or OpenAI. The key
is held in a module-local variable for the session: never written to storage,
never placed in a prompt body, never sent anywhere except the provider you
chose.

## Reproducibility

The run id is a hash of the file hashes, the approved data contract, and the
approved calculation specifications. Change any of them and the id changes.

- **Replay** re-renders every figure and chart from a run bundle alone, with no
  source files present.
- **Verify** re-executes every stored calculation against the original files and
  compares. That is the actual proof.

`verify/` holds an independent Python implementation of the same calculations
plus a pytest acceptance suite. Expected figures live in
`verify/tests/fixtures/` and nowhere else — not in the reference
implementation, not in the tests, and not in the application.

## Layout

```
council/
  index.html      app shell
  app.js          orchestration and the gate state machine
  theme.css       white-dominant surface and the motion system
  util.js         hashing, zip/inflate, formatting
  ingest.js       parsers for every supported format, plus injection scanning
  vector.js       deterministic hybrid retrieval
  contract.js     data contract profiler
  calc.js         SQL execution and independent reconciliation
  claims.js       the typed claim ledger
  council.js      the fifteen seats, providers, resolution ladder
  agents.js       the animated pixel bench
  converge.js     the shared drawing language for "several things become one"
  lens.js         the decision lens — every signal converging on the verdict
  ladder.js       the resolution ladder as a cascade, not a list
  viz.js          deterministic SVG charts
  report.js       run bundle, replay, verify, export
  demo/           self-contained synthetic sample case
  verify/         Python reference implementation and acceptance tests
  CONTRACT.md     the module interface contract
```
