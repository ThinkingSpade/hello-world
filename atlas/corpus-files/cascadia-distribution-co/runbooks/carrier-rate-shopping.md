---
id: sc-carrier-selection
title: Carrier Rate Shopping and Tender
type: runbook
service: transportation
tags: [carriers, rates, tender]
updated: 2024-10-02
---

## Overview

How Cascadia Distribution Co. selects mode and carrier for outbound shipments from PDX-1, RNO-1, and CMH-1, and how tenders are issued and accepted. Contracted carriers: BlueRidge Freight (LTL and FTL), SwiftParcel (parcel), Pacific Lane (ocean, import legs only). Owner: Jordan P. (Carrier Manager).

Default mode thresholds:

| Shipment profile | Default mode |
| --- | --- |
| Up to 150 lb and 8 cartons | Parcel (SwiftParcel) |
| 1-6 pallets, under 12,000 lb | LTL (BlueRidge Freight) |
| 7+ pallets, 12,000+ lb, or 750+ cu ft | FTL (BlueRidge Freight) |

## Preconditions

- Shipment is `PACKED` or `PLANNED` in Ledger with accurate weight, dims, and freight class.
- Rate tables are current: `ledger rates status` shows a sync within the last 7 days.
- Requested delivery date (RDD) present on the order; a blank RDD defaults to cost-optimal.
- Tendering user holds Ledger role `TMS_TENDER`.

## Steps

1. **Run rate shopping.**

   ```bash
   ledger tms rateshop --shipment SHP-204518 --modes parcel,ltl,ftl
   ```

2. **Apply the transit-vs-cost rule.** Choose the cheapest option that meets the RDD with one business day of buffer. Drop the buffer only when the order is flagged `EXPEDITE` and the customer has approved the surcharge in writing.

3. **Check the LTL-to-FTL upgrade triggers.** Upgrade when any of these holds: the LTL quote is 85% or more of the FTL quote; the load is 6+ pallets of fragile or high-theft product; one consignee is receiving 3+ LTL shipments the same day (consolidate instead). From mid-October onward, also apply the pre-booked capacity rules in the Peak Season Surge Playbook.

4. **Verify the fuel surcharge.** FSC is quoted separately. Confirm the FSC index week on the quote matches the current week; BlueRidge Freight resets its index every Wednesday. If mismatched, refresh rates before tendering. Never hand-edit an FSC value.

5. **Tender the shipment.**

   ```bash
   ledger tms tender --shipment SHP-204518 --carrier BLRG --mode LTL --expires 4h
   ```

6. **Handle the response.** Accepted: Ledger books the pickup appointment automatically. Declined or expired: re-tender to the next-ranked option from step 1. After two declines on one shipment, page Jordan P. before going off-contract.

7. **Spot quotes (exception only).** Off-contract spot moves require Jordan P.'s written approval and a logged rate reference (`ledger tms tender --spot-ref SQ-1097 ...`).

## Verification

- Shipment status is `TENDER_ACCEPTED` with a pickup appointment inside the RDD buffer.
- Audit the day's tenders for rule compliance:

  ```sql
  SELECT shipment_id, mode, carrier, quote_total, rdd, promised_delivery
  FROM ledger.tenders
  WHERE tender_date = CURRENT_DATE AND status = 'ACCEPTED'
  ORDER BY quote_total DESC;
  ```

- No accepted tender where an equal-or-faster option was 10% or more cheaper (weekly exception report goes to Jordan P.).

## Rollback

- Before pickup: cancel and re-tender.

  ```bash
  ledger tms tender-cancel --shipment SHP-204518 --reason RATE_ERROR
  ```

- Cancellations within 2 hours of the pickup window incur BlueRidge Freight's dry-run fee; log it against the shipment so it is not disputed at invoice audit.
- After pickup, mode cannot be rolled back. File a rate dispute through the carrier portal and note the dispute ID in Ledger.

## Escalation

1. Jordan P. for double-declined tenders, spot approvals, and any FSC discrepancy over 2%.
2. Reyna M. when expedite spend for a single customer exceeds $5,000 in a calendar month.
3. Carrier QBR agenda (owned by Jordan P.) for chronic decline rates above 5% on any lane.
