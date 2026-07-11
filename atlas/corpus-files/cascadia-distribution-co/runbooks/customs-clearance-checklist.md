---
id: sc-customs-clearance
title: Import Customs Clearance Checklist
type: runbook
service: imports
tags: [customs, clearance, documentation]
updated: 2024-07-18
---

## Overview

Checklist for clearing Cascadia Distribution Co. import shipments into the US: ocean freight on Pacific Lane from Brightway Electronics (Hangzhou) and Meko Textiles (Ho Chi Minh City), plus truck crossings from Guadalajara Metalworks. Licensed broker of record: Elif K. Internal owner: Reyna M.

Ocean entries file at the first US port; Guadalajara truck crossings clear at the southern border through the broker's border team. All entries ride Cascadia's continuous bond.

## Preconditions

- Continuous customs bond is active (renews each March; confirm status before booking peak-season volume).
- Supplier has sent the commercial invoice and packing list at least 72 hours before vessel departure.
- HTS classifications for every SKU on the shipment exist in Ledger's trade table.
- Elif K.'s office has portal access to the shipment folder.
- Incoterm and payment terms are recorded on the PO.
- Importer-of-record details on the PO match Cascadia's CBP registration.

## Steps

1. **Confirm ISF timing (ocean only).** ISF 10+2 must be filed no later than 24 hours before lading at origin. Send Elif K. the ISF data pack (seller, buyer, HTS, container stuffing location, consolidator) as soon as the booking confirms. Do not wait for the invoice.

2. **Validate the commercial invoice.** Invoice value matches the PO within 2%; currency stated; Incoterm stated; country of origin per line; no vague descriptions ("parts" and "goods" get rejected).

3. **Validate the packing list.** Carton counts and weights must match the bill of lading. Meko Textiles historically reports net weight only, so request gross weight explicitly.

4. **Confirm HTS classification and estimate duty.**

   ```bash
   ledger trade hts --sku BW-CHG-0450
   ledger trade duty-estimate --shipment IMP-33812
   ```

   New SKUs without a classification go to Elif K. with a spec sheet. Never guess a code to make a deadline.

5. **Transmit the document pack to the broker.** Use the standard email:

   ```text
   To: elif.k@<BROKER_DOMAIN>
   Subject: Entry docs - IMP-33812 / Pacific Lane V.081E / ETA 2024-07-25 PDX
   Attached: CI, PL, BOL, ISF confirmation. Bond: continuous.
   Please confirm entry number and flag any doc gaps within 1 business day.
   ```

6. **Track entry and release.** Elif K. files the entry; statuses flow back into Ledger via `ledger trade entry-status --shipment IMP-33812`. Expect release before vessel discharge for routine cargo.

7. **Handle exams.** If flagged (VACIS, tailgate, or intensive), notify the receiving DC to replan dock capacity and move the appointment (see the Inbound Receiving Dock SOP).

8. **Post-release.** Verify duty paid matches the estimate within 5%, file the document pack in the shipment folder, and schedule drayage from the port.

## Verification

- Entry shows `RELEASED` and the Ledger shipment status is `CUSTOMS_CLEARED`.
- ISF was filed at least 24 hours before lading (no late-filing flag on the shipment).
- Duty and fee reconciliation:

  ```sql
  SELECT shipment_id, duty_estimated, duty_paid, mpf_paid, hmf_paid
  FROM ledger.trade_entries
  WHERE shipment_id = 'IMP-33812';
  ```

- Broker invoice received and matched to the entry within 10 days of release.

## Exceptions

- **Discrepancy found after filing:** email Elif K. immediately; she files a post-summary correction. Never alter a supplier document yourself; request a corrected original from the supplier.
- **Invoice still missing at ETA minus 5 days:** escalate to the buyer and supplier; Brightway Electronics has a contractual 48-hour reissue SLA.
- **ISF deadline at risk:** file on best available data and amend later; a late ISF risks a $5,000 liquidated damages claim per filing.
- **Exam hold beyond 5 business days:** Elif K. requests status through broker channels. Do not contact the port terminal directly.

## Escalation

1. Elif K., same day, for classification disputes, exams, and any CBP notice.
2. Reyna M. for liquidated damages exposure or an entry blocking a customer commitment.
3. Legal/compliance mailbox for penalty notices or CBP requests for information. Never respond to CBP directly.
