---
id: dg-postgres-ha-topology
title: Postgres HA topology diagram
type: diagram
service: database
tags: [postgres, architecture, ha, diagram]
updated: 2024-10-02
---

## What the diagram shows

Architecture diagram of the Meridian Postgres high-availability topology.
Three application services — payments-api (12 pooled connections), auth-svc
(8), and search-indexer (6) — all connect through a single pgbouncer in
transaction pooling mode (pool of 40). pgbouncer sends writes and
synchronous reads to db-primary-2. db-primary-2 streams WAL to db-replica-1,
which stays under 5 seconds of lag. A third node, db-standby-3, applies WAL
on a 4-hour delay as fat-finger insurance: destructive DDL or a bad
migration can be recovered by promoting the delayed standby instead of a
full point-in-time restore.

## How to read it during an incident

Failover means promoting db-replica-1 and repointing the single pgbouncer
upstream entry — every application moves at once. If data was destroyed
rather than the primary lost, prefer the delayed standby path. Full steps:
see "Failing Over Postgres from db-primary-2 to the Streaming Replica" and
"Restoring Postgres from Backup with Point-in-Time Recovery".
