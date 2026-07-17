---
id: dg-payments-latency-0722
title: payments-api latency graph, July 22 outage
type: diagram
service: edge
tags: [payments, latency, outage, grafana, diagram]
updated: 2024-07-23
---

## What the graph shows

Grafana panel of payments-api p95 latency on 2024-07-22 (UTC). Baseline
p95 sits near 120 ms. At 13:47 latency climbs past 800 ms as the partner
retry storm begins; the marked SEV1 window runs 13:47–14:30. The spike
collapses back to baseline within two minutes of the rate-limiter scope fix
deploying — the sharp cliff on the right edge of the marked window.

## Context

This is the primary exhibit for incident INC-2408 ("Global Rate Limiter
Trips on Partner Retry Storm"). The limiter was miscounting internal health
checks toward the global budget, so the partner's retry amplification
pushed legitimate payments traffic into 429s. Full post-mortem: see the
incident doc; prevention items landed as per-tenant limits and retry
budgets at the gateway.
