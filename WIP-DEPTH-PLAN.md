# WIP: depth round — resume runbook (delete this file in the final commit)

Session hit its usage limit mid-round (2026-07-19 ~18:10 UTC, resets 22:50 UTC).
The white-dominant palette conversion is DONE and committed (d9ca789). Eleven
depth agents were killed mid-flight. This file preserves the plan so the round
can be relaunched cleanly.

## Tree state at the WIP commit

- Partial, UNVERIFIED edits: `cue/` (+167 lines + new `fixtures/objection-storm.json`),
  `forge/` (+170), `helmsman/` (+166), `operator/` (+35), `armada/` (small).
  Cue and helmsman died at "write verification script" (implementation likely
  complete, unverified). Forge died mid-reducer edits, operator mid-CSS —
  assume broken until proven otherwise.
- Untouched by agents: abacus, oracle, atlas, churn, conductor, pulse.
- Done separately: README now lists all 11 demos; palette commit d9ca789.

## Relaunch protocol (one agent per project, parallel, each owns ONLY its dir)

Common rules for every agent: read the whole page (and its fixtures/engine)
first; a prior attempt may have left partial code — review it, keep what is
correct, finish and verify; match the page's exact code style; honest copy only
(fixture-replay pages must never claim live inference); new colors ONLY from
var(--pi-*) tokens or page-local vars (site is now white-dominant); respect
prefers-reduced-motion idioms; fonts >= 12px, tap targets >= 44px, AA contrast;
do NOT commit; do NOT touch shared/pixel.css or work.html.
Verification: serve repo root at http://localhost:8321
(`python3 -m http.server 8321 --directory /home/user/hello-world &`); Playwright
lives in the session scratchpad (chromium at /opt/pw-browsers/chromium — if the
scratchpad was reclaimed, `npm i playwright` in a fresh scratchpad dir); each
agent writes its own `verify-<name>.js`, asserts zero pageerrors, exercises the
new features end-to-end (all scenarios), screenshots end states, iterates until
clean, and reports line ranges + results.

## Per-project briefs (condensed)

1. CUE (cue/index.html, 973 lines pre-edit; fixtures pricing-discovery,
   renewal-save): (a) screen-history trail strip under .screen-context showing
   every screenEvent up to currentTime (page only shows latest; tagline
   promises screen-following); (b) coaching debrief inside recap window,
   computed from fixture only: adoption used/total + bar, median seconds
   suggestion->use (usedAt-at), per-suggestion outcome list w/ useEvidence
   quotes; (c) third fixture objection-storm.json (schema-exact: meta,
   duration, screenEvents, transcript, suggestions w/ usedAt+useEvidence,
   recap.talkListen sums 100, gaps referencing real turns/suggestions),
   registered in FIXTURES const (~L357). Timer idiom: generation +
   pendingTimers; renderers dedup on keys.

2. OPERATOR (operator/index.html, 1111 pre-edit; fixtures clean-booking,
   reschedule-conflict, ambiguous-handoff — 7 turns each): (a) make the static
   4-step pipeline (~L374-395) light per turn from latency{hear,think,speak}
   scaled by speed, frozen on pause, static under reduced motion; (b) call
   outcome card on finish computed from replayed state: intent/caller/need,
   confirmed slots from calendarState, confidence trajectory, mean/worst
   round-trip, verdict booked/rescheduled/handed-off; hides on
   restart/seek-back like handoff window; (c) fourth fixture
   after-hours-voicemail.json (7-8 turns, message taken + next-morning soft
   hold + handoff package) + picker button. Page builds HTML strings via
   icon() helper + innerHTML.

3. FORGE (forge/index.html, 1247 pre-edit; manifest fixtures/index.json;
   pure reducer deriveState(to) rebuilds world per tick): (a) node
   allocated-vs-capacity meters (CPU millicores + memory MiB) on cluster
   board, derived from slots fold; (b) sandbox lifetime lane window: per
   sandbox a bar allocated->freed (or now), cold/warm colored, oom tick,
   moving now-cursor, derived from events prefix; (c) third fixture
   timeout-eviction.json + manifest entry: 3 nodes/4 tasks/~20-24 events, one
   task killed at its timeoutSec by watchdog, classified (so postmortem
   counts it), freed, NOT rescheduled; event semantics must match reducer
   exactly (types allocated/rescheduled/lifecycle/oom/completed/freed/
   classified; monotonic atMs).

4. ARMADA (armada/index.html, 1309 pre-edit; frame-snapshot playback, 8-frame
   fixtures clean-day, degradation-drill; create() DOM builder — NOT
   innerHTML): (a) trend strips window: cumulative cost vs budget + per-frame
   failure counts (blocked/captcha/timeout) as small SVG step charts derived
   from frames[0..current], truncating on seek-back; (b) campaign filter chips
   on fleet board (All + per campaign, aria-pressed pattern), counts follow
   filter, inspector fallback sane, reset on fixture load; (c) living
   scheduler: per-campaign live tallies from current frame sessions joined to
   catalog ("2 running · 1 done"), dim idle campaigns, ramp subtitle carries
   current clock.

5. HELMSMAN (helmsman/index.html, 2195 pre-edit; sessions image-pull,
   oom-crashloop, rbac-denied, readiness-probe; diagnosis events carry
   .signature): (a) "signature library" window: entries for the 4 real
   fixture signature ids + 2-3 plausible unmatched (node-pressure eviction,
   pending-unschedulable, cert-expiry), each with id, one-liner, 2-4 evidence
   conditions; neutral at rest, matched entry highlights at diagnosis step
   (accent + matched chip + fixture confidence, conditions checked); resets
   correctly on seek-before-diagnosis/restart/session change; honest framing
   ("matched in this recording"); (b) postmortem markdown gains matched
   signature line w/ existing fallback style. Study applyStep (~L1499)
   diagnosis branch + reset paths.

