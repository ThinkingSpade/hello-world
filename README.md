# Oracle — a council of debating agents

A skeptic, an optimist, a fact-checker, and a wildcard — each seat wired to
a different frontier model (Gemini, GPT, Claude, Grok) — debate a question
across three rounds. A moderator synthesizes the answer, and the confidence
score is computed from where they disagreed. **The disagreement is the
metric.**

House style: every seat is prompted to talk like a colleague in a meeting
(not a press release) and to cite sources by name — the replay player
renders each message's citations as receipt chips.

Live replay demo: [hnguyen.dev/oracle](https://hnguyen.dev/oracle/)

## The protocol (LangGraph state machine)

```
brief ──▶ openings ──▶ cross_examination ──▶ final_votes ──▶ moderate
```

- **The briefing** — before anyone argues, a neutral Researcher circulates
  a dossier: the most decision-relevant, checkable facts, each with a named
  source, plus a flag on where the evidence is thinnest. Every seat gets the
  same copy, so the debate starts from a shared evidence pool.
- **Openings** — each agent argues its position independently (they see the
  dossier, never each other's openings — no anchoring) and states a
  self-confidence (0–100).
- **Cross-examination** — each agent sees the others' positions and rebuts
  the weakest claim it finds (concessions encouraged; personas are
  good-faith, not theatrical).
- **Final votes** — `VOTE: <yes|no|qualified …> CONFIDENCE: <n>` parsed
  from each agent.
- **Moderation** — a synthesis that must name the unresolved crux.

## Confidence from disagreement

```
final = 0.45 · consensus  +  0.45 · mean self-confidence  +  0.10 · (50 + convergence)
```

- **consensus** — share of agent pairs whose final votes point the same way
- **mean self-confidence** — average of the final-round confidences
- **convergence** — how much the confidence spread narrowed from round 1
  (agents converging is evidence; agents digging in is a warning)

Every verdict shows its arithmetic: `consensus 33% · mean self-confidence
57% · convergence +57% → 51%`.

## Honesty note about the demo

The replay player at `/oracle/` plays **hand-scripted sample sessions** —
they demonstrate the real protocol and the real scoring math, but no model
generated those words (no API keys were burned for your entertainment; the
fact-checker's citations are real, checkable facts). The engine itself is
fully real: give it keys and the same player replays true recordings —

```bash
pip install -e ".[providers]"
export ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GEMINI_API_KEY=… XAI_API_KEY=…
oracle record "Should we adopt a monorepo?" -o oracle/ui/sessions/monorepo.json
```

(Grok rides the openai SDK against `api.x.ai`, so `XAI_API_KEY` needs no
extra package.)

`oracle record` emits the exact same session format the player consumes,
with real per-call latencies as the thinking pauses.

## Keyless mode

The entire protocol runs without any key via deterministic mock providers —
that's how the test suite exercises everything end to end:

```bash
oracle ask --mock "Will the demo work?"
python -m pytest        # 6 tests: parsers, protocol, schema, scoring, determinism
```

There's also a tiny API server: `oracle serve` → `POST /api/debate {question}`.

## Layout

```
oracle/            engine: models.py (provider adapters + mock),
                   council.py (LangGraph protocol + scoring), cli.py
oracle/ui/         the replay player (index.html) + sessions/*.json
tests/             pytest suite (runs fully offline)
```
