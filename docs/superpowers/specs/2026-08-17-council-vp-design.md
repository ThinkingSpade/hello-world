# Council: the visitor takes the VP role

2026-08-17 · approved by Huy (approach A: reshape around the machinery)

## The problem

/council/ never states its premise. The sample case (demo/brief.md: the "Series 400"
consumables simplification; a deck claims sell-through fell 9.4%) is a complete story the
page never tells. Worse, the flagship "Run the whole case" autopilot **approves gates 1-2
itself** (app.js ~1509, ~1519) — the machine signs, on a page whose thesis is "models argue,
engines compute, a person signs."

## The experience (all three decided with Huy)

1. **Every run stops at the gates. The visitor signs.** No autopilot approval, ever.
2. **A bundle lands on your desk.** One focused panel per gate: plain-English summary from
   live state, flag chips, [Sign] [Send back]. Detail one click away.
3. **The room is the stage; detail stays behind the rail.** The existing stage system
   (`section.stage[data-stage]` + `.c-step` rail) already collapses the nine windows — keep
   it. New: case card + desk.

## Hard constraints

- **ZERO changes under `council/floor/` and to `council/agents.js`.** The office layout,
  sprites, walking, animation, attract mode, gates scrubber are visually frozen (Huy,
  explicitly). The room choreography for gate stops already works with no changes:
  `railStatus()` writes "awaiting approval" into `#rail`, `watchGates()` in agents.js sees
  it and sends the analyst out; `Bench.gavel()` fires on `setGate(..., "approved")`.
- `app.js` engines/parsers/state untouched except the listed surgical edits.
- All existing element IDs keep working. Manual approve buttons in the stages stay.

## New DOM (owner: index.html)

Insert between the header and the bench section (`section.pwin` containing `#bench`):

```html
<section class="pwin c-case" id="vp-case">
  <div class="pwin-title"><span class="pwin-lamp on"></span>the case<span class="c-count" id="vp-case-count">sample</span></div>
  <div class="pwin-body" id="vp-case-body">
    <p><b>Series 400, simplified.</b> Four legacy SKUs were consolidated into two; retailers
    were told to send legacy stock back. The deck on your desk claims sell-through fell
    <b>9.4%</b> and wants that number in front of leadership.</p>
    <p>Fifteen auditors will take the analysis apart — the grain, the definitions, the
    counter-story. Engines compute every figure twice. <b>You are the VP: nothing becomes
    true until you sign it.</b></p>
  </div>
</section>
```

Insert directly after the bench section, before the rail:

```html
<section class="pwin c-desk" id="vp-desk">
  <div class="pwin-title"><span class="pwin-lamp" id="vp-desk-lamp"></span>your desk<span class="c-count" id="vp-desk-count">nothing waiting</span></div>
  <div class="pwin-body" id="vp-desk-body">
    <p class="c-empty">Nothing is awaiting your signature. Take the case and the first
    bundle will be walked over.</p>
  </div>
</section>
```

Copy changes in index.html:
- `#btn-auto-top` and `#btn-auto` text: `▶ Take the case`
- Header subtitle gains a second line (keep the doctrine line):
  `<span class="c-sub c-sub-fiction">fifteen auditors review the analysis — you sign what becomes true</span>`
- Intake explainer paragraph: reword to say the run **stops at each gate for your
  signature** (replaces "clears every gate ... no clicking").
- Add `<script type="module" src="vp.js"></script>` is NOT needed — app.js imports vp.js.

## vp.js (new module, owner: vp.js)

No imports from app.js (app.js imports vp.js — no cycle). API:

