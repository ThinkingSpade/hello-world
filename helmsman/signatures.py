"""Failure signatures: how Helmsman recognizes what broke, explains it in
plain English, and drafts a fix — with a risk grade and a rollback for
every proposal. The extractive path is fully deterministic (no API key),
which is also what makes the pipeline testable and the demo honest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Diagnosis:
    signature: str
    cause: str
    receipts: list[str] = field(default_factory=list)   # verbatim evidence lines
    confidence: int = 80


@dataclass
class Proposal:
    command: str            # the kubectl/helm command, ready to run
    explain: str            # why this fix, in plain English
    risk: str               # low | medium | high
    rollback: str           # the undo, drafted up front
    followup: str = ""      # what to do after the fire is out


def _grab(pattern: str, text: str, default: str = "") -> str:
    m = re.search(pattern, text, re.MULTILINE)
    return m.group(1) if m else default


def _receipts(bundle: str, patterns: list[str], limit: int = 4) -> list[str]:
    out = []
    for line in bundle.splitlines():
        if any(re.search(p, line) for p in patterns) and line.strip():
            clean = line.strip()
            if clean not in out:
                out.append(clean)
        if len(out) >= limit:
            break
    return out


class Ctx:
    """Everything the fix drafters need, parsed once from the evidence."""

    def __init__(self, namespace: str, bundle: str):
        self.namespace = namespace
        self.deploy = _grab(r"Controlled By:\s+ReplicaSet/([a-z0-9-]+?)-[a-z0-9]+$", bundle)
        self.container = _grab(r"Containers:\n\s+([a-z0-9-]+):", bundle)
        self.mem_limit = _grab(r"memory:\s+(\d+[GMK]i)", bundle)
        self.image = _grab(r"Image:\s+(\S+)", bundle)
        self.probe_port = _grab(r"Readiness:.*?:(\d+)", bundle)
        self.listen_port = _grab(r"listening on (?:0\.0\.0\.0:|port )(\d+)", bundle)


def _bump(mem: str) -> str:
    m = re.match(r"(\d+)([GMK]i)", mem or "256Mi")
    return f"{int(m.group(1)) * 2}{m.group(2)}" if m else "512Mi"


SIGNATURES = [
    {
        "id": "oom-crashloop",
        "match": [r"OOMKilled", r"Exit Code:\s+137"],
        "cause": lambda c, b: (
            f"The container is being OOM-killed: the kernel terminates it (exit 137) "
            f"every time it crosses its {c.mem_limit or 'configured'} memory limit, and "
            f"kubelet restarts it into the same wall — that's the crash loop. The limit "
            f"stopped fitting the workload; the logs show memory climbing right up to "
            f"the kill."),
        "receipts": [r"OOMKilled", r"Exit Code:\s+137", r"Back-off restarting",
                     r"memory:", r"heap|rss|allocat"],
        "propose": lambda c, b: Proposal(
            command=(f"kubectl -n {c.namespace} set resources deploy/{c.deploy} "
                     f"--limits=memory={_bump(c.mem_limit)} "
                     f"--requests=memory={c.mem_limit or '256Mi'}"),
            explain=(f"Double the memory limit ({c.mem_limit} → {_bump(c.mem_limit)}) so the "
                     f"service stops getting killed mid-request. This buys stability now; "
                     f"it does not fix why memory grew."),
            risk="medium",
            rollback=(f"kubectl -n {c.namespace} set resources deploy/{c.deploy} "
                      f"--limits=memory={c.mem_limit or '256Mi'}"),
            followup=("Open a ticket on the memory growth itself — if it's a leak, the "
                      "new limit only reschedules this page."),
        ),
        "confidence": 92,
    },
    {
        "id": "image-pull",
        "match": [r"ImagePullBackOff|ErrImagePull", r"not found|manifest unknown"],
        "cause": lambda c, b: (
            f"The rollout is pulling an image tag that doesn't exist "
            f"({c.image or 'see events'}): the registry answers 'manifest not found', so "
            f"new pods can never start. Old replicas are still serving — this is a bad "
            f"deploy, not an outage yet."),
        "receipts": [r"ImagePullBackOff|ErrImagePull", r"not found|manifest unknown",
                     r"Failed to pull image", r"Image:"],
        "propose": lambda c, b: Proposal(
            command=f"kubectl -n {c.namespace} rollout undo deploy/{c.deploy}",
            explain=("Roll back to the previous ReplicaSet, which is the last image that "
                     "actually exists. Zero-downtime: the old pods are still up."),
            risk="low",
            rollback=(f"kubectl -n {c.namespace} rollout undo deploy/{c.deploy} "
                      f"--to-revision=<failed-revision>  # to retry the new tag"),
            followup="Fix the tag in the pipeline (looks like a typo) and re-deploy.",
        ),
        "confidence": 95,
    },
    {
        "id": "readiness-probe",
        "match": [r"Readiness probe failed", r"connection refused|context deadline"],
        "cause": lambda c, b: (
            f"Pods run fine but never go Ready: the readiness probe checks port "
            f"{c.probe_port or '?'} while the app now listens on {c.listen_port or 'another port'} "
            f"— after the config change the probe is knocking on the wrong door, so the "
            f"Service won't route any traffic to the new pods."),
        "receipts": [r"Readiness probe failed", r"connection refused",
                     r"listening on", r"Readiness:"],
        "propose": lambda c, b: Proposal(
            command=(f'kubectl -n {c.namespace} patch deploy/{c.deploy} --type=json -p '
                     f'\'[{{"op":"replace","path":"/spec/template/spec/containers/0/'
                     f'readinessProbe/httpGet/port","value":{c.listen_port or 8080}}}]\''),
            explain=(f"Point the readiness probe at the port the app actually listens on "
                     f"({c.listen_port}). The pods are healthy; only the probe is wrong."),
            risk="medium",
            rollback=(f'kubectl -n {c.namespace} patch deploy/{c.deploy} --type=json -p '
                      f'\'[{{"op":"replace","path":"/spec/template/spec/containers/0/'
                      f'readinessProbe/httpGet/port","value":{c.probe_port or 8081}}}]\''),
            followup=("Decide which is canonical — probe or PORT env — and pin both in "
                      "the chart so they can't drift apart again."),
        ),
        "confidence": 88,
    },
    {
        "id": "config-error",
        "match": [r"CreateContainerConfigError", r"configmap .* not found|secret .* not found"],
        "cause": lambda c, b: (
            "Pods can't even be created: the spec references a ConfigMap/Secret that "
            "doesn't exist in this namespace, so kubelet fails at container-config time."),
        "receipts": [r"CreateContainerConfigError", r"not found"],
        "propose": lambda c, b: Proposal(
            command=f"kubectl -n {c.namespace} rollout undo deploy/{c.deploy}",
            explain="Roll back to the revision that shipped with its config present.",
            risk="low",
            rollback="Re-apply the new revision once the missing object exists.",
            followup="Create the missing ConfigMap/Secret, or fix the name in the chart.",
        ),
        "confidence": 90,
    },
]


class ExtractiveDiagnoser:
    """Keyless, deterministic: match the evidence bundle against known
    signatures. An LLM diagnoser can layer on top; this is the floor."""

    name = "extractive"

    def diagnose(self, namespace: str, bundle: str) -> tuple[Diagnosis, Proposal] | None:
        ctx = Ctx(namespace, bundle)
        for sig in SIGNATURES:
            if all(re.search(p, bundle) for p in sig["match"]):
                d = Diagnosis(
                    signature=sig["id"],
                    cause=sig["cause"](ctx, bundle),
                    receipts=_receipts(bundle, sig["receipts"]),
                    confidence=sig["confidence"],
                )
                return d, sig["propose"](ctx, bundle)
        return None
