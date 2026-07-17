---
id: inc-2024-03-redis-memory
title: Redis Memory Pressure Evicts Session Keys
type: incident
service: cache
tags: [redis, memory, outage]
updated: 2024-03-18
---

## Summary

SEV2, 2024-03-14. The shared Redis cluster backing session storage and the
feature-flag cache reached its 12 GiB `maxmemory` limit. With the eviction
policy set to `volatile-lru`, Redis could only evict keys that carried a TTL —
and once those were exhausted it began rejecting writes, while an emergency
policy flip to `allkeys-lru` then evicted live `session:*` keys. Roughly 30% of
active users were logged out over a 55-minute window. The underlying growth
came from an unbounded feature-flag cache whose keys were written without TTLs.

## Impact

- ~30% of active sessions invalidated; affected users forced to re-authenticate.
- auth-svc login throughput spiked to 4x baseline, briefly saturating its pool.
- payments-api checkout conversion dipped an estimated 8% during the window.
- No data loss: sessions are re-creatable and flags rehydrate from Postgres.

## Timeline

- 09:41 UTC — `redis-memory-used` crosses 95% on `cache-shard-1`; no alert
  exists at this threshold, so nothing fires.
- 10:02 UTC — Redis hits `maxmemory`; `OOM command not allowed` errors appear
  in auth-svc logs as session writes start failing.
- 10:09 UTC — On-call paged by the auth-svc error-rate alert; SEV2 declared.
- 10:17 UTC — `redis-cli INFO memory` shows `used_memory` pinned at the limit;
  `redis-cli --bigkeys` identifies `ff:*` (feature-flag) keys as ~7 GiB of the
  keyspace, none with TTLs.
- 10:24 UTC — Eviction policy flipped to `allkeys-lru` to restore writes;
  session keys begin to be evicted alongside flag keys (accepted trade-off).
- 10:31 UTC — Flag-cache writer hotfixed to set a 15-minute TTL; deploy rolls.
- 10:48 UTC — Bulk expiry applied to legacy flag keys:

```shell
redis-cli --scan --pattern 'ff:*' | xargs -L 500 redis-cli EXPIRE 900
```

- 10:57 UTC — Memory stabilizes at 64%; session eviction stops; SEV2 downgraded.
- 11:30 UTC — Incident closed after 30 minutes of stable memory and login rates.

## Root Cause

The feature-flag client library cached every flag evaluation result under a
per-user key (`ff:<flag>:<user_id>`) with no TTL and no key-count bound. Growth
was linear with active users and flag count. Because the eviction policy was
`volatile-lru`, these TTL-less keys were unevictable, so pressure fell entirely
on TTL'd keys until writes were refused. There was no alerting on Redis memory
utilization — only on client-side error rates, which fire too late.

## Resolution

- All flag-cache writes now set `EX 900`; a repair job expired legacy keys.
- Eviction policy set permanently to `allkeys-lru` on the shared cluster:

```shell
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG REWRITE
```

- Alerts added at 80% (warning) and 90% (page) of `maxmemory`.
- Session keys moved to a dedicated logical shard so cache-tier tenants cannot
  starve authentication state again.

## Action Items

- [x] Add TTLs to all feature-flag cache writes (owner: platform, done 03-14).
- [x] Set `allkeys-lru` and persist config on all shared shards (done 03-15).
- [x] Prometheus alerts on `redis_memory_used_bytes / maxmemory` (done 03-16).
- [ ] Split session storage onto a dedicated Redis cluster (owner: auth-svc).
- [ ] Add a keyspace-growth budget check to the cache client library.
- [ ] Load-test auth-svc login path at 5x baseline to validate pool sizing.
- [ ] Document cache eviction expectations in the on-call handbook; link the
      pod-triage flow in "Debugging a CrashLoopBackOff Pod" for consumers that
      crashloop when their cache dependency degrades.
