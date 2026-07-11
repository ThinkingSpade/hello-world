---
id: sc-inc-reefer-excursion
title: Weekend reefer unit failure at RNO-1 causes 9-hour temperature excursion
type: incident
service: warehouse
tags: [cold-chain, excursion, spoilage]
updated: 2024-08-15
---

## Summary

Severity: SEV-2 (product loss, no customer shipment of affected goods). Over the weekend of 2024-08-03/04, the refrigeration unit on a loaded reefer trailer staged in the RNO-1 yard failed. Trailer interior temperature rose above the class-2 band (2-8 C) for approximately 9 hours before the load was transferred. The excursion was detected Monday morning from the in-load data loggers during the receiving check, since no live telematics alert reached anyone over the weekend. Per the disposition matrix in the cold-chain handling SOP, 40% of the load was dispositioned as spoilage and destroyed; the remainder passed stability review and was released. An insurance claim was filed for the loss.

Incident commander: Reyna M. (ops manager). Site lead: [RNO-1 SITE LEAD]. Quality disposition: [QA-LEAD]. Carrier follow-up: Jordan P. (carrier manager).

## Impact

- 1 x 53' reefer trailer (BlueRidge Freight interchange unit [TRAILER-4471]) affected.
- 18,200 units of temperature-controlled product on board; 7,280 units (40%) dispositioned as spoilage.
- Spoilage value: $61,900 at landed cost; disposal fees $2,150.
- Insurance claim [CLAIM-2024-0812] filed for $61,900; carrier liability under interchange agreement under review.
- 11 customer orders reallocated to PDX-1 stock; zero orders shorted, 2 orders shipped 1 day late.
- Approximately 26 labor hours consumed on transfer, segregation, logger download, and disposition.

## Timeline

All times US Pacific.

- 2024-08-02 16:20 — Loaded reefer [TRAILER-4471] staged in RNO-1 yard, set point 4 C, unit running on diesel; yard check normal at end of shift.
- 2024-08-03 ~21:30 — (Reconstructed from logger data) reefer unit shuts down on a compressor fault; interior temperature begins rising.
- 2024-08-04 ~02:00 — (Reconstructed) interior temperature crosses 8 C, the top of the class-2 band; excursion clock starts.
- 2024-08-04 ~11:00 — (Reconstructed) yard security walk passes the trailer; unit silence not recognized as an alarm condition; temperature peaks at 16.4 C.
- 2024-08-04 11:05 — (Reconstructed) unit restarts on its own after fault auto-reset; temperature recovers below 8 C by ~13:30. Total time above band: approx. 9 hours.
- 2024-08-05 06:15 — Receiving crew opens trailer; door-open spot check reads in range, but the in-load data loggers are pulled per procedure; see: Cold-chain handling SOP.
- 2024-08-05 07:40 — Logger download shows the excursion; receiving halted, load placed on QA hold in Ledger, incident ticket SC-2118 opened.
- 2024-08-05 08:30 — Reyna M. declares SEV-2; load transferred into the RNO-1 cold room; trailer taken out of service and tagged for BlueRidge Freight.
- 2024-08-05 13:00 — [QA-LEAD] maps logger curves to the disposition matrix: products with a validated 12-hour stability budget released; products with a 6-hour budget failed.
- 2024-08-06 10:00 — Disposition finalized: 7,280 units (40% of load) declared spoilage; 10,920 units released to stock.
- 2024-08-06 15:30 — 11 open customer orders against the held stock reallocated to PDX-1; Tom B. confirms same-week ship coverage.
- 2024-08-07 09:00 — Spoiled units destroyed under witness per the destruction procedure; certificates retained in ticket SC-2118.
- 2024-08-08 11:20 — Insurance claim [CLAIM-2024-0812] filed with logger data, photos, and destruction certificates attached.
- 2024-08-09 14:00 — BlueRidge Freight inspection confirms compressor fault and a telematics modem with an expired data subscription on the trailer.
- 2024-08-15 10:00 — Post-incident review held; incident closed pending claim settlement.

## Root Cause

The reefer unit's compressor faulted and shut down for roughly 13.5 hours overnight on a weekend, and no alert reached a human because the trailer's telematics modem had an expired data subscription — the unit could not phone home, and Cascadia's on-call process had no feed from yard reefer telematics anyway. Detection therefore waited for the Monday logger pull, by which time the excursion had already run its course.

Contributing factors:

- Yard checks on weekends verified trailer presence and seals, not reefer run status; a silent unit did not trigger any action.
- No backup power option: RNO-1 has no yard genset, so even a detected failure required a load transfer rather than a plug-in.
- Cold-chain loads staged in yard over a weekend violated the intent (though not the letter) of the cold-chain handling SOP, which assumed staging under 24 hours.

## Resolution

- Load transferred to the RNO-1 cold room; excursion bounded at ~9 hours above band using logger data.
- Disposition per the cold-chain handling SOP matrix: 60% released after stability review, 40% destroyed with certificates.
- Customer impact contained by reallocating 11 orders to PDX-1 stock; 2 orders slipped one day.
- Insurance claim filed; BlueRidge Freight put on notice under the trailer interchange agreement for the faulty unit and dead telematics.
- Affected trailer removed from the cold-chain-approved pool until repaired and telemetry-verified.
- Post-incident review completed 2024-08-15.

## Action Items

- [ ] Wire reefer telematics alerts (unit-off, out-of-band temperature) to the RNO-1 on-call phone with a 15-minute acknowledgment requirement (owner: [RNO-1 SITE LEAD], due 2024-09-06).
- [ ] Require telematics-verified units (active subscription confirmed at check-in) for all cold-chain trailers; add to yard check-in procedure (owner: Jordan P., due 2024-09-15).
- [x] Amend weekend yard-check checklist to include reefer run status and fuel level for every reefer on site (owner: [RNO-1 SITE LEAD], done 2024-08-12).
- [ ] Procure a backup genset for RNO-1 and establish a monthly load-test cadence (owner: [RNO-1 SITE LEAD], due 2024-10-31).
- [ ] Update the cold-chain handling SOP to prohibit weekend yard staging of class-2 loads without live monitoring; see: Cold-chain handling SOP (owner: Reyna M., due 2024-09-15).
- [x] Pursue cost recovery from BlueRidge Freight under the interchange agreement in parallel with the insurance claim (owner: Jordan P., opened 2024-08-09).
- [ ] Track claim [CLAIM-2024-0812] to settlement and record outcome in the incident ticket (owner: Reyna M., check monthly).
