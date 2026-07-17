---
id: sc-receiving-dock
title: Inbound Receiving Dock SOP
type: runbook
service: warehouse
tags: [receiving, dock, putaway]
updated: 2024-08-11
---

## Overview

Standard operating procedure for inbound receiving at all Cascadia Distribution Co. dock doors (PDX-1, RNO-1, CMH-1). Covers appointment check-in, trailer unload, damage inspection, ASN reconciliation in Ledger, and putaway. Process owner: Reyna M. (Ops Manager); PDX-1 floor authority: Tom B. (Warehouse Lead).

Scope: dry and ambient freight only. Reefer trailers follow the Cold Chain Handling SOP for pre-unload checks before this procedure applies.

## Preconditions

- Receiver has Ledger role `WH_RECEIVER` or higher.
- Dock scheduler shows a confirmed appointment (status `CONFIRMED` in the Ledger Dock module).
- ASN (EDI 856) received and staged in Ledger; if missing, see Exceptions.
- Forklift and pallet jack pre-shift inspections completed and logged.
- Damage camera/tablet charged and synced.
- Staging lanes for the shift are clear of the prior day's freight.

## Steps

1. **Check in the driver.** Verify appointment number, carrier (typically BlueRidge Freight for LTL/FTL), trailer number, and seal number against the appointment record:

   ```bash
   ledger dock checkin --appt APPT-2024-08811 --trailer TRL-4471 --seal SL-99213
   ```

2. **Verify the seal.** If the seal is broken or the number does not match the ASN, stop. Photograph it, note it on the delivery receipt, and page the shift lead before opening the doors.

3. **Unload and stage.** Unload to the staging lane assigned by Ledger (`ledger dock lane --appt APPT-2024-08811`). Keep one PO per staging lane where possible.

4. **Inspect for damage.** Check each pallet for crush, moisture, leaning loads, and broken stretch wrap. Photograph damage before breaking down the pallet, then record it:

   ```bash
   ledger receiving damage --po PO-118842 --sku BW-CHG-0450 --qty 12 --reason CRUSHED --photo-ref DMG-0231
   ```

5. **Scan-receive against the ASN.** Scan each license plate or carton; Ledger reconciles counts against the ASN automatically:

   ```bash
   ledger receiving reconcile --asn ASN-77120 --mode scan
   ```

6. **Capture lots and expiry where required.** Lot-controlled SKUs (all Meko Textiles dye lots, all date-coded product) must have lot and expiry scanned at receipt, not at putaway:

   ```bash
   ledger receiving lot-capture --asn ASN-77120 --sku MEK-TSH-1101 --lot LOT-MK-24122 --expiry 2026-05-31
   ```

7. **Resolve ASN variances.** Overages: receive actual quantity and flag `OVER`. Shortages over 2% of an ASN line: flag `SHORT` and note it on the POD before the driver leaves. Brightway Electronics shipments frequently split cartons across trailers; check for a linked follow-on ASN before flagging.

8. **Close the receipt.** All lines must be in `RECEIVED` or `VARIANCE_FLAGGED` status:

   ```bash
   ledger receiving close --asn ASN-77120
   ```

9. **Putaway.** Follow Ledger-directed putaway. Rules: velocity class A to ground pick faces, B/C to upper reserve, hazmat to the caged area, temperature-sensitive product per the Cold Chain Handling SOP. Confirm every move by scanning the destination location.

## Verification

- Ledger receipt status is `CLOSED` with zero lines in `PENDING`.
- The variance report matches the tablet damage notes:

  ```sql
  SELECT line_id, sku, expected_qty, received_qty, variance_reason
  FROM ledger.receipt_lines
  WHERE asn_id = 'ASN-77120' AND variance_reason IS NOT NULL;
  ```

- All putaway tasks for the receipt show `COMPLETE`; no orphaned pallets in staging lanes at end of shift.

## Exceptions

- **No ASN on file:** create a blind receipt (`ledger receiving create --blind --po PO-118842`) and email the buyer; do not refuse freight solely for a missing ASN.
- **Refusing freight:** only for safety hazards, temperature abuse (see the Cold Chain Handling SOP), or pest evidence. Note the reason on the POD and notify Jordan P. (Carrier Manager) the same day.
- **Driver disputes a damage notation:** photograph together, write "subject to inspection" on the POD, and let the claims process settle it.

## Escalation

1. Shift lead (Tom B. at PDX-1) for any seal mismatch, shortage over 5%, or suspected concealed damage.
2. Reyna M. if a receipt cannot close within 24 hours of unload.
3. Jordan P. for carrier claims and recurring BlueRidge Freight seal or shortage issues.