```js
export function initVP({ approveGate, getState, stage });
// wires the desk + case card, listens for document CustomEvent "council:gate"

export function stopAtGate(id);
// id ∈ {"data_contract","calc_definitions","final_recommendation"}
// renders the bundle into #vp-desk-body, sets lamp warn + count "gate N · waiting on you",
// scrolls the desk into view, returns a Promise that resolves when that gate's
// "council:gate" approved event arrives (however triggered — bundle Sign or stage button).

export function cancelStop();
// autopilot stopped/errored: RESOLVES any pending stopAtGate promise (so the run's await
// returns and its own `if (cancelled) return` exits), restores the desk idle state.
// Safe no-op when nothing is pending. The autopilot's stop-button handler must call this,
// not only the finally block — finally cannot run while the await is still parked.

export function caseCardToOwn();
// flips #vp-case to "your case" mode: title count "your files", body = files count,
// cells, sheets from getState() — called when the user loads non-demo files.
```

Bundle rendering rules — **from live state, no hardcoded case facts**:
- Common: heading `GATE n · <name>`, 3-5 `<li>` summary lines, chips row, buttons
  `[Sign] [Send back]`, small print: what signing unlocks (from S.gates[id].blocks).
- `data_contract`: lines from the contract profile (grain, rows/keys, split-vs-duplicate
  counts, excluded/partial periods, sentinel quarantine note if any). Derive from the same
  data app.js renders into `#contract-body` (read S via getState()).
- `calc_definitions`: spec count, one line per measure family (name + collapse rule),
  "every figure is computed twice — SQL and an independent reducer".
- `final_recommendation`: the headline claim(s) with their reconciliation status, dissent
  count and dissenting seats by name, "signing preserves dissent in the export".
- Sign → calls approveGate(id). Do not resolve the promise directly — wait for the
  "council:gate" event, so stage-button approvals resolve the same stop.
- Send back → calls stage(mapped) (`data_contract`→"contract", `calc_definitions`→"calc",
  `final_recommendation`→"report"), adds `.c-contested` highlight to that stage's approve
  button row, desk shows "you're reviewing — the bundle waits"; when the gate event
  eventually fires the stop resolves as normal.
- External evidence: never a stop. When getState().research has retrieved items, desk
  footer line: "n external items are quarantined — admit them individually in External."

## app.js surgical edits (owner: app.js — keep to exactly these)

1. `import { initVP, stopAtGate, cancelStop, caseCardToOwn } from "./vp.js";`
   and call `initVP({ approveGate, getState: () => S, stage })` during boot.
2. `setGate()`: after status change, add
   `document.dispatchEvent(new CustomEvent("council:gate", { detail: { id, status } }));`
3. Autopilot: replace `await approveGate("data_contract")` with `await stopAtGate("data_contract")`,
   same for `calc_definitions`; after "building the decision record" add a final
   `await stopAtGate("final_recommendation")` before "done". Banner labels become
   "waiting at gate 1 — the bundle is on your desk", etc. Progress bar pauses at stops.
   In the `finally`/cancelled paths call `cancelStop()`.
4. Non-demo file loads (drop/pick paths, NOT loadDemo) call `caseCardToOwn()` once files
   are parsed.
5. Autopilot banner text "▶ autopilot" → "▶ the case".

## theme.css additions (owner: index.html agent)

`.c-case`, `.c-desk` (accent-soft title like other pwins; desk lamp warn when waiting),
bundle internals (`.c-bundle h3`, `.c-bundle ul`, `.c-bundle .chips`, sign/send-back row —
reuse `.pbtn`/`.pbtn.primary`), `.c-contested { outline: 2px solid var(--pi-warn); }`,
`.c-sub-fiction` (block, muted). Match existing pixel chrome; no new fonts/colors.

## Acceptance

- "Take the case" with no files: loads sample, runs to gate 1, STOPS. Desk shows bundle
  with real contract numbers. Sign → room stamps (existing), run continues. Gate 2 same.
  Council deliberates. Gate 4 bundle lists dissent; sign → export unlocks. Autopilot never
  calls approveGate.
- Send back at gate 2 opens the calc stage highlighted; approving from the stage button
  resolves the same stop.
- Own files: case card flips to "your case"; flow identical.
- `git diff --stat` shows NO changes under council/floor/ or to agents.js.
- No console errors; 390px: desk/bundle fit without horizontal scroll; reduced-motion
  unaffected (office untouched).
