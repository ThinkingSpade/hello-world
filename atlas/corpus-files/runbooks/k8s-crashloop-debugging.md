---
id: rb-k8s-crashloop
title: Debugging a CrashLoopBackOff Pod
type: runbook
service: platform
tags: [kubernetes, crashloop, debugging]
updated: 2024-09-27
---

## Overview

A pod in `CrashLoopBackOff` is being restarted repeatedly with exponential
backoff. This runbook walks through triaging the three most common causes on
Meridian clusters — OOMKill, bad configuration, and a failing dependency — and
applying safe remediation without masking the underlying fault. Recent example:
search-indexer crashlooping after a cache eviction event (see: "Redis Memory
Pressure Evicts Session Keys").

## Preconditions

- `kubectl` context set to the affected cluster (`meridian-prod-1` or `-2`).
- Read access to the service namespace; `deploy` role if you may need to roll back.
- Know the owning team's Helm release name (e.g. `search-indexer`).

## Steps

1. Identify the pod and confirm the restart pattern:

```shell
kubectl -n search get pods -l app=search-indexer -o wide
kubectl -n search get events --sort-by=.lastTimestamp | tail -30
```

2. Read `describe` output — the `Last State`, `Reason`, and `Exit Code` fields
   are the fastest signal:

```shell
kubectl -n search describe pod search-indexer-6d8f7c9b4-x2lqp
```

   - `Reason: OOMKilled` / exit code 137 → memory. Go to step 4.
   - Exit code 1 or 2 crashing immediately → likely bad config. Go to step 5.
   - Non-zero exit after ~30s of running → likely failing dependency. Go to step 6.

3. Pull logs from the PREVIOUS container instance (the current one may have
   logged nothing yet):

```shell
kubectl -n search logs search-indexer-6d8f7c9b4-x2lqp --previous --tail=200
```

4. OOMKill path. Compare working set to the limit and check for a recent
   traffic or heap-size change before raising limits:

```shell
kubectl -n search top pod -l app=search-indexer
kubectl -n search get pod search-indexer-6d8f7c9b4-x2lqp \
  -o jsonpath='{.spec.containers[0].resources}'
```

   Raise limits only via the Helm values file, never `kubectl edit`:

```shell
helm upgrade search-indexer charts/search-indexer -n search \
  --reuse-values --set resources.limits.memory=1536Mi
```

5. Bad config path. Diff the live ConfigMap against the last good release
   revision and look for a recently merged change:

```shell
kubectl -n search get configmap search-indexer-config -o yaml
helm -n search history search-indexer
helm -n search diff revision search-indexer 41 42
```

6. Failing dependency path. Attach a debug container and probe whatever the
   previous-container logs complain about:

```shell
kubectl -n search debug -it search-indexer-6d8f7c9b4-x2lqp \
  --image=busybox:1.36 --target=indexer -- sh
wget -qO- http://auth-svc.auth.svc.cluster.local:8080/healthz
```

7. Remediate: fix config forward, roll back the Helm release, or restore the
   dependency — do not delete pods in a loop to "clear" the state.

```shell
helm -n search rollback search-indexer 41
```

## Verification

- Pod reaches `Running` with `READY 1/1` and the restart count stops
  increasing over 10 minutes: `kubectl -n search get pods -w`.
- `kubectl -n search get events` shows no new `BackOff` events.
- The service SLO dashboard (latency and error rate) returns to baseline.

## Rollback

If the remediation itself regresses the service, `helm rollback` to the
revision recorded in step 5; prod clusters retain 10 Helm revisions. For a bad
resource-limit change, re-apply the previous values file from git rather than
hand-editing the live release.

## Escalation

- Page `#platform-oncall` if the crashloop affects more than one service.
- OOMKills across many pods on the same node → escalate to capacity planning
  and check `kubectl describe node` for memory-pressure taints.
- If the failing dependency is payments-api or auth-svc, open a SEV and page
  the owning team directly.
