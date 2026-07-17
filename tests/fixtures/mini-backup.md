---
id: fx-backup
title: Restoring the widget database from backup
type: runbook
service: database
tags: [backup, restore]
updated: 2024-02-02
---

## Overview

Point-in-time recovery for the widget database.

## Steps

1. Locate the newest base backup and the WAL archive segments.

```bash
wal-g backup-list
```

2. Restore to the recovery host and replay WAL to the target timestamp.

3. Validate row counts before switching traffic to the restored database.

## Verification

Compare table counts against the last known-good report.
