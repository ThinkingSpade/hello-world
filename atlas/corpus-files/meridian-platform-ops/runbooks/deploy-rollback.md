---
id: rb-deploy-rollback
title: Rolling Back a Bad Production Deploy with Helm
type: runbook
service: platform
tags: [deploy, rollback, helm]
updated: 2024-10-21
---

## Overview

Meridian services deploy to the `meridian-prod` cluster via Helm charts released by the
CD pipeline. When a deploy causes elevated errors, latency, or crash loops, the fastest
safe remediation is `helm rollback` to the last known-good revision, with the pipeline
paused so CD does not immediately re-deploy the bad build. This runbook uses
`payments-api` as the example; the flow is identical for `auth-svc` and `search-indexer`.

## Preconditions

- `kubectl` and `helm` configured for the `meridian-prod` context
- You have identified the offending release (deploy annotations on the Grafana
  dashboard, or the CD pipeline's deploy log)
- The previous revision was healthy — check its deploy notes before assuming
- If the bad deploy included a database migration, STOP: schema changes may not be
  backward compatible. Consult the migration notes and, if data is affected,
  see: Restoring Postgres from backup.

## Steps

1. **Pause the CD pipeline first** so a rollback is not overwritten by auto-sync:

   ```shell
   curl -sS -X POST https://cd.meridian.internal/api/v1/pipelines/payments-api/pause \
     -H "Authorization: Bearer <CD_TOKEN>" -d '{"reason":"prod rollback in progress"}'
   ```

2. **Identify the target revision.** List release history and note the last revision
   with status `deployed` before the bad one:

   ```shell
   helm -n payments history payments-api --max 10
   ```

3. **Roll back to the known-good revision:**

   ```shell
   helm -n payments rollback payments-api <GOOD_REVISION> --wait --timeout 5m
   ```

   `--wait` blocks until pods pass readiness; if it times out, go to Rollback below.

4. **Watch the rollout converge:**

   ```shell
   kubectl -n payments rollout status deploy/payments-api --timeout=300s
   kubectl -n payments get pods -l app=payments-api -o wide
   ```

5. **Communicate status.** Post in `#meridian-incidents` with: service, bad revision,
   restored revision, user impact window, and that CD is paused. Update the incident
   ticket. Keep the pipeline paused until the offending change is reverted in git —
   pausing without a revert guarantees a repeat.

## Verification

- Error rate and p99 latency on the service dashboard return to pre-deploy baseline
  within 10 minutes.
- `helm -n payments status payments-api` shows the rolled-back revision as `deployed`.
- Smoke check the golden path:

  ```shell
  curl -sS -o /dev/null -w '%{http_code}\n' https://payments-api.meridian.internal/healthz
  curl -sS https://payments-api.meridian.internal/v1/charges/selftest | jq '.status'
  ```

- No crash-looping pods: `kubectl -n payments get pods | grep -v Running` is empty
  (aside from Completed jobs).

## Rollback

This runbook is itself the rollback path; if the helm rollback fails or the previous
revision is also unhealthy:

- Try one revision further back: `helm -n payments rollback payments-api <OLDER_REV>`.
- If the chart is wedged (`pending-rollback`), unlock it:

  ```shell
  helm -n payments rollback payments-api <GOOD_REVISION> --force --no-hooks
  ```

- As a last resort, scale to the last-good image manually with
  `kubectl set image deploy/payments-api payments-api=<GOOD_IMAGE>` and declare a SEV2.

## Escalation

- Rollback does not restore baseline within 15 minutes: escalate to SEV2 and page
  **platform-oncall** (see: On-Call Escalation Policy).
- Suspected schema/data incompatibility: page **db-oncall** before any further deploys.
- CD pipeline cannot be paused or keeps re-syncing: page the **release-eng** rotation
  and disable auto-sync at the cluster level as a stopgap.
