---
id: dg-capacity-dashboard
title: Capacity headroom dashboard
type: diagram
service: platform
tags: [dashboard, capacity, utilization, scaling, diagram]
updated: 2024-11-30
---

## What the dashboard shows

Peak (p95) utilization against the configured limit for each major service.
Green bars sit under 50%, gold between 50 and 65, coral above 65. The
scale-up trigger is the red line at 75%: search-indexer (68%) is the only
service approaching it, consistent with its reindex backlog alerts (see:
Alert history 2024). The instance-class ceiling context for the database
tier lives in the Postgres HA architecture review.

## How to read it during an incident

If a service is degraded but its bar is green, look at dependencies rather
than capacity - the bottleneck is usually the data tier or an upstream
limiter, not CPU.
