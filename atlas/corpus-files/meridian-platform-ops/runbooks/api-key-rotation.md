---
id: rb-api-key-rotation
title: Rotating Service API Keys via Vault
type: runbook
service: platform
tags: [secrets, rotation, vault]
updated: 2024-09-12
---

## Overview

Meridian services authenticate to each other with API keys minted from Vault under
`secret/meridian/api-keys/<service>`. Keys are rotated quarterly, or immediately after a
suspected leak. Rotation uses a **dual-publish grace window**: the old and new keys are
both valid for up to 24 hours while consumers roll over, after which the old key is
revoked. Primary consumers are `payments-api`, `auth-svc`, and `search-indexer`.

## Preconditions

- Vault CLI authenticated with the `platform-secrets` policy: `vault login -method=oidc`
- `kubectl` context set to `meridian-prod`
- You know every consumer of the key (check the ownership map in `services.yaml`)
- No active SEV1/SEV2 involving the target service (see: On-Call Escalation Policy)
- Announce the rotation window in `#meridian-platform` before starting

## Steps

1. **Generate the new key and write it to Vault as a versioned secret.** Do not delete
   the old version; KV-v2 keeps it addressable during the grace window.

   ```shell
   OLD_VERSION=$(vault kv metadata get -format=json \
     secret/meridian/api-keys/payments-api | jq -r '.data.current_version')
   NEW_KEY=$(openssl rand -hex 32)
   vault kv put secret/meridian/api-keys/payments-api \
     key="$NEW_KEY" rotated_at="$(date -u +%FT%TZ)" rotated_by="<YOUR_LDAP>"
   NEW_VERSION=$(vault kv metadata get -format=json \
     secret/meridian/api-keys/payments-api | jq -r '.data.current_version')
   printf 'old version: %s; new version: %s\n' "$OLD_VERSION" "$NEW_VERSION"
   ```

2. **Enter the dual-publish window.** Register the new key alongside the old one in the
   gateway's accepted-keys list so both validate:

   ```shell
   curl -sS -X POST https://gateway.meridian.internal/admin/v1/keys \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -d '{"service":"payments-api","key":"<NEW_KEY>","state":"active"}'
   ```

3. **Roll consumers onto the new key.** Consumers read the key from the Vault Agent
   sidecar; a rolling restart forces a re-render of the secret template:

   ```shell
   kubectl -n payments rollout restart deploy/payments-api
   kubectl -n payments rollout status deploy/payments-api --timeout=300s
   ```

   Repeat for `auth-svc` and `search-indexer` in their namespaces.

4. **Confirm the old key has gone quiet.** Query the gateway access logs for any request
   still presenting the old key fingerprint within the last 30 minutes:

   ```shell
   curl -sS "https://gateway.meridian.internal/admin/v1/keys/<OLD_KEY_ID>/usage?window=30m" \
     -H "Authorization: Bearer <ADMIN_TOKEN>" | jq '.request_count'
   ```

   If the count is non-zero, find the straggler before proceeding — do not revoke early.

5. **Revoke the old key** once usage is zero for 30+ minutes (or the 24 h window ends):

   ```shell
   curl -sS -X DELETE https://gateway.meridian.internal/admin/v1/keys/<OLD_KEY_ID> \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   vault kv destroy -versions="$OLD_VERSION" secret/meridian/api-keys/payments-api
   ```

## Verification

- `curl -sS https://payments-api.meridian.internal/healthz` returns `200` with the new key.
- A request with the old key returns `401` from the gateway.
- Gateway dashboard shows zero `key_id=<OLD_KEY_ID>` authentications for one hour.
- Vault audit log shows the new version read by every consumer's Vault Agent.

## Rollback

If a consumer breaks mid-rotation, the old key is still valid inside the grace window —
re-pin the consumer to the previous secret version and restart it:

```shell
vault kv get -version=<PREV_VERSION> secret/meridian/api-keys/payments-api
kubectl -n payments rollout undo deploy/payments-api
```

If the old key was already revoked, re-activate it via the gateway admin API (step 2
with the old key material) and open an incident review afterwards.

## Escalation

- Consumer failing to pick up the new key after 2 restarts: page **platform-oncall**.
- Suspected key leak (rotation is reactive): treat as SEV2 minimum — see: On-Call
  Escalation Policy — and notify `security@meridian.example` immediately.
- Vault itself unavailable: page **infra-oncall**; do not proceed with a partial rotation.
