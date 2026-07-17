---
id: fx-rotate
title: Rotating widget API keys
type: runbook
service: platform
tags: [secrets, rotation]
updated: 2024-01-01
---

## Overview

How to rotate the widget API keys without downtime.

## Steps

1. Generate a new key in the secrets manager and note its id.

```bash
vault kv put secret/widget/api-key value=<NEW_KEY>
```

2. Deploy consumers with both old and new keys accepted during the grace window.

3. Revoke the old key after the grace window and verify no service still sends it.

## Verification

Check the auth logs for any request still using the old key id.
