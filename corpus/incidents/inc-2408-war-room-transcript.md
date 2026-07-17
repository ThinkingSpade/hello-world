---
id: inc-2408-transcript
title: INC-2408 War Room Transcript
type: incident
service: edge
tags: [incident, transcript, war-room, payments]
updated: 2024-07-22
---

## War room transcript — #inc-2408 (2024-07-22 UTC)

**13:47 — pagerbot:** SEV triggered: `PaymentsApiErrorRateHigh` — payments-api 5xx rate 12% and climbing. Paging platform on-call.

**13:49 — huy.n:** ack, on it — error rate graph is near-vertical since 13:44. Declaring SEV1, I'm incident commander. This channel is the war room. Status page going to "investigating" for payments.

**13:50 — dana.r:** here. checking DB first since payments-api errors usually smell like the primary.

**13:51 — priya.k:** here. edge-proxy p99 looks normal, so it's not at the front door. Digging into rate-limiter.

**13:52 — marcus.t:** here. partner-gateway inbound is at ~6x normal volume from one partner. Pulling per-partner breakdown.

**13:53 — dana.r:** db-primary-2 is healthy — connections at 38% of max, `pg_stat_activity` clean, no lock pileup, replication to db-replica-1 at 0.4s lag. It's not the database.

**13:55 — huy.n:** ok, DB ruled out. payments-api pods are up, but 429s from rate-limiter are through the roof. priya what are you seeing?

**13:56 — priya.k:** rate-limiter global bucket is exhausted. But here's the weird part — the top consumer of the global bucket isn't the partner traffic.

**13:57 — marcus.t:** confirmed the volume spike is PartnerCo-Delta (anonymized in postmortem). Their client retries on 429 with zero backoff. Classic retry storm — every 429 we send generates another request.

**13:58 — priya.k:** got it. Look at this:

```shell
redis-cli -h rate-limiter-redis.edge.svc ZRANGE rl:global:consumers 0 5 REV WITHSCORES
1) "internal-healthcheck"   2) "412886"
3) "partner-delta"          4) "160204"
5) "checkout-web"           6) "31017"
```

**13:59 — priya.k:** the global limiter is counting **internal health checks**. 400k+ of the bucket is our own probes. The partner storm pushed us over the edge, but the headroom was already eaten by ourselves.

**14:00 — huy.n:** so the storm is the trigger, the health-check counting is the vulnerability. When did that behavior land?

**14:01 — priya.k:** this morning's partner-gateway deploy (09:40 UTC) changed the limiter middleware ordering — health checks now pass through the counting layer.

```shell
helm -n edge history partner-gateway | tail -2
83  Mon Jul 22 06:12:11 2024  superseded  partner-gateway-2.19.3
84  Mon Jul 22 09:40:47 2024  deployed    partner-gateway-2.20.0
```

**14:02 — huy.n:** proposal: roll partner-gateway back to revision 83 to stop counting health checks, separately get the partner to stop the storm. Objections?

**14:03 — dana.r:** checking the rollback for schema coupling first — 2.20.0 shipped with a migration flag. one minute.

**14:04 — marcus.t:** I've paged PartnerCo-Delta's NOC through the partner escalation path. Their retries are draining everyone's budget.

**14:05 — dana.r:** migration is additive-only, rollback is safe from the DB side. **Approved — roll back revision 84.**

**14:06 — huy.n:** executing rollback.

```shell
helm -n edge rollback partner-gateway 83 --wait --timeout 5m
```

**14:09 — huy.n:** rollback complete, all partner-gateway pods on 2.19.3.

**14:11 — priya.k:** health checks no longer incrementing the global bucket. But we're still degraded — the bucket is pinned by the retry storm alone now. 5xx down from 12% to 7%.

**14:13 — marcus.t:** partner NOC on the line. They confirmed a bad client release this morning, no backoff on 429. They're rolling it back but ETA is 30–40 min. We should not wait on them.

**14:15 — priya.k:** then let's fix it on our side: scope the limiter so partner-delta draws from its own bucket instead of the global one. Config change only, no code deploy.

**14:18 — priya.k:** diff for the record:

```yaml
# rate-limiter values, scoping change
buckets:
  global:
    exclude_sources: [internal-healthcheck]
  per_tenant:
    partner-delta:
      limit_rps: 200      # contracted rate
      overflow: reject    # do not spill into global
```

**14:21 — huy.n:** no objections from DB (dana) or integrations (marcus) on the bridge — approved, ship it.

**14:23 — priya.k:** `helm -n edge upgrade rate-limiter ./charts/rate-limiter -f values-prod.yaml --wait` running.

**14:26 — priya.k:** limiter scope fix is live. partner-delta is now bouncing off their own bucket, global bucket at 34% and falling.

**14:30 — huy.n:** payments-api 5xx back to baseline (0.2%) for 3 consecutive minutes, checkout success recovering on the business dashboard. Declaring recovery at 14:30 UTC. Status page to "monitoring".

**14:33 — dana.r:** DB metrics never flinched, for the record. db-standby-3 stayed in sync throughout.

**14:35 — huy.n:** thanks all — textbook. Handing off to post-mortem: I'll open the doc and schedule the review for Thursday. Timeline: impact 13:47–14:30 UTC, SEV1, trigger = partner retry storm, root vulnerability = global limiter counting internal health checks. Prevention themes: per-tenant limits by default, retry budgets in partner contracts and SDKs.

**14:36 — pagerbot:** SEV1 INC-2408 resolved after 43m. Post-mortem due 2024-07-29.

## Follow-ups

- [ ] Post-mortem doc and review meeting (owner: huy.n, due 2024-07-25)
- [x] Permanent limiter scoping: exclude internal health checks from all shared buckets (owner: priya.k)
- [ ] Per-tenant rate limits become the default for all partner keys, not opt-in (owner: priya.k)
- [ ] Retry budget requirement added to partner integration checklist and SDK defaults (owner: marcus.t)
- [ ] Alert on any single source consuming >25% of a shared limiter bucket (owner: priya.k)
- [ ] Middleware-ordering regression test for partner-gateway health-check path (owner: marcus.t)
- [ ] Update *Staged Feature-Flag Rollout with Metric Gates* to require edge sign-off for limiter-adjacent changes (owner: huy.n)
