---
id: rb-oncall-escalation
title: On-Call Escalation Policy
type: runbook
service: platform
tags: [oncall, escalation, paging]
updated: 2024-07-15
---

## Overview

This document defines how incidents on the Meridian platform are classified, who gets
paged, how fast escalation proceeds, and how incident-commander (IC) handoff works.
It applies to all production services, including `payments-api`, `auth-svc`,
`search-indexer`, the database tier, and the edge. Technical runbooks (for example,
see: Rolling Back a Bad Production Deploy with Helm) reference the severities here.

## Preconditions

- You are on a Meridian on-call rotation or have been paged into an incident
- Pager access configured (`meridian-pager` app) and membership in `#meridian-incidents`
- Read access to the status page admin at `status.meridian.example`

## Steps

1. **Classify severity** at the moment of detection; reclassify freely as facts change:

   | Sev  | Definition                                                     | Examples                                   |
   |------|----------------------------------------------------------------|--------------------------------------------|
   | SEV1 | Customer-facing outage or data loss in progress                 | payments-api down; primary DB unreachable   |
   | SEV2 | Major degradation, partial outage, or imminent SEV1             | auth-svc p99 > 5 s; cert expiring in hours  |
   | SEV3 | Minor degradation with workaround; no immediate customer impact | search-indexer lagging; one replica down    |
   | SEV4 | Cosmetic or informational; fix in business hours                | noisy alert; stale dashboard                |

2. **Page the right rotation.** SEV1/SEV2 always page; SEV3 files a ticket and notifies
   the owning channel; SEV4 is ticket-only. Trigger a page manually if needed:

   ```shell
   curl -sS -X POST https://pager.meridian.internal/api/v2/incidents \
     -H "Authorization: Bearer <PAGER_TOKEN>" \
     -d '{"service":"payments-api","severity":"SEV1","summary":"checkout 5xx spike"}'
   ```

   Service-to-rotation mapping: payments-api / auth-svc → **platform-oncall**;
   Postgres and pgbouncer → **db-oncall**; load balancers and TLS → **edge-oncall**.

3. **Follow the escalation timers.** The pager enforces these automatically, but
   escalate manually sooner if you are stuck:

   - SEV1: primary on-call has **5 minutes** to ack, then secondary is paged; at
     **15 minutes** without an IC, the engineering manager on the leadership rotation
     is paged and becomes interim IC.
   - SEV2: primary has **15 minutes** to ack, then secondary; leadership at 45 minutes.
   - SEV3/SEV4: no automatic escalation; escalate manually if scope grows.

4. **Run comms in the standard channels.** Create `#inc-<date>-<slug>`, post an initial
   summary within 10 minutes for SEV1/SEV2, and update every 30 minutes. Update the
   public status page for any customer-visible impact:

   ```shell
   curl -sS -X POST https://status.meridian.example/api/v1/updates \
     -H "Authorization: Bearer <STATUS_TOKEN>" \
     -d '{"component":"payments","state":"degraded","message":"Investigating elevated errors"}'
   ```

5. **Hand off incident command cleanly** at shift change or after 4 hours of continuous
   IC duty. The outgoing IC posts a handoff note in the incident channel covering:
   current severity, working theory, actions in flight, next decision point, and who
   owns each action. The incoming IC explicitly posts "taking IC" — command is never
   transferred silently.

## Verification

- Every SEV1/SEV2 has an acked page, a named IC, an incident channel, and a status-page
  entry within 15 minutes of detection.
- The pager timeline shows escalations firing at the intervals above; audit weekly.
- Handoffs appear in the incident channel with an explicit "taking IC" message.

## Rollback

Severity can be downgraded (SEV1 → SEV2 → resolved) by the IC once impact is confirmed
to have ended. Downgrading requires a status-page update and a note in the incident
channel; the postmortem obligation from the highest severity reached still applies.
A page sent in error should be resolved with reason `false-positive`, never ignored.

## Escalation

- Cannot reach primary or secondary on-call for a SEV1: page the leadership rotation
  directly via the pager UI override.
- Suspected security incident (leaked credentials, active intrusion): page
  **security-oncall** in parallel regardless of severity, and start key rotation per
  see: Rotating Service API Keys via Vault.
- Pager platform itself down: fall back to the phone tree pinned in
  `#meridian-incidents` and declare SEV1 for the paging system.
