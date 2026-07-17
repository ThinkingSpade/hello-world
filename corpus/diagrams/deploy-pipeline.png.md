---
id: dg-deploy-pipeline
title: Deploy pipeline diagram
type: diagram
service: platform
tags: [deploy, ci-cd, canary, diagram]
updated: 2024-09-18
---

## What the diagram shows

The Meridian deploy pipeline: git push → CI tests → image build → staging →
canary at 5% of traffic → production at 100%. The canary gate holds for 10
minutes and requires error rate below 0.5% and p95 latency below 300 ms; a
failed gate triggers an automatic `helm rollback` to the previous revision
(drawn as the red return path in the diagram).

## How to read it during an incident

If a bad deploy made it past the canary, the manual path is the same
mechanism — see "Rolling Back a Bad Production Deploy with Helm". The
canary gate metrics come from the edge, so an incident that only affects
internal traffic can pass the gate; that gap is a known action item.
