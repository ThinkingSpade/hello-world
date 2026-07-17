---
id: sc-cycle-count
title: ABC Cycle Count Procedure
type: runbook
service: warehouse
tags: [inventory, cycle-count, accuracy]
updated: 2024-09-05
---

## Overview

ABC cycle counting keeps on-hand accuracy above target (98.5% by location, 99.5% by value) without shutting down for full physical inventories. Applies to PDX-1, RNO-1, and CMH-1. Program owner: Reyna M.; site execution: warehouse leads (Tom B. at PDX-1).

Class frequencies: A items (top 80% of pick lines) monthly, B items quarterly, C items twice per year. New SKUs get a first count 30 days after first receipt.

## Preconditions

- Counter holds Ledger role `WH_COUNTER`; adjusters hold `INV_ADJUST`; approvers hold `INV_APPROVE`. No single person holds all three.
- Count zone has no open receipts or unshipped waves (check the dock board; see the Inbound Receiving Dock SOP).
- Blind count mode is enabled in Ledger (`count.blind=true`); counters must never see system quantity.
- RF scanner assigned and logged in under the counter's own ID.
- Prior day's variances are fully dispositioned.

## Steps

1. **Generate the count list.**

   ```bash
   ledger count schedule --dc PDX-1 --class A --date 2024-09-05 --assign tbaker
   ```

2. **Freeze the locations.** Ledger soft-freezes each location for picking while its count task is open. Never count a location with an active pick task.

3. **Perform the blind count.** Scan location, scan SKU, key the counted quantity. Count full cases and loose eaches separately; open cartons are counted by each.

4. **Submit and check variance.** Ledger compares against system quantity only after submission:

   ```bash
   ledger count submit --task CT-45102
   ledger count variance --task CT-45102
   ```

5. **Apply recount rules.** Variance within tolerance (A: 0 units or under $50; B: up to 2 units or $100; C: up to 5 units or $250) auto-clears. Outside tolerance: a second blind count by a different counter. If the recount matches the first count, proceed to adjustment; if all three numbers differ, the site lead runs a supervised count.

6. **Request the adjustment.** Adjustments post only with a distinct approver:

   ```bash
   ledger inventory adjust --loc PDX1-A-014-02 --sku MEK-TSH-1101 --qty -3 --reason COUNT_VARIANCE --approver reyna.m
   ```

7. **Record root cause for large variances.** Any single adjustment over $500 or over 10% of location quantity requires a root-cause note in Ledger (mis-putaway, short pick, receiving error, unrecorded damage).

8. **Close the day.** All count tasks in `CLOSED` or `ESCALATED`; post the daily accuracy number to the ops channel before end of shift.

## Verification

- Daily location accuracy by DC:

  ```sql
  SELECT dc, COUNT(*) FILTER (WHERE variance_qty = 0)::numeric / COUNT(*) AS loc_accuracy
  FROM ledger.count_tasks
  WHERE count_date = CURRENT_DATE
  GROUP BY dc;
  ```

- No count task left in `OPEN` state overnight.
- Every adjustment line shows an approver distinct from the counter.

## Rollback

- A wrong adjustment is never edited in place; post a reversing adjustment that references the original:

  ```bash
  ledger inventory adjust --reverse ADJ-88121 --reason COUNT_CORRECTION --approver reyna.m
  ```

- If a count batch was generated for the wrong class or date, cancel unstarted tasks with `ledger count cancel --batch CB-2201`. Started tasks must be completed or escalated, never deleted.

## Escalation

1. Site warehouse lead for three-way count mismatches and any suspected shrink pattern.
2. Reyna M. for adjustments over $2,500 (sole holder of `INV_APPROVE_L2`).
3. Compliance desk immediately if a counted lot is on hold under the Product Recall Execution Procedure.
