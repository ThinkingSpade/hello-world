---
id: rb-postgres-failover
title: Failing Over Postgres from db-primary-2 to the Streaming Replica
type: runbook
service: database
tags: [postgres, failover, ha]
updated: 2024-10-02
---

## Overview

The canonical topology is **Postgres HA architecture review v2024-10-02**: Postgres 16
runs on `db-primary-2` with a streaming replica on `db-replica-1`. This runbook covers
a controlled failover: promoting `db-replica-1` to
primary, repointing pgbouncer, and rebuilding the old primary as a new replica. Expected
write downtime is 30–90 seconds. Use this for planned maintenance or when `db-primary-2`
is degraded but the replica is healthy. For data-loss scenarios, instead see: Restoring
Postgres from backup.

## Preconditions

- SSH access to `db-primary-2`, `db-replica-1`, and the `pgbouncer-*` hosts
- `postgres` OS user or equivalent sudo on both database hosts
- Replication lag under 5 MB (checked in step 1) — abort if lag is large or growing
- Incident channel open (`#inc-db-failover`) and **payments-api** on-call notified,
  since payments holds the longest-lived transactions
- A recent base backup exists (verify timestamp, do not assume)

## Steps

1. **Verify replication lag on the replica.** It must be near zero before promoting:

   ```sql
   -- on db-replica-1
   SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay,
          pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
   ```

   Abort if `replay_delay` exceeds a few seconds and is not shrinking.

2. **Fence the old primary.** Stop writes cleanly so the replica catches up fully:

   ```shell
   ssh db-primary-2 'sudo systemctl stop postgresql'
   ```

   If the host is unreachable, ensure it cannot come back as a rogue primary
   (power it off via the management console) before continuing.

3. **Promote the replica:**

   ```shell
   ssh db-replica-1 'sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main'
   ```

4. **Repoint pgbouncer at the new primary.** Update the host in `pgbouncer.ini` and
   reload without dropping pooled client connections:

   ```shell
   ssh pgbouncer-1 "sudo sed -i 's/db-primary-2/db-replica-1/' /etc/pgbouncer/pgbouncer.ini \
     && psql -p 6432 -U pgbouncer pgbouncer -c 'RELOAD;'"
   ```

   Repeat on `pgbouncer-2`. Then resume paused pools: `RESUME meridian_main;`

5. **Rebuild db-primary-2 as a replica** of the new primary using `pg_basebackup`:

   ```shell
   ssh db-primary-2 'sudo -u postgres bash -c "\
     rm -rf /var/lib/postgresql/16/main && \
     pg_basebackup -h db-replica-1 -D /var/lib/postgresql/16/main -U replicator -R -X stream -P"'
   ssh db-primary-2 'sudo systemctl start postgresql'
   ```

## Verification

- New primary accepts writes: `psql -h db-replica-1 -c "SELECT pg_is_in_recovery();"` → `f`
- Old primary streams as replica: same query on `db-primary-2` returns `t`, and
  `pg_stat_replication` on the new primary lists it with `state = 'streaming'`
- `payments-api` and `auth-svc` error rates return to baseline within 5 minutes
- pgbouncer `SHOW POOLS;` shows no stuck `cl_waiting` clients

## Rollback

There is no in-place rollback once the replica is promoted — the timelines have
diverged. To return to `db-primary-2` as primary, run this runbook again in the reverse
direction after replication is fully caught up. Never restart the old primary with its
pre-failover data directory while the new primary is serving writes.

## Escalation

- Replica will not promote or comes up read-only after 10 minutes: page **db-oncall**
  and escalate to SEV1 per the On-Call Escalation Policy.
- Split-brain suspected (both hosts accepting writes): stop pgbouncer immediately,
  page **db-oncall** and the incident commander; do not attempt repair alone.
- Application errors persist after verification passes: page **platform-oncall** to
  check connection-string caching in the service layer.
