---
id: sc-inc-port-congestion
title: Pacific Lane vessel queue delays holiday-reset containers 11 days
type: incident
service: transportation
tags: [ocean, congestion, delay]
updated: 2024-10-01
---

## Summary

Severity: SEV-1 (customer launch impact). Between 2024-09-06 and 2024-09-24, three Pacific Lane vessels carrying Cascadia Distribution Co. freight sat at anchor for up to 11 days at the West Coast gateway port ([PORT-A]) due to berth congestion. Fourteen containers of Brightway Electronics (Hangzhou) product bound for the Q4 holiday planogram reset were delayed. Two critical containers were air-freighted at 6.1x the ocean cost to protect the earliest reset date; the reset launch still slipped one week for two retail customers ([CUSTOMER-1], [CUSTOMER-2]).

Incident commander: Reyna M. (ops manager). Carrier escalation: Jordan P. (carrier manager). Customs coordination: Elif K. (customs broker). Receiving lead: Tom B. (PDX-1).

## Impact

- 14 x 40' HC containers delayed (approx. 61,600 units of holiday-reset electronics).
- 212 retail reset allocation orders shipped late out of PDX-1 and RNO-1.
- Air freight for 2 critical containers: $318,000 actual vs. $52,000 budgeted ocean cost (6.1x).
- Demurrage/detention exposure: $41,300 invoiced; $18,900 recovered from Pacific Lane after dispute.
- Reset launch slipped 7 days for two retail customers; $96,000 fill-rate penalty exposure, $38,500 assessed after negotiation.
- No inventory loss or damage; all 14 containers ultimately received in full in Ledger WMS.

## Timeline

All times US Pacific.

- 2024-09-06 08:40 — Pacific Lane advises vessel [VESSEL-1] will anchor outside [PORT-A]; berth queue estimated at 9 days.
- 2024-09-08 10:15 — Jordan P. identifies 14 Cascadia containers across three vessels ([VESSEL-1], [VESSEL-2], [VESSEL-3]) at risk; opens incident ticket SC-2131.
- 2024-09-09 09:00 — Reyna M. declares SEV-1; daily standup set with demand planning, PDX-1 (Tom B.), and Pacific Lane account team.
- 2024-09-10 14:30 — Demand planning confirms 2 of 14 containers gate the earliest reset date; remaining 12 have 5-9 days of slack.
- 2024-09-11 11:00 — Air-freight quote approved by VP Ops for the 2 critical containers ($318,000, 6.1x ocean); cargo rebooked ex-Hangzhou via Brightway's forwarder.
- 2024-09-12 16:45 — Elif K. pre-files entry documentation for the air shipments to avoid a customs hold on arrival; see: Customs pre-clearance SOP.
- 2024-09-14 07:20 — Berth queue peaks at 11 days; Pacific Lane confirms no priority berthing available.
- 2024-09-16 13:05 — Air-freighted units (8,800 units) land at [AIRPORT-1]; drayage to PDX-1 same day.
- 2024-09-17 06:00 — Tom B. runs a dedicated receiving wave at PDX-1; air units received into Ledger and allocated to [CUSTOMER-1] reset orders by 15:00.
- 2024-09-18 09:30 — [CUSTOMER-1] and [CUSTOMER-2] notified of a one-week reset slip for the ocean-bound balance; revised delivery appointments booked.
- 2024-09-19 10:00 — [VESSEL-1] berths; first 5 containers discharge over 48 hours.
- 2024-09-21 12:00 — [VESSEL-2] berths; 6 containers discharge; drayage queue adds ~1 day.
- 2024-09-24 08:15 — Final containers from [VESSEL-3] gate out; last receipt confirmed at RNO-1 on 2024-09-26.
- 2024-09-27 14:00 — Jordan P. files demurrage dispute with Pacific Lane; incident downgraded to monitoring.
- 2024-10-01 10:00 — Post-incident review held; incident closed.

## Root Cause

Berth congestion at [PORT-A] driven by a surge of pre-holiday import volume and a two-berth crane maintenance closure, compounded on our side by booking the holiday reset freight inside the standard 4-week window with zero schedule buffer. All 14 containers were placed on vessels arriving in the same 8-day arrival band, concentrating the risk.

Contributing factors:

- No congestion monitoring: the port's published queue index had shown deterioration for 3 weeks before our first vessel anchored, and nobody was watching it.
- Reset freight was not flagged as launch-critical in the booking process, so it received no earlier booking or vessel diversification; see: Inbound ocean booking SOP.
- Escalation to Pacific Lane started only after the first anchoring notice, too late for rebooking via an alternate port.

## Resolution

- Air-freighted the 2 launch-gating containers (8,800 units) at 6.1x cost; earliest reset date protected for the air-freighted SKUs.
- Re-negotiated reset delivery appointments with both retail customers, limiting the slip to 7 days and reducing penalty exposure from $96,000 to $38,500.
- Recovered $18,900 of demurrage/detention from Pacific Lane under the service contract's congestion clause.
- Received all 14 containers in full; cycle counts at PDX-1 and RNO-1 confirmed zero shortage.
- Documented the congestion decision tree (air vs. wait vs. divert) for reuse; attached to ticket SC-2131.
- Post-incident review completed 2024-10-01 with Pacific Lane account team present.

## Action Items

- [x] Book all launch-critical ocean freight at least 6 weeks ahead and spread across a minimum of two sailings (owner: Jordan P., done 2024-09-30).
- [x] Add launch-critical flag to the ocean booking request form; see: Inbound ocean booking SOP (owner: Reyna M., done 2024-09-27).
- [ ] Stand up a weekly congestion index watch for [PORT-A] and [PORT-B] with an alert threshold of a 6-day queue (owner: Jordan P., due 2024-10-15).
- [ ] Negotiate a standing air-freight rate card with Brightway's forwarder to cut expedite quoting time (owner: Jordan P., due 2024-10-31).
- [ ] Add an alternate-port diversion option to the Pacific Lane contract at next renewal (owner: Jordan P., due 2024-12-01).
- [x] Close out demurrage dispute and record recovery in the freight audit log (owner: Elif K., done 2024-09-30).
- [ ] Run a tabletop exercise on the congestion decision tree with demand planning (owner: Reyna M., due 2024-11-15).
