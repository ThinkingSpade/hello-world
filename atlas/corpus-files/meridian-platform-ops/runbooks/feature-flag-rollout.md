---
id: rb-feature-flag-rollout
title: Staged Feature-Flag Rollout with Metric Gates
type: runbook
service: platform
tags: [feature-flags, rollout, canary]
updated: 2024-11-02
---

## Overview

All user-facing behavior changes at Meridian ship dark behind a flag in the
**feature-flags** service and roll out in stages: **1% → 10% → 50% → 100%**,
with a metric gate between each stage. This runbook covers executing a staged
rollout, the kill-switch procedure, and flag hygiene afterwards.

The percentages are deliberate: 1% catches crashes cheaply, 10% clears the
latency noise floor on payments-api, 50% surfaces cache and capacity effects.
Since INC-2408, any flag touching rate-limiter or edge-proxy behavior also
requires sign-off from Priya K. before the 10% stage (see *INC-2408 War Room
Transcript*).

## Preconditions

- Flag already exists in feature-flags with a kill switch (`enabled: false`
  must fully restore old behavior — verified in staging).
- Dashboard link for the flag's guardrail metrics attached to the rollout
  ticket: error rate, p99 latency, and one business metric for the surface.
- Rollout window Tuesday–Thursday 14:00–20:00 UTC; no advances during freezes.
- `flagctl` authenticated against prod (`flagctl auth login --env prod`).

## Steps

1. Record the baseline. Capture 30 minutes of guardrail metrics pre-rollout:

   ```shell
   promtool query instant http://prometheus.monitoring:9090 \
     'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="payments-api"}[30m])) by (le))'
   ```

2. Stage 1 — enable at 1%, sticky by tenant:

   ```shell
   flagctl set checkout-v2-routing --rollout 1 --bucket-by tenant_id \
     --reason "ROLL-812 stage 1" --actor huy.n
   ```

3. Gate 1 (soak 60 minutes). Advance only if ALL hold:
   - Error rate delta vs baseline < 0.1 percentage points.
   - p99 latency delta < 5%.
   - Zero new exception signatures in the service's error tracker.

4. Stage 2 — 10%:

   ```shell
   flagctl set checkout-v2-routing --rollout 10 --reason "ROLL-812 stage 2"
   ```

5. Gate 2 (soak 2 hours, include peak traffic). Same criteria, plus business
   metric within 2% of control. Compare cohorts, not wall-clock windows:

   ```shell
   flagctl cohort-compare checkout-v2-routing \
     --metric checkout_conversion --window 2h
   ```

6. Stage 3 — 50%, soak 24 hours including one full daily peak:

   ```shell
   flagctl set checkout-v2-routing --rollout 50 --reason "ROLL-812 stage 3"
   ```

7. Gate 3: same criteria, plus no capacity alerts (CPU, connection pools,
   cache hit rate on the affected services) during peak.

8. Stage 4 — 100%. Announce in #platform-changes before and after:

   ```shell
   flagctl set checkout-v2-routing --rollout 100 --reason "ROLL-812 GA"
   ```

### Kill switch

At any stage, if a gate fails or an alert fires, do not debug forward — kill
first, diagnose second:

```shell
flagctl kill checkout-v2-routing --reason "gate failure, see ROLL-812"
```

`flagctl kill` sets the flag to 0% and pins it; SDK clients converge within
30 seconds. If metrics do not recover within 5 minutes, the flag was not the
cause — start incident response instead of flapping the flag.

## Verification

- `flagctl get checkout-v2-routing` shows the intended rollout percentage and
  the audit trail lists every stage change with actor and reason.
- Guardrail dashboard annotated with each stage timestamp.
- After 100%: one full week of stability, then hygiene (below) is scheduled.

## Rollback

- Any stage → previous stage: `flagctl set <flag> --rollout <prev>` is safe at
  all times because stages are supersets by tenant bucketing.
- Full rollback is the kill switch. If old code paths have since been deleted,
  the kill switch is a lie — this is why hygiene matters.

## Flag hygiene

Two weeks after GA, remove the flag: delete the conditional code paths, then
archive the flag so stale SDK caches fail closed:

```shell
flagctl archive checkout-v2-routing --confirm
flagctl list --stale --older-than 90d   # monthly sweep, owner: platform
```

## Escalation

- Gate ambiguity (metrics moved but within thresholds): platform lead Huy N.
  decides; default is hold, not advance.
- Flags touching edge-proxy or rate-limiter: Priya K. (edge) must approve.
- Flags gating partner-facing behavior on partner-gateway: notify Marcus T.
  (integrations) one business day before stage 2.
