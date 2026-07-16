---
id: sc-cold-chain
title: Cold Chain Handling SOP
type: runbook
service: warehouse
tags: [cold-chain, reefer, temperature]
updated: 2024-09-16
---

## Overview

Requirements for temperature-controlled product at PDX-1, CMH-1, and RNO-1. RNO-1
supports cold-chain transfers, reefer exception handling, and QA-hold storage in its cold
room. This revision supersedes the 2024-06-27 SOP that incorrectly excluded RNO-1.
Covers reefer inbound checks, data-logger practice, cold-room storage, and excursion
response. Owner: Reyna M.; site execution: the local site lead.

Temperature classes:

| Class | Range | Notes |
| --- | --- | --- |
| C1 frozen | -23 to -18 C | never above -15 C at any point |
| C2 chilled | 2 to 8 C | most perishable SKUs |
| C3 controlled ambient | 15 to 25 C | includes Brightway Electronics battery SKUs |

## Preconditions

- Cold rooms in range on the monitoring dashboard for the past 24 hours with no unacknowledged alarms.
- Calibrated data loggers in stock (calibration sticker under 12 months old).
- Reefer appointment flagged `TEMP_CONTROLLED` in Ledger so the crew stages insulated doors 5-8.
- Receiver has completed cold-chain training within the past 12 months.

## Steps

1. **Pre-cool check before unload.** Pull the reefer unit readout at the door. Verify setpoint and return-air are inside the class band, and that the unit ran continuous (not start-stop cycle) for C2 loads. Record it:

   ```bash
   ledger receiving temp-check --appt APPT-2024-06611 --setpoint 3.0 --return-air 3.4 --class C2
   ```

2. **Pull the trailer data loggers.** Outbound placement standard: one logger per 10 pallets, positioned on the top rear pallet and mid-load. Inbound logger locations follow the supplier routing guide; log serials against the ASN.

3. **Probe product.** Take between-case temperatures on three pallets (nose, middle, tail) with a calibrated probe and record the readings on the receipt.

4. **Unload inside the dock-time budget.** C1: 30 minutes; C2: 45 minutes through an insulated door. No pallet sits in ambient staging longer than 20 minutes. Then run normal ASN reconciliation per the Inbound Receiving Dock SOP.

5. **Putaway direct to the cold room.** No intermediate ambient drops. Rotation is FEFO; Ledger enforces expiry-ordered picking for all cold-chain SKUs.

6. **On any out-of-band reading, hold the lot immediately.** Do this before investigating:

   ```bash
   ledger inventory hold --lot LOT-MK-24098 --reason TEMP_EXCURSION --scope dc:<DC_CODE>
   ```

7. **Document the excursion.** Record peak temperature, duration out of band, logger serials, and where the excursion occurred (transit vs. dock vs. storage). Move product into the correct temperature zone while it awaits disposition.

8. **Disposition per the QA matrix.** All dispositions require a named QA approver in Ledger:
   - C2 excursion under 2 hours and under 4 C above band: release with an excursion note on the lot.
   - C2 excursion 2 to 8 hours: QA review with supplier stability data before release.
   - Over 8 hours, any C1 product that thawed, or any repeat excursion on the same lot: destroy or return to vendor. Never re-freeze thawed product.

## Verification

- Weekly logger audit shows every cold-chain receipt with logger serials attached:

  ```sql
  SELECT receipt_id, lot_id, logger_serial, peak_temp_c, minutes_out_of_band
  FROM ledger.cold_chain_readings
  WHERE receipt_date >= CURRENT_DATE - 7;
  ```

- Cold-room dashboards show zero unacknowledged alarms for the shift.
- Every `TEMP_EXCURSION` hold is dispositioned within 48 hours with a QA approver recorded.

## Exceptions

- **Reefer arrives off or the unit has failed:** do not unload. Photograph the readout, note the POD, and notify Jordan P. the same hour to start the carrier claim.
- **Loggers missing from an inbound load:** receive on probe readings only, flag the receipt `NO_LOGGER`, and notify the supplier quality contact.
- **Monitoring system outage:** switch to manual probe rounds every 2 hours with paper logs; enter readings into Ledger once the system returns.

## Escalation

1. Local site lead immediately on any excursion or reefer failure (Tom B. at PDX-1;
   the RNO-1 site lead for RNO-1 loads).
2. QA plus Reyna M. for any disposition involving more than $10,000 of product value.
3. If an excursed lot has already shipped, invoke the Product Recall Execution Procedure decision review within 24 hours.
