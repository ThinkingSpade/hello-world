# Helmsman — agentic DevOps copilot

Kubernetes is Greek for *helmsman*. This one watches the cluster, reads the
logs when something breaks, explains the likely cause in plain English, and
drafts the `kubectl` fix — **and applies nothing without a human yes**. The
approval gate is code, not convention: mutating commands are refused at the
subprocess layer unless the pipeline has an explicit approval in hand.

Live replay demo: [hnguyen.dev/helmsman](https://hnguyen.dev/helmsman/)

## The pipeline

```
page ──▶ triage ──▶ gather ──▶ diagnose ──▶ propose ──▶ HUMAN GATE ──▶ apply ──▶ verify
                                                            │
                                                            └── declined → stop, cluster untouched
```

- **Triage/gather** — `kubectl get/describe/logs/events`, all read-only.
- **Diagnose** — the evidence bundle is matched against vetted failure
  signatures (OOM crash loops, ImagePullBackOff, readiness-probe drift,
  missing config). Every diagnosis carries verbatim evidence lines as
  receipts and a confidence grade.
- **Propose** — each signature drafts a fix *from a template*: the exact
  command, why, a risk grade, the rollback (staged up front), and the
  follow-up that fixes the root cause. No free-form command generation.
- **The gate** — `approve_cb` is the only path to a mutation. Decline it
  and the run ends read-only with the evidence bundle saved.
- **Verify** — re-check the workload after applying; if it's not green,
  Helmsman says so and hands the staged rollback to a human.

## Safety posture

- `Kubectl.run()` raises on any mutating command unless the approval gate
  explicitly unlocked it — tested, not promised.
- Unknown failure? Helmsman says "no known signature, needs human eyes"
  and never even asks for approval.
- With an API key (`pip install -e ".[llm]"`), a model rewrites the cause
  narrative for humans — but proposals still come from the templates,
  because "creative" is not a word you want near a kubectl command.

## The demo is a real run

`helmsman record --fixture oom-crashloop -o session.json` runs the actual
pipeline against a canned cluster fixture (real kubectl output text, a
deterministic fake executor) and emits the replay the demo player shows —
same code path as a live incident, minus the cluster. Nothing in the
replay is hand-animated dialogue.

```bash
pip install -e ".[dev]"
python -m pytest                     # 9 tests, fully offline
helmsman fixtures                    # list bundled incidents
helmsman record --fixture image-pull -o out.json
helmsman incident -n prod -l app=checkout-api        # against a real kubeconfig
helmsman incident -n prod -l app=checkout-api --read-only
helmsman watch -n prod --interval 60                 # report-only watcher
```

## Layout

```
helmsman/            engine: kube.py (real + fake kubectl, mutation guard),
                     signatures.py (failure signatures + fix templates),
                     pipeline.py (the gate), llm.py (optional narrator), cli.py
helmsman/fixtures/   canned incidents (kubectl output text + recovery state)
helmsman/ui/         the bridge replay player + recorded sessions
tests/               pytest suite (runs fully offline)
```
