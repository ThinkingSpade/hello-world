# Business case: consumables portfolio simplification

*Sample brief shipped with the application so the pipeline can be demonstrated
end to end without uploading anything. The figures below are synthetic.*

## Background

A mature consumables family (the "Series 400") has been simplified. Four legacy
SKUs were consolidated into two replacement SKUs:

| Legacy | Replacement |
|---|---|
| 400 Black (standard yield) | 400 XL Black |
| 400 XL Black (high yield) | 400 XL Black |
| 400 Tri-color (standard yield) | 400 Tri-color |
| 400 XL Tri-color (high yield) | 400 Tri-color |

The replacements carry a different yield architecture and a different price
architecture. Retailers introduced them on different dates. Retailers were
instructed to return legacy inventory, so legacy stock was withdrawn from the
shelf rather than sold down.

## Available information

A workbook with two tabs.

**Reference** — SKU list, legacy/new classification, family mapping, short
description, black/color, yield type, rated yield, and an MSRP index.

**Raw Data** — weekly sell-through units and weekly on-hand inventory units by
retailer and SKU, spanning periods before and after the transition.

No additional data should be assumed beyond what is provided.

## Assignment

1. **Assess performance.** How is the transition performing? Cover overall
   performance, adoption of the new products, progress of the transition, and
   the key trends in the data.
2. **Identify the drivers.** Separate what the evidence supports from what
   remains hypothesis.
3. **Recommend.** Assessment, risks, opportunities, next steps, and your
   confidence level.
4. **Ask for what is missing.** For each item, why it matters and how it would
   change the analysis.

## Context that arrived after the brief

- Retailers were instructed to return legacy inventory. Rapid uptake of the new
  SKU therefore should **not** be read as a success metric, because both the
  retailer's ability to keep selling legacy stock and the customer's ability to
  buy it were constrained.
- The strategy's goal was to simplify a lineup approaching end of life. The
  installed base was already shrinking and demand was already declining before
  launch. Success means replacing two SKUs with one **while retaining demand
  from both standard- and high-yield buyers**, ideally without materially
  altering the existing demand trend.
- Look at **unit price** as well as cost per page. Buyers in this category are
  sensitive to the upfront purchase price and are often less responsive to a
  long-run value argument.
- The final week in the dataset is a **partial week**. Volume looks lower for
  that reason alone.

## Why this is a good test of the council

Every design principle gets exercised:

- The grain is not what it looks like. Some weeks straddle a fiscal month
  boundary and appear twice — units are split across the two segments, but
  inventory is the *same snapshot recorded twice*. Summing both columns is the
  obvious move and it is wrong for one of them.
- The final period is incomplete and will drag any trailing average down.
- Adoption looks spectacular and means almost nothing, because the channel was
  instructed to switch.
- The headline unit decline is dominated by a yield mix change, not by demand.
- Cost per page improves for three of the four buyer groups while the upfront
  price rises sharply for the largest one — the two lenses disagree, and which
  one you lead with changes the recommendation.
- Nothing in the data identifies a customer, so retention cannot be observed at
  all. That is a limitation, not a finding, and the difference matters.
