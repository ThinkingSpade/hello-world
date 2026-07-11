---
id: rb-vault-unseal
title: Unsealing Vault After a Restart
type: runbook
service: security
tags: [vault, unseal, secrets]
updated: 2024-08-19
---

## Overview

Meridian runs a 3-node Vault cluster (`vault-0/1/2` in namespace `security`)
with Shamir key sharing: **5 key shares, threshold 3**. Any restart — node
reboot, pod reschedule, or Vault upgrade — leaves the affected node sealed.
While a node is sealed it serves no secrets; if the whole cluster is sealed,
services that fetch dynamic credentials at startup (payments-api, auth-svc,
billing-worker) will fail their init containers and crash-loop.

Key share holders of record: Huy N., Dana R., Priya K., Marcus T., and the
security escrow share held in the offline safe. Three of the five must submit
their share to unseal each node.

This runbook covers unsealing, verifying seal status, audit log continuity,
and what to do when a share holder is unreachable.

## Preconditions

- `kubectl` access to the `prod-security` cluster, namespace `security`.
- `VAULT_ADDR` pointed at the node being unsealed, not the load balancer —
  unsealing is per-node.
- At least three share holders reachable (see Escalation if not).
- Never paste a key share into Slack, a ticket, or a shared terminal.
  Shares are entered interactively and never appear as command arguments.

## Steps

1. Identify which nodes are sealed.

   ```shell
   for i in 0 1 2; do
     kubectl -n security exec vault-$i -- vault status -format=json \
       | jq -r '"vault-'$i' sealed=\(.sealed) ha_mode=\(.ha_mode // "n/a")"'
   done
   ```

2. Announce in #security-oncall which node(s) you are unsealing and page the
   share holders. Each holder runs the unseal against the **same node** —
   coordinate the target explicitly.

3. Each share holder, one at a time, port-forwards and submits their share
   interactively (Vault prompts; the share never appears in shell history):

   ```shell
   kubectl -n security port-forward vault-0 8200:8200 &
   export VAULT_ADDR=https://127.0.0.1:8200
   vault operator unseal
   ```

4. Watch progress between submissions. `Unseal Progress 2/3` means one more
   share is required.

   ```shell
   vault status
   ```

5. Repeat steps 3–4 for each remaining sealed node. After a full-cluster
   outage, unseal `vault-0` first, confirm it becomes active, then unseal the
   standbys.

6. Confirm HA leadership settled and standbys are healthy.

   ```shell
   vault operator raft list-peers
   vault read sys/health -format=json
   ```

7. Verify audit log continuity. There must be a `seal` event followed by an
   `unseal` completion with no gap in request IDs longer than the outage
   window. A gap suggests the audit device failed to re-enable — treat that as
   a security incident.

   ```shell
   kubectl -n security exec vault-0 -- \
     tail -n 50 /vault/audit/audit.log | jq -r '.time + " " + .type'
   vault audit list -detailed
   ```

8. Re-run the smoke check with a scoped token — do not use root:

   ```shell
   VAULT_TOKEN=<VAULT_TOKEN> vault kv get secret/smoke-test/canary
   ```

## Verification

- `vault status` on all three nodes shows `Sealed: false`.
- Exactly one node reports `HA Mode: active`; the others report `standby`.
- Init containers for payments-api, auth-svc, and billing-worker complete on
  next restart (`kubectl -n prod get pods | grep -v Running` is empty).
- Audit log shows continuous entries post-unseal and `vault audit list`
  includes the `file/` device.

## Rollback

There is no rollback for an unseal. If a node misbehaves after unsealing
(raft peer flapping, audit device errors), step it down and investigate:

```shell
vault operator step-down
kubectl -n security delete pod vault-1   # rejoins and re-seals; unseal again when ready
```

Do not `vault operator seal` the active node unless you are deliberately
taking the cluster down — that re-triggers the outage for dependent services.

## Escalation

- If only two share holders are reachable, page the security lead to retrieve
  the escrow share from the offline safe (30–45 min SLA). Do not attempt
  `vault operator rekey` during an outage.
- If a share holder has left the company or a share is suspected compromised,
  complete the unseal first, then schedule an emergency rekey to a fresh 5/3
  split within 24 hours.
- Cluster-wide seal with no known restart cause: treat as potential intrusion,
  page security on-call, preserve the audit log before touching anything.
- Owner of record for this runbook: Huy N. (platform lead).
