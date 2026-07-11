---
id: inc-2024-11-cert-expiry
title: Wildcard Certificate Expiry Takes Down Internal Tooling
type: incident
service: edge
tags: [tls, certificates, expiry]
updated: 2024-11-07
---

## Summary

SEV2, 2024-11-05. The wildcard TLS certificate for `*.internal.meridian.example`
expired at 08:14 UTC. Every internal dashboard behind the internal ingress —
Grafana, the deploy console, the feature-flag UI, and the on-call runbook
viewer — became unreachable for roughly two hours. The renewal automation had
not run since August: the cron job responsible lived on `ops-runner-1`, a host
decommissioned during the September infrastructure cleanup. Nothing monitored
certificate expiry, so the first signal was users reporting browser errors.

## Impact

- All internal tooling behind `*.internal.meridian.example` down 08:14–10:22
  UTC (2h 8m). External customer traffic was NOT affected.
- On-call response to an unrelated alert was slowed ~15 minutes because
  Grafana and the runbook viewer were both behind the expired cert.
- Deploys were frozen for the window since the deploy console was unreachable.
- No security impact: the certificate expired; it was not compromised.

## Timeline

- 08:14 UTC — Certificate `notAfter` passes; internal ingress starts serving
  an expired cert. Browsers refuse connections.
- 08:31 UTC — First user reports in `#platform-help`; on-call confirms:

```shell
echo | openssl s_client -connect grafana.internal.meridian.example:443 \
  2>/dev/null | openssl x509 -noout -dates
```

- 08:40 UTC — SEV2 declared. Renewal cron traced to `ops-runner-1`, which was
  decommissioned on 2024-09-12; the job had silently never migrated.
- 09:05 UTC — Manual renewal attempted following "Renewing TLS certificates at
  the edge"; DNS-01 challenge credentials located in Vault under
  `secret/edge/acme` (token: `<VAULT_TOKEN>`).
- 09:38 UTC — New certificate issued; pushed to the ingress secret:

```shell
kubectl -n edge create secret tls internal-wildcard-tls \
  --cert=fullchain.pem --key=privkey.pem --dry-run=client -o yaml \
  | kubectl apply -f -
kubectl -n edge rollout restart deploy/internal-ingress
```

- 10:05 UTC — Ingress pods reloaded; spot checks green on Grafana and the
  deploy console.
- 10:22 UTC — All internal endpoints verified; incident downgraded and closed
  at 11:00 UTC after monitoring confirmed stability.

## Root Cause

Certificate renewal was a certbot cron job on a single pet host,
`ops-runner-1`. The September decommission checklist covered DNS, backups, and
monitoring agents but had no line item for scheduled jobs, so the renewal
silently stopped. The 30-day renewal window passed without any attempt, and
because no system monitored certificate expiry dates, the failure surfaced
only at the moment of expiry. Single point of failure, no observability.

## Resolution

- Renewal moved off host cron entirely: cert-manager now manages the wildcard
  via an ACME `ClusterIssuer` with DNS-01, renewing automatically at 2/3 of
  the certificate lifetime.
- Blackbox-exporter probes now scrape `ssl_cert_not_after` for every ingress
  endpoint; alerts fire at 21 days (warning) and 7 days (page) before expiry.
- The decommission checklist now includes a "scheduled jobs and crons" audit
  step with sign-off from the owning team.

## Action Items

- [x] Migrate internal wildcard to cert-manager ClusterIssuer (done 11-05).
- [x] Expiry monitoring for all edge and internal certs (done 11-06).
- [x] Add cron/job audit to the host decommission checklist (done 11-07).
- [ ] Inventory remaining certbot installations on pet hosts and migrate or
      retire each one (owner: platform).
- [ ] Update "Renewing TLS certificates at the edge" to make cert-manager the
      primary path and demote manual renewal to break-glass only.
- [ ] Serve a static status page on a separately-issued cert so on-call is
      never blind when the internal wildcard fails.