6. CONDUCTOR (conductor/index.html, 1799; sessions dup-load, null-join,
   rollback-drill, schema-drift; real sql.js warehouse + guarded query lab):
   (a) postmortem markdown export button (parity w/ helmsman
   downloadPostmortem): same data as inline postmortem (diagnosis, proposal,
   gate stamps, check table pass/fail, row counts, resolution), Blob
   download, filename from fixture id, enabled only after completion, resets
   on change; (b) 3 starter-query chips per scenario that fill+run the lab:
   warehouse.sample_query + 2 authored per incident story (dup detection
   GROUP BY/HAVING; renamed-column staging query; orphan anti-join; restored
   vs snapshot counts) — MUST be validated against the real end-of-replay
   warehouse, SELECT-only single statement; (c) fix vestigial amountColumn
   ternary (~L602, both branches return "order_total").

7. PULSE (pulse/index.html, 2170; live public APIs, no fixtures): (a) FIX
   DISHONEST honesty strip (~L649) claiming "replaying recorded fixtures" —
   rewrite to the truth (live public feeds; failed wires fall back to last
   good local snapshot marked stale); check for other copies of the claim;
   (b) fourth wire: US average interest rate on Treasury securities
   (fiscaldata.treasury.gov /v2/accounting/od/avg_interest_rates, keyless;
   curl-verify fields + which security_type_desc row = honest "total
   interest-bearing debt" blended rate first): WIRES entry + chip +
   diagnostics + refresh-all + 6h interval + loadRates() w/ last-good-cache/
   stale path + evidence window (big number + ~13-month SVG line, source +
   fetched-at) + composeBrief clause w/ makeReceipt (formula documents the
   month-over-month materiality threshold) + snapshot model integration.

8. ABACUS (abacus/ index.html+engine.js; parity goldens UNTOUCHABLE): new
   investigation kind "concentration" (Pareto): parser phrasings
   ("how concentrated is revenue by customer", "pareto of units by product",
   "top customers share of revenue"); plan reuses schema (metric, one dim,
   time, filters); runAny dispatch + narrate fn in narrateRetention's voice
   with exact reconciling numbers; validateLLMPlan whitelists the kind;
   fourth shelf card + cumulative-share curve w/ 80% Pareto point marked +
   stat row (top-1/3/10% share, Pareto N); saved-analyses + #plan= share
   round-trip; BYO role guards (needs measure + categorical dim) with honest
   disabled note; update "how the demo works" 3->4; parity card copy stays
   scoped to its 35 goldens; add 1-2 boot assertions in runBootAssertions
   style. Verify parity still 35/35.

9. ORACLE (oracle/index.html, 3076; sessions microservices, p-vs-np,
   renewables-2035; computeVerdict ~L1971 computes P(yes) from recording):
   (a) counterfactual council in verdict section: per-agent exclude toggle,
   final-vote flip (via session vote_enum), confidence override slider,
   composing with existing weight sliders through the SAME verdict math;
   counterfactual P(yes) + delta + computed biggest-mover sentence;
   reset-all; derives agent list from session (works for imports); clearly
   labeled lens, never mutates recording; (b) "export debate" markdown:
   question, roster, per-round transcript w/ sourced markers, votes,
   computed verdict block w/ formula signals + hinge; active counterfactual
   goes in a separated appendix; Blob download, filename from session id.

10. ATLAS (atlas/ index.html+engine.js; hashing embedder honestly disclosed
    in health badges): (a) retrieval x-ray: thread ACTUAL per-chunk
    components (cosine, keyword overlap + matched words, title fuzz, blended
    score vs .28 floor) additively through retrieve() -> ask() citations; UI:
    expandable "why this source" per citation chip (three labeled meters ×
    weights .70/.30/.15, matched-keyword chips, floor line), keyboard
    accessible; works both corpora + all intents; no citations = no x-ray;
    ranker legend one-liner in answer card; (b) fix map-card overclaim
    "real vectors" (~L889) -> hashed bag-of-words vectors (the same ones the
    retriever scores) projected via PCA; align any other neural-implying
    copy with the hashing-js disclosure.

11. CHURN (churn/index.html, 2060; model.json coefficients + provenance
    holdout bitset are REAL): (a) replace hardcoded ROC SVG (~L538-553,
    literal "AUC 0.845") with ROC computed in-browser on held-out rows only;
    display computed AUC ("computed on N held-out customers just now");
    cross-check vs stored 0.845 within ~0.01 (investigate decode if off);
    label training-time vs browser-computed numbers honestly; (b) replace
    hardcoded top-drivers SVG (~L554-571) with chart derived from model.json
    coefficients (|coef| rank, signed bars, semantic colors, precise
    categorical labeling); (c) delete assets/*.png if grep proves them
    unreferenced repo-wide (check README + all pages first); (d) keep model
    card copy coherent. Also compute AUC independently in node as
    cross-check.

## After all agents report

1. Review every diff hunk myself; fix quality issues.
2. Full-site screenshot pass (all 11 pages + shell) via Playwright; zero
   pageerrors; check the white scheme still holds on new UI.
3. Update work.html blurbs ONLY where capabilities changed materially:
   pulse's feed list gains the Treasury average-interest wire; abacus's
   investigation enumeration gains concentration; mention new scenarios
   only if the existing sentences enumerate counts. Keep the human voice.
4. Delete this file. Final commit ("Depth round: ...") + push -u origin
   claude/project-depth-white-scheme-viw97d (retry w/ backoff on network
   failure only).
