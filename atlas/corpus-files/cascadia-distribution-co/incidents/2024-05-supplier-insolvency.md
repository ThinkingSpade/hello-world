---
id: sc-inc-supplier-insolvency
title: Guadalajara Metalworks restructuring creates 6-week gap risk on bracket hardware
type: incident
service: procurement
tags: [supplier, insolvency, single-source]
updated: 2024-06-10
---

## Summary

Severity: SEV-2 (supply continuity risk, no customer impact realized). On 2024-05-07, Guadalajara Metalworks — sole supplier of Cascadia's bracket hardware line — notified us it had entered a court-supervised restructuring (concurso mercantil). Three purchase orders were open at the time, covering two single-sourced SKUs ([SKU-BRKT-A], [SKU-BRKT-B]) with a combined 6-week supply gap risk against forecast. The gap was bridged with a spot buy from an alternate supplier ([ALT-SUPPLIER-1]) at +18% unit cost plus an expedited qualification of that supplier for ongoing volume. No customer orders shorted.

Incident commander: Reyna M. (ops manager). Procurement lead: [PROC-LEAD]. Receiving coordination: Tom B. (PDX-1).

## Impact

- 3 open POs at risk: PO-88412, PO-88437, PO-88519 (combined 148,000 units, $412,000 value).
- 2 single-sourced SKUs exposed: [SKU-BRKT-A] (velocity class A) and [SKU-BRKT-B] (velocity class B+).
- Projected stockout window of 6 weeks (2024-06-17 through 2024-07-29) absent intervention.
- Spot buy of 96,000 units from [ALT-SUPPLIER-1] at +18% unit cost: $118,000 incremental spend.
- Expedited qualification costs (first-article inspection, expedited samples, travel): $9,400.
- Zero customer orders shorted; DC fill rate on both SKUs held at 99.1% through the window.

## Timeline

All times US Pacific.

- 2024-05-07 07:55 — Guadalajara Metalworks emails formal notice of restructuring filing; production continuing "subject to court approval of working capital."
- 2024-05-07 10:30 — Procurement flags 3 open POs and single-source exposure; incident ticket SC-2087 opened.
- 2024-05-08 09:00 — Reyna M. declares SEV-2; runs exposure analysis in Ledger — 41 days of cover for [SKU-BRKT-A], 33 days for [SKU-BRKT-B].
- 2024-05-09 14:00 — Call with Guadalajara Metalworks management: PO-88412 (in production) will ship; PO-88437 and PO-88519 cannot be committed.
- 2024-05-10 11:15 — Alternate supplier shortlist pulled from the approved-vendor pipeline; [ALT-SUPPLIER-1] and [ALT-SUPPLIER-2] contacted for spot quotes; see: Supplier risk review SOP.
- 2024-05-14 16:40 — [ALT-SUPPLIER-1] quotes 96,000 units at +18% with 4-week lead time; sample parts requested.
- 2024-05-17 09:20 — First-article samples received at PDX-1; Tom B. coordinates dimensional inspection against the bracket spec.
- 2024-05-20 13:00 — First-article inspection passed with one waived cosmetic deviation; expedited qualification approved by QA.
- 2024-05-21 10:00 — Spot PO-88602 placed with [ALT-SUPPLIER-1]; deposit wired same day per restructuring-safe payment terms reviewed by legal.
- 2024-05-29 08:30 — PO-88412 (52,000 units) ships from Guadalajara as committed; Elif K. confirms clean border crossing paperwork.
- 2024-06-05 07:45 — PO-88412 received at RNO-1 in full; cover for [SKU-BRKT-A] extends to mid-July.
- 2024-06-18 06:50 — First spot-buy tranche (48,000 units) from [ALT-SUPPLIER-1] received at PDX-1; balance arrives 2024-06-27.
- 2024-06-30 — Projected stockout window fully covered; both SKUs above safety stock in all three DCs.
- 2024-06-10 15:00 — Post-incident review held (interim, while remaining tranches in transit); incident moved to monitoring.

## Root Cause

Cascadia carried single-source exposure on two bracket SKUs — including one velocity class A item — with no qualified alternate and no financial-health monitoring of the supplier. Guadalajara Metalworks' filing was not the trigger of the risk, only its realization: quarterly business reviews had noted lengthening payment-term requests since late 2023, a classic distress signal that was never escalated.

Contributing factors:

- The dual-sourcing guideline existed only as informal practice, not a rule tied to velocity class; both SKUs slipped through.
- No supplier financial-risk screen (D&B or equivalent) was run at annual review; see: Supplier risk review SOP.
- Alternate qualification normally takes 10-12 weeks; nothing had been pre-staged, so the bridge depended on a waived-deviation expedite.

## Resolution

- Bridged the 6-week gap with a 96,000-unit spot buy from [ALT-SUPPLIER-1] at +18% cost; both SKUs held above safety stock throughout.
- Secured shipment of the in-production PO-88412 (52,000 units) from Guadalajara Metalworks before working-capital uncertainty could halt it.
- Cancelled PO-88437 and PO-88519 without penalty under the force-majeure-adjacent clause; deposits recovered in full.
- Completed expedited qualification of [ALT-SUPPLIER-1] as an ongoing second source for the bracket line.
- Legal reviewed all payments to the restructuring supplier to avoid clawback exposure.
- Guadalajara Metalworks retained as a supplier pending restructuring outcome, capped at 50% share of bracket volume.

## Action Items

- [x] Qualify [ALT-SUPPLIER-1] for ongoing bracket volume, not just spot (owner: [PROC-LEAD], done 2024-06-06).
- [ ] Adopt formal dual-sourcing rule: any SKU above velocity class B must have a second qualified source or a documented exception (owner: Reyna M., due 2024-07-15).
- [ ] Add an annual supplier financial-health screen to the vendor review checklist; see: Supplier risk review SOP (owner: [PROC-LEAD], due 2024-07-31).
- [ ] Audit the full catalog for other single-source SKUs above class B; publish exposure report (owner: [PROC-LEAD], due 2024-08-15).
- [x] Document restructuring-safe payment guidance with legal for distressed suppliers (owner: [PROC-LEAD], done 2024-06-09).
- [ ] Set Ledger reorder-point alerts to flag when days-of-cover on a single-sourced SKU drops below 45 (owner: Reyna M., due 2024-07-31).
- [ ] Re-assess Guadalajara Metalworks volume cap at restructuring milestone hearings (owner: [PROC-LEAD], recurring, first check 2024-09-01).
