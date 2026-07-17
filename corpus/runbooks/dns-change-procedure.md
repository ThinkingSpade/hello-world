---
id: rb-dns-change
title: Production DNS Change Procedure
type: runbook
service: edge
tags: [dns, ttl, change-management]
updated: 2024-07-29
---

## Overview

This runbook covers safe production DNS changes for Meridian zones
(`meridian.example`, `api.meridian.example`): lowering TTLs ahead of time,
staged cutover, and validation from multiple resolvers.

Two rules are non-negotiable:

1. **TTL comes down before the record changes, never at the same time.** A
   change under the old TTL takes the full old TTL to converge, or longer.
2. **DNS is never used for database failover.** See the section at the end —
   an operational lesson from 2023 and a standing SOC2 audit note.

DNS changes ride change management: ticket, edge-team approver, scheduled window.

## Preconditions

- Approved change ticket (CHG-xxxx) naming records, values, rollback criteria.
- `dnsctl` access to the production zone with change-ticket enforcement on.
- New target already serving correctly when addressed directly (`curl --resolve`).
- TTL prep done in advance: for standard 3600s records, lower TTL to 60s
  **at least 24 hours before** the cutover window.

## Steps

1. T-24h (or earlier) — lower the TTL only. Do not touch the record value.

   ```shell
   dnsctl record update --zone api.meridian.example \
     --name gateway --type A --ttl 60 --ticket CHG-1742
   dnsctl record show --zone api.meridian.example --name gateway
   ```

2. T-1h — verify the low TTL propagated across public and internal resolvers:

   ```shell
   for r in 1.1.1.1 8.8.8.8 9.9.9.9 10.0.0.53; do
     dig +noall +answer @$r gateway.api.meridian.example A
   done
   ```

   Every answer must show TTL ≤ 60; if not, prep was too short — reschedule.

3. T-0 — pre-flight the new target directly, bypassing DNS:

   ```shell
   curl -sS --resolve gateway.api.meridian.example:443:203.0.113.40 \
     https://gateway.api.meridian.example/healthz
   ```

4. Cutover — change the record value, keeping TTL at 60 for now:

   ```shell
   dnsctl record update --zone api.meridian.example \
     --name gateway --type A --value 203.0.113.40 --ttl 60 --ticket CHG-1742
   ```

5. Watch traffic shift on the edge-proxy dashboard. With a 60s TTL, expect
   ~90% on the new target within 3–5 minutes; TTL-ignoring clients persist
   for hours. Keep the old target serving until the tail is < 0.5%.

6. Validate from multiple vantage points, not just your laptop:

   ```shell
   for r in 1.1.1.1 8.8.8.8 9.9.9.9 10.0.0.53; do
     dig +short @$r gateway.api.meridian.example A
   done
   kubectl -n edge exec deploy/edge-proxy -- \
     getent hosts gateway.api.meridian.example
   ```

7. T+24h — once soaked, restore the standard TTL:

   ```shell
   dnsctl record update --zone api.meridian.example \
     --name gateway --type A --ttl 3600 --ticket CHG-1742
   ```

## Verification

- All sampled resolvers return the new value.
- edge-proxy and partner-gateway logs show no NXDOMAIN or connection errors
  against the old address after the tail drains.
- Certificate at the new target matches via `openssl s_client -servername`.
- Change ticket updated with the propagation graph screenshot.

## Rollback

Because TTL is still 60 during the soak, rollback is a single record update
and converges in minutes — this is why step 7 waits 24 hours: **never restore
the long TTL until you are sure you will not roll back.** After the long TTL
is restored, rollback takes up to an hour — treat that as an incident.

## Why DNS is never used for database failover

In March 2023 an early failover design "failed over" by repointing the
`db-primary.meridian.internal` CNAME from db-primary-2 to db-standby-3.
Cached resolution in long-lived connection pools kept a third of
billing-worker instances writing to the old primary for 47 minutes; the
split-brain took Dana R.'s team two days to reconcile from db-replica-1 WAL
archives.

Consequences, still in force:

- Database failover uses the connection-layer proxy (pgbouncer + virtual
  IP), never DNS. SOC2 recorded this as a formal control note (FY2023,
  control CC7.2 observation 4); changing the mechanism requires re-audit.
- The `db-*.meridian.internal` records are locked in dnsctl with
  `--change-policy deny`; any modification attempt pages the edge on-call.
- Failover procedure lives with the database team (Dana R.).

## Escalation

- Edge on-call first; record owner Priya K.
- Partner allow-listed IPs affected: coordinate with Marcus T. — partners
  pin IPs more often than they admit.
- Anything touching `db-*.meridian.internal`: stop, page Dana R., cite the
  SOC2 note.
