---
id: sc-inc-wms-outage
title: Ledger WMS down 5 hours across all DCs during failed vendor upgrade
type: incident
service: systems
tags: [wms, outage, paper-process]
updated: 2024-11-21
---

## Summary

Severity: SEV-1 (all-site system outage). On 2024-11-19, the Ledger WMS was unavailable at PDX-1, RNO-1, and CMH-1 for 5 hours 4 minutes (07:41-12:45 PT) after a vendor-run version upgrade failed mid-migration and the rollback did not work as documented. The outage landed squarely on the morning receiving peak. All three DCs switched to the paper fallback process and kept docks moving: 3,100 units were received on paper and 47 outbound orders were staged from pick tickets printed before the outage. Paper transactions were reconciled into Ledger over the following two days with a final variance of 0.4%.

Incident commander: Reyna M. (ops manager). Vendor escalation: [IT-LEAD]. Site leads: Tom B. (PDX-1), [RNO-1 SITE LEAD], [CMH-1 SITE LEAD].

## Impact

- Ledger WMS down 5 hours 4 minutes at all three DCs during the Tuesday receiving peak.
- 3,100 units received on paper across 9 inbound trailers (PDX-1: 1,750; RNO-1: 620; CMH-1: 730).
- 47 outbound orders shipped from pre-printed pick tickets; 63 orders held and shipped next day.
- Reconciliation variance after two days: 12 units net (0.4% of paper-received units), all resolved by cycle count.
- Estimated labor cost of fallback and reconciliation: $6,800 (94 hours across sites).
- No customer claims; 1 carrier detention charge ($240) from a delayed live unload at CMH-1.

## Timeline

All times US Pacific.

- 2024-11-19 06:00 — Ledger vendor begins scheduled version upgrade (change CHG-1893), sold as "zero downtime," during the pre-approved window that overlapped morning receiving.
- 2024-11-19 07:41 — Ledger becomes unresponsive at all sites mid-migration; RF guns drop sessions; incident ticket SC-2160 opened.
- 2024-11-19 07:50 — Vendor confirms migration failure on a schema step; begins rollback per their runbook.
- 2024-11-19 08:05 — Reyna M. declares SEV-1 and orders all sites onto the paper fallback process; see: Paper fallback receiving SOP.
- 2024-11-19 08:15 — Tom B. stands up the paper receiving line at PDX-1: pre-numbered receiving sheets, one counter per door, supervisor sign-off per trailer.
- 2024-11-19 08:30 — RNO-1 and CMH-1 confirm paper process live; outbound restricted to orders with pick tickets printed before 07:41.
- 2024-11-19 09:20 — Vendor reports the documented rollback has failed (rollback script assumed a schema version two releases old); escalates internally to their engineering team.
- 2024-11-19 10:00 — [IT-LEAD] invokes the vendor SLA escalation clause; vendor VP engaged; decision made to restore from the 05:30 pre-upgrade snapshot.
- 2024-11-19 11:10 — Snapshot restore begins; sites advised of a ~90-minute runway; CMH-1 holds one live unload, incurring $240 detention.
- 2024-11-19 12:45 — Ledger restored on the pre-upgrade version at all sites; RF operations resume; paper process closed out with 3,100 units on 9 trailers logged.
- 2024-11-19 13:30 — Reconciliation team formed (one clerk per site plus inventory control); keying of paper receipts into Ledger begins.
- 2024-11-20 17:00 — All paper receipts keyed; first-pass variance 31 units (1.0%).
- 2024-11-21 15:30 — Targeted cycle counts close the variance to 12 units net (0.4%); adjustments posted; incident closed.
- 2024-11-21 16:00 — Post-incident review held with the Ledger vendor on the call.

## Root Cause

The vendor's upgrade failed on a schema migration step, and their rollback runbook was written for a schema two releases older than ours — it had never been rehearsed against our actual version, so the "zero downtime" claim and the rollback plan were both untested assumptions. Recovery therefore fell through to a full snapshot restore, stretching a failed migration into a 5-hour outage.

Contributing factors:

- The upgrade window was approved for 06:00 on a Tuesday, directly overlapping the weekly receiving peak, because the vendor's "zero downtime" claim was accepted without challenge.
- No Cascadia-side go/no-go checkpoint existed in the change plan; the vendor proceeded past the first failed step before notifying us.
- The paper fallback process worked but was rusty: CMH-1 had not drilled it in over a year, which contributed to the first-pass variance and slower close-out.

## Resolution

- All sites operated the paper fallback process for the full outage; docks never stopped, and 3,100 units were received on paper with supervisor sign-off per trailer.
- Ledger restored from the pre-upgrade snapshot on the prior version; no data loss for transactions committed before 07:41.
- Paper transactions keyed and reconciled over two days; final variance 0.4%, closed by targeted cycle counts.
- Vendor issued an RCA and SLA service credits under the support agreement.
- The upgrade was rescheduled for 2024-12-08 (Sunday, minimal-volume window) contingent on a rehearsed rollback demonstrated in a staging copy of our environment.
- Post-incident review completed 2024-11-21 with vendor participation.

## Action Items

- [x] Move all future Ledger upgrade windows off receiving peaks; standard window is Sunday 02:00-08:00 PT (owner: [IT-LEAD], done 2024-11-20).
- [ ] Require the vendor to rehearse rollback against a staging copy of our schema before any production upgrade; make it a contractual gate (owner: [IT-LEAD], due 2024-12-05).
- [ ] Add a Cascadia go/no-go checkpoint after each major migration step in the vendor change plan (owner: [IT-LEAD], due 2024-12-05).
- [ ] Institute a quarterly paper-process drill at each DC, scored on close-out variance; see: Paper fallback receiving SOP (owner: Reyna M., first drill due 2025-01-31).
- [x] Replenish pre-numbered paper receiving sheet stock at all sites to a 3-day supply (owner: Tom B., done 2024-11-20).
- [ ] Pre-print a rolling 4-hour buffer of outbound pick tickets each morning during peak season so outbound can continue through an outage (owner: [CMH-1 SITE LEAD], due 2024-12-01).
- [ ] Confirm receipt of vendor SLA credits and final RCA document (owner: [IT-LEAD], due 2024-12-15).
