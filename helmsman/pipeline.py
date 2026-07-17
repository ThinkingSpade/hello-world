"""The incident pipeline. One hard rule: nothing mutates the cluster
without an explicit human approval — the gate is code, not convention.

    page ──▶ triage ──▶ gather ──▶ diagnose ──▶ propose ──▶ GATE ──▶ apply ──▶ verify
                                                              │
                                                              └─ declined → stop, read-only

Every step is appended to a session timeline in the exact format the demo
player replays — `helmsman record` is just this pipeline pointed at a
fixture instead of a kubeconfig.
"""

from __future__ import annotations

import time

from .signatures import ExtractiveDiagnoser


class Incident:
    def __init__(self, kube, namespace: str, selector: str, diagnoser=None):
        self.kube = kube
        self.ns = namespace
        self.selector = selector
        self.diagnoser = diagnoser or ExtractiveDiagnoser()
        self.timeline: list[dict] = []
        self.start = time.monotonic()

    # -- timeline helpers ----------------------------------------------------
    def _step(self, t: str, **kw):
        self.timeline.append({"t": t, **kw})

    def _cmd(self, args: str, note: str, allow_mutation: bool = False) -> str:
        out = self.kube.run(args, allow_mutation=allow_mutation)
        self._step("cmd", cmd=f"kubectl {args}", out=out.rstrip("\n"), note=note)
        return out

    # -- the pipeline --------------------------------------------------------
    def run(self, approve_cb, page_text: str | None = None) -> dict:
        """approve_cb(proposal_dict) -> bool. The ONLY path to a mutation."""
        self._step("page", text=page_text or
                   f"ALERT: pods not healthy in {self.ns} ({self.selector})",
                   sev="P2")

        pods_out = self._cmd(f"get pods -n {self.ns} -l {self.selector}",
                             "triage: how wide is the blast radius?")
        victim = self._pick_victim(pods_out)
        self._step("think", ms=1600, status="reading the blast radius")

        bundle = pods_out
        bundle += self._cmd(f"describe pod {victim} -n {self.ns}",
                            "what does kubelet say about the victim?")
        bundle += self._cmd(f"logs {victim} -n {self.ns} --previous --tail=40",
                            "last words of the previous container")
        bundle += self._cmd(
            f"get events -n {self.ns} --field-selector involvedObject.name={victim} "
            f"--sort-by=.lastTimestamp",
            "the event stream never lies")
        self._step("think", ms=2200, status="matching against known failure signatures")

        found = self.diagnoser.diagnose(self.ns, bundle)
        if not found:
            self._step("diagnosis", signature="unknown", confidence=0,
                       cause=("No known signature matches. Evidence bundle attached — "
                              "this one needs human eyes before anyone touches anything."),
                       receipts=[])
            return self._session(victim, resolved=False)

        diag, prop = found
        self._step("diagnosis", signature=diag.signature, cause=diag.cause,
                   receipts=diag.receipts, confidence=diag.confidence)
        proposal = {"command": prop.command, "explain": prop.explain,
                    "risk": prop.risk, "rollback": prop.rollback,
                    "followup": prop.followup}
        self._step("proposal", **proposal)

        # ---- THE GATE: a human says yes, or nothing happens ----
        approved = bool(approve_cb(proposal))
        self._step("approval", decision="approved" if approved else "declined",
                   by="operator")
        if not approved:
            self._step("verify", result="held",
                       text="Proposal declined — no changes made. Cluster untouched, "
                            "evidence bundle saved for the human on call.")
            return self._session(victim, resolved=False)

        apply_args = prop.command.removeprefix("kubectl ").strip()
        out = self.kube.run(apply_args, allow_mutation=True)
        self._step("apply", cmd=prop.command, out=out.rstrip("\n"))
        self._step("think", ms=2000, status="watching the rollout")

        verify_out = self._cmd(f"get pods -n {self.ns} -l {self.selector}",
                               "verify: did the fix actually take?")
        healthy = self._healthy(verify_out)
        self._step("verify", result="green" if healthy else "red",
                   text=("All replicas Running and Ready — restarts flat. "
                         "Standing down." if healthy else
                         "Still unhealthy after the fix — escalating to a human, "
                         "rollback command is staged above."))
        return self._session(victim, resolved=healthy)

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _pick_victim(pods_out: str) -> str:
        rows = [l.split() for l in pods_out.splitlines()[1:] if l.strip()]
        for r in rows:  # prefer the loudest failure
            if any(s in r[2] for s in ("CrashLoopBackOff", "Error", "ImagePullBackOff",
                                       "CreateContainerConfigError")):
                return r[0]
        for r in rows:  # then anything not fully ready
            ready, want = r[1].split("/")
            if ready != want:
                return r[0]
        return rows[0][0]

    @staticmethod
    def _healthy(pods_out: str) -> bool:
        rows = [l.split() for l in pods_out.splitlines()[1:] if l.strip()]
        return all(r[2] == "Running" and len(set(r[1].split("/"))) == 1 for r in rows)

    def _session(self, victim: str, resolved: bool) -> dict:
        return {
            "namespace": self.ns, "selector": self.selector, "victim": victim,
            "resolved": resolved, "duration_s": round(time.monotonic() - self.start, 1),
            "timeline": self.timeline,
        }
