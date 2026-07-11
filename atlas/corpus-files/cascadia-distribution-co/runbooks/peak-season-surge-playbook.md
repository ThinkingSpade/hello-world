---
id: sc-peak-surge
title: Peak Season Surge Playbook
type: runbook
service: operations
tags: [peak, capacity, staffing]
updated: 2024-10-20
---

## Overview

Playbook for running Cascadia Distribution Co. through peak season (October 15 through January 15) across PDX-1, RNO-1, and CMH-1. Covers forecast triggers, temp staffing, carrier capacity pre-booking, cutoff changes, and the daily operating cadence. Owner: Reyna M.

Surge tiers, based on the rolling 4-week forecast vs. trailing baseline:

| Tier | Forecast vs. baseline | Posture |
| --- | --- | --- |
| Tier 1 | 120% or more | Extended shifts, first temp cohort |
| Tier 2 | 150% or more | Full temp ratios, earlier cutoffs, weekend waves |
| Tier 3 | 185% or more | Overflow routing to RNO-1, ship-complete relaxed to ship-partial |

## Preconditions

- Weekly demand forecast published in Ledger by Friday 12:00 local (`ledger forecast surge-status` returns current tier per DC).
- Temp agency MSAs signed by September 1; badge and Ledger account provisioning tested.
- Carrier capacity commitments confirmed by October 1 by Jordan P.: weekly FTL slots with BlueRidge Freight and daily parcel pickup caps with SwiftParcel.
- Ledger labor module loaded with peak shift patterns and temp cost codes.

## Steps

1. **Check the tier every Monday and act on changes.**

   ```bash
   ledger forecast surge-status --dc PDX-1 --window 4w
   ```

2. **Staff to ratio.** Target 1 temp per 2 core associates in outbound; cap temps at 30% of headcount in receiving and 0% in cycle counting. Every temp pairs with a trained buddy for the first 3 shifts; temps never approve adjustments or drive reach trucks.

3. **Draw down pre-booked carrier capacity.** Release the week's committed FTL slots against forecast by Tuesday; unused slots convert to spot availability Thursday. Rate and tender rules stay per Carrier Rate Shopping and Tender; peak does not authorize off-contract moves.

4. **Move cutoffs at Tier 2.** Order cutoff shifts from 14:00 to 12:00 local; publish to customers at least 7 days before the change takes effect:

   ```text
   Subject: Peak-season order cutoff change effective <DATE> - Cascadia Distribution Co.
   From <DATE>, same-day processing requires orders by 12:00 local DC time.
   Orders after cutoff process next business day. Standing EDI orders are unaffected.
   ```

5. **Run the daily cadence.** Non-negotiable during any active tier:
   - 07:30 tier call: yesterday's misses, today's labor plan, carrier exceptions (site leads plus Jordan P.).
   - 13:00 carrier check: pickup confirmations and trailer pool status.
   - 17:00 scorecard: units shipped, cutoff compliance, dock-to-stock hours, posted to the ops channel.

6. **Route overflow at Tier 3.** RNO-1 absorbs PDX-1 overflow for dual-stocked A-class SKUs; Ledger order routing flips via the `PEAK_OVERFLOW` rule set. Inbound appointments rebalance per the Inbound Receiving Dock SOP capacity board.

7. **Re-slot weekly.** Promote surging SKUs into ground pick faces each Sunday night; defer all non-urgent projects (re-profiling, full-zone counts) until January.

## Verification

- Daily scorecard from Ledger:

  ```sql
  SELECT dc, units_shipped, orders_missed_cutoff, dock_to_stock_hours, temp_units_per_hour
  FROM ledger.peak_scorecard
  WHERE score_date = CURRENT_DATE;
  ```

- Cutoff compliance at 98% or better; dock-to-stock under 24 hours at every DC.
- Temp productivity reaches 75% of core rate by shift 5; below that, retrain or release.

## Rollback

- Ramp down after 2 consecutive weeks under 110% of baseline: release temp cohorts per agency notice periods, newest cohorts first.
- Restore 14:00 cutoffs with the same 7-day customer notice used to change them.
- Cancel unused BlueRidge Freight FTL pre-books before the weekly penalty deadline (Wednesday 17:00); Jordan P. owns the cancellation log.

## Escalation

1. Reyna M. for tier changes, cutoff decisions, and any two consecutive days of missed scorecard targets.
2. Jordan P. for carrier capacity shortfalls or SwiftParcel pickup cap breaches.
3. Site leads (Tom B. at PDX-1) hold stop-work authority for safety incidents regardless of tier; safety overrides every target in this playbook.
