---
id: rb-backup-restore
title: Restoring Postgres from Backup with Point-in-Time Recovery
type: runbook
service: database
tags: [backup, restore, postgres]
updated: 2024-10-02
---

## Overview

This runbook covers restoring the Meridian primary Postgres cluster (`db-primary-2`
and its replicas) from a base backup plus WAL archives, including point-in-time
recovery (PITR) to a target timestamp. Use it after data corruption, an accidental
destructive migration, or a failed failover. Cache-layer state is rebuilt separately;
for downstream effects on sessions see: "Redis Memory Pressure Evicts Session Keys".
Host names and Postgres 16 paths follow the canonical **Postgres HA architecture review
v2024-10-02**.

## Preconditions

- You are on the database on-call rotation and hold the `dba` role in Vault.
- `wal-g` is installed on the restore host and can reach the backup bucket.
- Application writes are frozen: payments-api and auth-svc are in maintenance mode.
- You have a target recovery timestamp agreed with the incident commander.
- Export credentials (never hardcode them):

```shell
export VAULT_TOKEN=<VAULT_TOKEN>
export WALG_S3_PREFIX=s3://meridian-db-backups/db-primary-2
export PGDATA=/var/lib/postgresql/16/main
```

## Steps

1. Locate the latest base backup and confirm WAL coverage extends past your target time:

```shell
wal-g backup-list --detail
wal-g wal-verify integrity timeline
```

2. Stop Postgres on the restore host and set aside the old data directory:

```shell
sudo systemctl stop postgresql@16-main
sudo mv "$PGDATA" "${PGDATA}.corrupt.$(date +%s)"
```

3. Fetch the base backup:

```shell
wal-g backup-fetch "$PGDATA" LATEST
```

4. Configure PITR — set the restore command, target timestamp, and recovery signal:

```shell
cat >> "$PGDATA/postgresql.auto.conf" <<'EOF'
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '2024-06-30 04:15:00 UTC'
recovery_target_action = 'pause'
EOF
touch "$PGDATA/recovery.signal"
```

5. Start Postgres and watch WAL replay progress:

```shell
sudo systemctl start postgresql@16-main
tail -f /var/log/postgresql/postgresql-16-main.log | grep -E 'restored|recovery'
```

6. When replay pauses at the target, confirm the recovery point before promoting:

```sql
SELECT pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();
```

7. Promote only after the Verification section below passes:

```sql
SELECT pg_wal_replay_resume();
SELECT pg_promote();
```

## Verification

Run these checks BEFORE switching any traffic back:

```sql
SELECT count(*) FROM payments.transactions WHERE created_at > now() - interval '1 day';
SELECT max(id), max(updated_at) FROM auth.sessions;
```

- Compare row counts against the pre-incident dashboard snapshot (±1% expected).
- Run the application smoke suite: `make smoke ENV=staging-restore`.
- Confirm replication slots recreate cleanly on both replicas.

## Rollback

If validation fails, do NOT promote. Stop Postgres, remove the fetched data
directory, and repeat from step 3 with an earlier base backup or a different
`recovery_target_time`. The original (corrupt) data directory preserved in step 2
must not be deleted until the incident is closed.

## Escalation

- Page `#db-oncall` (PagerDuty: database-primary) if WAL segments are missing.
- Escalate to the storage team if `wal-g backup-fetch` fails with checksum errors.
- Incident commander sign-off is required before pointing payments-api back at
  the restored primary.
