---
id: inc-2024-07-rate-limit
title: Global Rate Limiter Trips on Partner Retry Storm
type: incident
service: edge
tags: [rate-limiting, outage, api]
updated: 2024-07-25
---

## Summary

SEV1, 2024-07-22. A partner integration began retrying failed webhook
deliveries with no backoff, generating ~18k req/s against the edge gateway.
The global rate limiter absorbed the storm, but it was misconfigured to count
internal health checks and service-to-service calls in the same global bucket
as external traffic. When the bucket exhausted, the gateway returned 429s to
internal callers too — including the load balancer health checks for
payments-api, which was then marked unhealthy and drained. payments-api ran
below SLO for 43 minutes.

## Impact

- payments-api availability 91.2% over the window (SLO: 99.9%); 43 minutes of
  elevated 429/503 responses on checkout and refund endpoints.
- Approximately 6,100 payment attempts failed client-side; the majority
  succeeded on user retry, ~400 required manual reconciliation.
- auth-svc and search-indexer saw brief 429 spikes but stayed within SLO.
- One partner's webhook queue backed up ~2 hours; replayed after the fix.

## Timeline

- 13:47 UTC — `PaymentsApiErrorRateHigh` fires as partner retry traffic climbs
  to roughly six times normal volume; payments-api 5xx reaches 12%.
- 13:49 UTC — Huy N. declares SEV1 and assumes incident command.
- 13:53 UTC — Database health and replication are confirmed normal.
- 13:55 UTC — On-call confirms payments-api instances themselves are healthy:

```shell
kubectl -n payments get pods -l app=payments-api
curl -s http://payments-api.payments.svc.cluster.local:8080/healthz
```

- 13:59 UTC — The limiter is identified as the fault: internal health checks
  consume more of the global bucket than the offending partner.
- 14:05 UTC — Dana R. verifies the rollback is schema-safe and approves
  rolling partner-gateway back from revision 84 to 83:

```shell
helm -n edge rollback partner-gateway 83 --wait --timeout 5m
```

- 14:11 UTC — Rollback completes; health checks stop incrementing the global
  bucket, but the partner retry storm continues to degrade payments-api.
- 14:21 UTC — Huy N. approves the per-tenant limiter configuration change.
- 14:26 UTC — The scoped limiter is live; the global bucket falls to 34%.
- 14:30 UTC — payments-api 5xx remains at the 0.2% baseline for three minutes;
  Huy N. declares recovery and moves the status page to monitoring.
- 15:50 UTC — Partner ships a fix with exponential backoff; throttle lifted.

## Root Cause

Two compounding faults. First, the global rate limiter counted internal
traffic — health checks and service-to-service calls — against the same bucket
as external requests, so an external overload could starve internal control
traffic. Second, there were no per-tenant limits: a single partner could
consume the entire global budget. The partner's missing retry backoff was the
trigger, but the blast radius was a Meridian configuration defect.

## Resolution

- Limiter scoping fixed: internal CIDRs and health-check traffic are exempt
  from the global bucket and governed by a separate, generous internal bucket.
- Per-tenant token buckets deployed (default 200 req/s, burst 400), so one
  tenant can no longer exhaust shared capacity.
- Retry budgets added to the partner-facing API contract: clients receive
  `Retry-After` on 429 and keys are auto-throttled after sustained abuse.
- Load balancer health checks re-pointed directly at pod endpoints, bypassing
  the gateway entirely.

## Action Items

- [x] Exempt internal traffic from the global limiter bucket (done 07-22).
- [x] Ship per-tenant rate limits with sane defaults (done 07-24).
- [x] Health checks no longer routed through the edge gateway (done 07-23).
- [ ] Add a synthetic canary that alerts if internal calls ever receive 429
      from the edge (owner: edge team).
- [ ] Publish retry/backoff requirements in partner onboarding docs and
      enforce with a conformance test.
- [ ] Game-day exercise: replay this storm in staging at 2x volume.
- [ ] Review other gateway-shared failure domains, starting with TLS
      termination (see: "Renewing TLS certificates at the edge").
