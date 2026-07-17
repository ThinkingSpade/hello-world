---
name: verify
description: Build/launch/drive recipe for verifying Atlas (ops knowledge agent) end-to-end.
---

# Verifying Atlas

## Build & launch (demo mode — no external services)

```bash
pip install -e ".[dev]"
python -m atlas serve --port 8300   # run in background; ingests corpus on startup
```

Server is up when `curl -s localhost:8300/api/health` returns `"status":"ok"`
with `docs: 32, chunks: ~162` (15 md + 5 pdf + 7 csv + 5 images). CSVs over 100 rows are indexed as auto-summary + samples; the full table ships to the explorer.

Format spot-checks: a CloudHost SLA question must cite `reference` (pdf)
sources; "What port does auth-svc run on?" must cite `dataset` (csv); a
topology-diagram question must cite `diagram` and render a `.cite-thumb`
image in the citation card.

## Drive the surface

```bash
# cited answer — first citation should be rb-api-key-rotation
curl -s -X POST localhost:8300/api/ask -H 'Content-Type: application/json' \
  -d '{"question":"How do we rotate the API keys?"}'

# repeat with different casing — expect "cached": true
# off-corpus question (pizza/gibberish) — expect retrieved: 0, honest "couldn't find"
# validation probes: 2-char question → 422; GET /api/ask → 405; broken JSON → 422
```

CLI flow: `python -m atlas ask "How do we rotate the API keys?"` (prints
answer + Sources + latency line).

UI is two tabs: landing is THE DATA explorer (alert-history CSV renders as a table); ASK ATLAS holds the question box and map, and the ingest animation arms on first tab switch.

Browser: Playwright with the pre-installed chromium — pass
`executable_path="/opt/pw-browsers/chromium"` to `chromium.launch()`
(version-mismatched managed download is unavailable; do NOT run
`playwright install`). Type into `#q`, click `#go`, wait for `.cite`.

## Real Redis path

```bash
redis-server --port 6380 --daemonize yes --save ''
ATLAS_CACHE=redis REDIS_URL=redis://localhost:6380/0 python -m atlas ask "..."
# second identical ask must print "cache hit"; check: redis-cli -p 6380 keys 'atlas:*'
```

## Gotchas

- `pkill -f "atlas serve"` from a scripted shell kills the script itself
  (pattern matches its own command line) — use `pkill -f "[a]tlas serve"`.
- pgvector + Groq paths need docker compose / an API key; not verifiable in
  this sandbox (no docker daemon, no pgvector extension locally). Retrieval
  ranking, cache behavior, API contract, and UI are all verifiable offline.
- Retrieval quality checks: the 5 sample-chip questions on the UI each rank
  their obviously-correct document first; keep it that way after changes.
