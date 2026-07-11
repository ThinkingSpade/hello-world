---
id: dg-error-rate-dashboard
title: Error rate by zone dashboard
type: diagram
service: platform
tags: [dashboard, error-rate, slo, zones, diagram]
updated: 2024-10-14
---

## What the dashboard shows

Thirty days of error rate per network zone (edge, service, data) against the
1.0% SLO line. The data zone hugs zero; the service zone idles around 0.2 to
0.3%; the edge zone runs hotter and briefly spiked to roughly 2% on October
12 during the partner-gateway certificate rotation drill - expected, brief,
and inside the drill's error budget (see: Renewing Edge TLS Certificates
Without Downtime).

## How to read it during an incident

A spike confined to the edge zone with flat service/data lines usually means
an upstream or partner problem (rate limiting, TLS, retry storms) rather
than an application bug - compare with INC-2408's shape in the payments-api
latency graph.
