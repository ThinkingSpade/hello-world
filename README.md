# Conductor — data-pipeline reliability agent

When the nightly pipeline derails — schema drift, a join that quietly stops
matching, a file loaded twice — Conductor reads the run ledger, probes the
warehouse with real SQL, explains what broke in plain English with the
evidence quoted, and drafts the repair with a risk grade and a **rollback
staged up front**. And it rewrites nothing — not a task's SQL, not a row of
data — without a human yes. The gate is code, not convention.

Live replay demo: [hnguyen.dev/conductor](https://hnguyen.dev/conductor/)

## The incident loop

```
page ──▶ run (halts) ──▶ probe ──▶ diagnose ──▶ propose ──▶ HUMAN GATE ──▶ repair ──▶ re-run ──▶ verify
                                                               │
                                                               └── declined → stop, warehouse untouched
```

- **Run** — a real SQL pipeline (staging + facts) executes on SQLite with
  data-quality checks (`unique`, `not_null`, `row_count_min`) after every
  task. The first failed task or check is the incident.
- **Probe** — targeted evidence queries: schema introspection, null-rate
  by day, `typeof()` drift on join keys, the batch ledger.
- **Diagnose** — deterministic signature matching over the evidence
  (schema drift, key-format drift, duplicate load), with verbatim evidence
  lines as receipts. One deliberately hard case: the drift matcher uses
  *which column the task never referenced*, not string similarity — because
  `order_total` is closer to `order_ts` than to `total_amount`, and picking
  by similarity "fixes" the pipeline into summing timestamps.
- **Propose** — repairs come from templates: a one-line patch to a task's
  SQL, or a vetted repair script. Destructive repairs snapshot the table
  first, always, and carry a `high` risk grade.
- **The gate** — `approve_cb` is the only path to a rewrite. Decline and
  the run ends read-only; the tests assert the duplicate rows are still
  there afterward.
- **Verify** — the pipeline re-runs for real; green means every task
  rebuilt and every check passed.

## The demo is a real run

`conductor record --scenario dup-load` seeds a synthetic warehouse
(deterministic, openly synthetic data), injects the breakage, and runs the
actual agent end to end — the SQL executes, the data really breaks, and the
approved repair really fixes it. The demo player just replays the ledger.

```bash
pip install -e ".[dev]"
python -m pytest                      # 10 tests, fully offline, stdlib only
conductor scenarios                   # list the bundled derailments
conductor run --scenario schema-drift # you are the approval gate
conductor record --scenario null-join -o out.json
```

## Layout

```
conductor/           engine: warehouse.py (seed + breakages), pipeline.py
                     (SQL tasks + DQ checks + runner), signatures.py
                     (diagnoses + fix templates), agent.py (the gate), cli.py
conductor/ui/        the rail-yard replay player + recorded sessions
tests/               pytest suite (runs fully offline)
```
