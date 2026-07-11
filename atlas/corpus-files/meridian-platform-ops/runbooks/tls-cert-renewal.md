---
id: rb-tls-cert-renewal
title: Renewing Edge TLS Certificates Without Downtime
type: runbook
service: edge
tags: [tls, certificates, renewal]
updated: 2024-11-08
---

## Overview

Meridian terminates TLS at the edge load balancers (`edge-lb-1`, `edge-lb-2`) for
`*.meridian.example`, `api.meridian.example`, and `pay.meridian.example`. Certificates
are issued via ACME (Let's Encrypt) using DNS-01 and stored in Vault under
`secret/meridian/tls/<domain>`. Renewal normally happens automatically at 30 days before
expiry; this runbook covers manual renewal when automation fails or a certificate must
be rotated early (e.g. key compromise).

## Preconditions

- Vault access with the `edge-tls` policy and the ACME account key available
- DNS API credentials for the `meridian.example` zone (for DNS-01 challenges)
- SSH access to `edge-lb-1` and `edge-lb-2` (HAProxy)
- Renewals are zero-downtime, but avoid overlapping with a deploy freeze window

## Steps

1. **Check expiry across all edge domains** and identify what actually needs renewal:

   ```shell
   for d in api.meridian.example pay.meridian.example www.meridian.example; do
     echo -n "$d: "
     echo | openssl s_client -servername "$d" -connect "$d":443 2>/dev/null \
       | openssl x509 -noout -enddate
   done
   ```

   Anything inside 21 days of expiry should be renewed now, not just the one that paged.

2. **Issue the new certificate via ACME (DNS-01):**

   ```shell
   lego --email certs@meridian.example --dns route53 \
     --domains api.meridian.example --accept-tos run
   ```

3. **Store the new cert and key in Vault** so both LBs render the same material:

   ```shell
   vault kv put secret/meridian/tls/api.meridian.example \
     cert=@api.meridian.example.crt key=@api.meridian.example.key \
     issued_at="$(date -u +%FT%TZ)"
   ```

4. **Rotate into the load balancers one at a time.** Drain `edge-lb-2` at the
   anycast layer first so `edge-lb-1` carries traffic, then install and reload:

   ```shell
   ssh edge-lb-2 'sudo consul-template -once -template \
     "/etc/haproxy/tls.ctmpl:/etc/haproxy/certs/api.pem" \
     && sudo haproxy -c -f /etc/haproxy/haproxy.cfg \
     && sudo systemctl reload haproxy'
   ```

   Verify (see below), undrain, then repeat on `edge-lb-1`. HAProxy reload keeps
   existing connections open, so no client-visible downtime is expected.

5. **Confirm expiry monitoring covers the new cert.** The blackbox exporter probes
   every edge domain; ensure the alert threshold is 21 days:

   ```shell
   curl -sS 'https://prometheus.meridian.internal/api/v1/query' \
     --data-urlencode 'query=(probe_ssl_earliest_cert_expiry - time()) / 86400' | jq .
   ```

   If a domain is missing from the probe list, add it to `blackbox-targets.yaml` now —
   missing monitoring is how manual renewals become emergencies.

## Verification

- New chain served from both LBs (check `notAfter` and issuer against each LB directly):

  ```shell
  echo | openssl s_client -servername api.meridian.example \
    -connect edge-lb-1.meridian.internal:443 2>/dev/null | openssl x509 -noout -enddate -issuer
  ```

- Full chain validates: `curl -sSI https://api.meridian.example/healthz` succeeds with
  no `-k` flag from a host outside the cluster.
- Prometheus `probe_ssl_earliest_cert_expiry` reflects the new date within 15 minutes.

## Rollback

The previous cert remains valid until its original expiry. To revert, fetch the prior
Vault secret version and reload HAProxy on both LBs:

```shell
vault kv get -version=<PREV_VERSION> -field=cert secret/meridian/tls/api.meridian.example
ssh edge-lb-1 'sudo systemctl reload haproxy'
```

Only revert if the new cert is misissued (wrong SANs, broken chain) — never past the
old cert's expiry date.

## Escalation

- ACME issuance failing (rate limits, DNS-01 timeouts) with under 7 days to expiry:
  page **edge-oncall** and treat as SEV2 (see: On-Call Escalation Policy).
- Certificate already expired and clients failing: SEV1; page **edge-oncall** and the
  incident commander immediately.
- Suspected private-key compromise: revoke via ACME, rotate immediately, and notify
  `security@meridian.example`; also rotate any API keys transported over the affected
  listener (see: Rotating Service API Keys via Vault).
