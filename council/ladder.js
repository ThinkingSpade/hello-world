/* ladder.js — how disagreement is settled, drawn.
 *
 * The resolution ladder is the most important mechanism in this application and
 * it was the least visible: four static rows with a count on each. A count tells
 * you that something was settled. It does not tell you what entered, which rung
 * caught it, what fell past to the next one, or what came out the far end —
 * which is the only part anyone should actually care about.
 *
 * So it is drawn as what it is. Contested points enter on the left. They fall
 * down the rungs in order. Each rung that fires sends its outcomes out to the
 * right; whatever it did not settle continues down. A rung that never fired is
 * shown dimmed rather than hidden, because "definition consistency never had to
 * be invoked" is itself a finding about the run.
 *
 * Every number here is counted from `resolutions`, and only from the contested
 * ones. An uncontested finding was never adjudicated, and folding it in would
 * make the ladder look busier — and the review look more rigorous — than it was.
 *
 * There is no vote in this file and there must never be one.
 *
 * See CONTRACT.md §9f.
 */
import { Converge } from "./converge.js";

const RUNGS = [
  { basis: "source_quality",           n: 1, name: "Source quality",
    gloss: "who cites the primary record" },
  { basis: "formula_reproducibility",  n: 2, name: "Formula reproducibility",
    gloss: "which spec reconciles across both engines" },
  { basis: "definition_consistency",   n: 3, name: "Definition consistency",
    gloss: "which reading matches the approved contract" },
  { basis: "human_judgment",           n: 4, name: "Human judgment",
    gloss: "escalated, never auto-resolved" },
];

/* Outcome vocabulary — shape, colour and word, same as everywhere else. */
const OUTCOME = {
  upheld:     { word: "upheld",     tone: "ok",   icon: "check" },
  overturned: { word: "overturned", tone: "err",  icon: "octagon" },
  escalated:  { word: "escalated",  tone: "warn", icon: "diamond" },
  unresolved: { word: "unresolved", tone: "",     icon: "bars" },
};

const WIRE_MIN_W = 860;

let host = null, stage = null, wiresEl = null, stopEl = null;
let entryEl = null, rungEls = [], exitEls = [], model = null, ro = null, raf = 0;

const arr = (v) => (Array.isArray(v) ? v : []);

/* ---------- derivation ---------- */

export function derive(resolutions) {
  const all = arr(resolutions);
  const contested = all.filter((r) => r.contested);

  const rungs = RUNGS.map((r) => {
    const here = contested.filter((c) => c.basis === r.basis);
    const outcomes = {};
    for (const c of here) outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
    return { ...r, decided: here.length, outcomes };
  });

  /* What reached each rung: everything contested, less whatever the rungs above
   * already settled. The ladder stops at the first rung that decides, so this
   * is a genuine cascade rather than four independent buckets. */
  let carried = contested.length;
  for (const r of rungs) {
    r.entering = carried;
    carried -= r.decided;
    r.fellThrough = carried;
  }

  return {
    contested: contested.length,
    uncontested: all.length - contested.length,
    rungs,
    fired: rungs.filter((r) => r.decided > 0).length,
  };
}

/* ---------- DOM ---------- */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function buildEntry(m) {
  const box = el("div", "cl-entry");
  box.dataset.tone = m.contested ? "accent" : "";
  box.appendChild(el("div", "cl-cap", "CONTESTED POINTS"));
  box.appendChild(el("div", "cl-big", String(m.contested)));
  box.appendChild(el("p", "cl-note", m.contested
    ? "Two or more seats reached different conclusions on the same point. Only these are adjudicated."
    : "No two seats reached different conclusions on the same point, so the ladder did not need to run."));
  if (m.uncontested) {
    box.appendChild(el("div", "cl-sub",
      `${m.uncontested} uncontested — not adjudicated, which is not the same as corroborated`));
  }
  return box;
}

function buildRung(r) {
  const box = el("div", "cl-rung");
  box.dataset.tone = r.decided
    ? (r.basis === "human_judgment" ? "warn" : "accent")
    : "";
  box.dataset.fired = r.decided ? "yes" : "no";

  const head = el("div", "cl-rung-head");
  head.appendChild(el("span", "cl-num", String(r.n)));
  const nm = el("div", "cl-rung-nm");
  nm.appendChild(el("div", "cl-rung-t", r.name));
  nm.appendChild(el("div", "cl-rung-g", r.gloss));
  head.appendChild(nm);
  const chip = el("span", "cl-chip", r.decided ? `settled ${r.decided}` : "did not fire");
  head.appendChild(chip);
  box.appendChild(head);
  return box;
}

function buildExit(basis, outcome, n) {
  const o = OUTCOME[outcome] || OUTCOME.unresolved;
  const box = el("div", "cl-exit");
  box.dataset.tone = o.tone;
  box.appendChild(Converge.icon(o.icon, "cv-ic"));
  box.appendChild(el("span", "cl-exit-n", String(n)));
  box.appendChild(el("span", "cl-exit-w", o.word));
  return box;
}

/* ---------- connectors ---------- */

function draw() {
  if (!model || !wiresEl) return;
  const links = [];

  /* Entry into the first rung that has anything to catch. */
  if (model.contested && rungEls[0]) {
    links.push({
      from: { el: entryEl, side: "right" },
      to: { el: rungEls[0], side: "left" },
      tone: "accent", solid: true,
    });
  }

  /* Fall-through between rungs, labelled with what survived the one above.
   *
   * Once nothing survives, the connector stops — drawing a line into a rung
   * that received nothing would claim a flow that did not happen. But the
   * ladder should not simply trail off either, so the first dead gap is
   * labelled: "the run stopped here" is a real result about the run, and the
   * dimmed rungs below it are the evidence. */
  let ended = false;
  for (let i = 0; i < rungEls.length - 1; i++) {
    const r = model.rungs[i];
    if (r.fellThrough) {
      links.push({
        from: { el: rungEls[i], side: "bottom" },
        to: { el: rungEls[i + 1], side: "top" },
        tone: "", solid: false,
        label: `${r.fellThrough} fell through`,
      });
    } else if (!ended && model.contested) {
      ended = true;
      stopEl.textContent = `nothing fell past rung ${r.n} — the rungs below were never invoked`;
      stopEl.hidden = false;
      positionStop(rungEls[i], rungEls[i + 1]);
    }
  }
  if (!ended || !model.contested) stopEl.hidden = true;

  /* Each rung out to its outcomes. */
  for (const ex of exitEls) {
    links.push({
      from: { el: rungEls[ex.rung], side: "right" },
      to: { el: ex.node, side: "left" },
      tone: ex.tone, solid: true,
    });
  }

  Converge.wires(wiresEl, stage, links, { minWidth: WIRE_MIN_W });
}

/* Sits in the gap between the last rung that fired and the first that never
 * did, measured rather than guessed so it stays put when a rung wraps. */
function positionStop(above, below) {
  const box = stage.getBoundingClientRect();
  const a = above.getBoundingClientRect();
  const b = below.getBoundingClientRect();
  stopEl.style.top = `${((a.bottom + b.top) / 2) - box.top}px`;
  stopEl.style.left = `${a.left - box.left + 12}px`;
}

function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

/* ---------- api ---------- */

export const Ladder = {
  mount(node) {
    Converge.injectCSS();
    injectCSS();
    host = node;
    host.innerHTML = "";
    host.classList.add("cv", "cl");

    stage = el("div", "cl-stage");
    wiresEl = Converge.svgEl("svg", { class: "cv-wires", "aria-hidden": "true" });
    stopEl = el("div", "cl-stop");
    stopEl.hidden = true;
    stage.appendChild(wiresEl);
    stage.appendChild(stopEl);
    host.appendChild(stage);

    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => schedule());
      ro.observe(stage);
    }
    return this;
  },

  derive,

  render(resolutions) {
    if (!host) return null;
    model = derive(resolutions);

    stage.innerHTML = "";
    stage.appendChild(wiresEl);
    stage.appendChild(stopEl);

    const colE = el("div", "cl-col cl-col-entry");
    entryEl = buildEntry(model);
    colE.appendChild(entryEl);

    const colR = el("div", "cl-col cl-col-rungs");
    rungEls = model.rungs.map((r) => {
      const n = buildRung(r);
      colR.appendChild(n);
      return n;
    });

    const colX = el("div", "cl-col cl-col-exit");
    exitEls = [];
    model.rungs.forEach((r, i) => {
      const slot = el("div", "cl-exit-slot");
      for (const [outcome, n] of Object.entries(r.outcomes)) {
        const node = buildExit(r.basis, outcome, n);
        slot.appendChild(node);
        exitEls.push({ rung: i, node, tone: (OUTCOME[outcome] || OUTCOME.unresolved).tone });
      }
      colX.appendChild(slot);
    });

    stage.appendChild(colE);
    stage.appendChild(colR);
    stage.appendChild(colX);

    schedule();
    return model;
  },

  destroy() {
    if (ro) { ro.disconnect(); ro = null; }
    cancelAnimationFrame(raf);
    host = stage = wiresEl = entryEl = null;
    rungEls = []; exitEls = []; model = null;
  },

  __selfTest,
};

/* ---------- self test ---------- */

function __selfTest() {
  const out = {};
  const R = (basis, outcome, contested = true) => ({ findingId: "f", basis, outcome, contested, dissent: [] });

  try {
    const m = derive([]);
    out.empty = m.contested === 0 && m.fired === 0 && m.rungs.length === 4
      ? "ok" : `error: ${JSON.stringify({ c: m.contested, f: m.fired })}`;
  } catch (e) { out.empty = `error: ${e && e.message}`; }

  /* Uncontested findings are never adjudicated and must not inflate the ladder. */
  try {
    const m = derive([R("source_quality", "upheld", false), R("source_quality", "upheld", true)]);
    out.uncontestedExcluded = m.contested === 1 && m.uncontested === 1 && m.rungs[0].decided === 1
      ? "ok" : `error: ${JSON.stringify({ c: m.contested, u: m.uncontested, d: m.rungs[0].decided })}`;
  } catch (e) { out.uncontestedExcluded = `error: ${e && e.message}`; }

  /* The cascade: what enters a rung is what the rungs above did not settle. */
  try {
    const m = derive([
      R("source_quality", "upheld"), R("source_quality", "overturned"),
      R("definition_consistency", "upheld"),
      R("human_judgment", "escalated"),
    ]);
    const r = m.rungs;
    const okEnter = r[0].entering === 4 && r[1].entering === 2 && r[2].entering === 2 && r[3].entering === 1;
    const okThrough = r[0].fellThrough === 2 && r[1].fellThrough === 2 && r[2].fellThrough === 1 && r[3].fellThrough === 0;
    out.cascade = okEnter && okThrough ? "ok"
      : `error: entering ${r.map((x) => x.entering)} fellThrough ${r.map((x) => x.fellThrough)}`;
  } catch (e) { out.cascade = `error: ${e && e.message}`; }

  /* A rung that never fired stays visible and reports zero rather than vanishing. */
  try {
    const m = derive([R("source_quality", "upheld")]);
    out.unfiredRungsKept = m.rungs.length === 4 && m.rungs[1].decided === 0 && m.fired === 1
      ? "ok" : `error: ${JSON.stringify(m.rungs.map((r) => r.decided))}`;
  } catch (e) { out.unfiredRungsKept = `error: ${e && e.message}`; }

  /* Outcomes are counted per rung, not pooled. */
  try {
    const m = derive([
      R("source_quality", "upheld"), R("source_quality", "upheld"),
      R("human_judgment", "escalated"),
    ]);
    out.outcomesPerRung = m.rungs[0].outcomes.upheld === 2 && m.rungs[3].outcomes.escalated === 1
      ? "ok" : `error: ${JSON.stringify(m.rungs.map((r) => r.outcomes))}`;
  } catch (e) { out.outcomesPerRung = `error: ${e && e.message}`; }

  /* Nothing is ever settled by counting seats — the ladder has no notion of a
   * majority, so equal counts on two rungs must not resolve to one of them. */
  try {
    const m = derive([R("source_quality", "upheld"), R("definition_consistency", "overturned")]);
    out.noVoting = m.rungs[0].decided === 1 && m.rungs[2].decided === 1
      ? "ok" : "error: counts collapsed";
  } catch (e) { out.noVoting = `error: ${e && e.message}`; }

  return out;
}

/* ---------- CSS ---------- */

function injectCSS() {
  if (document.getElementById("cl-css")) return;
  const s = document.createElement("style");
  s.id = "cl-css";
  s.textContent = `
.cl-stage {
  position:relative; display:grid;
  grid-template-columns:minmax(0,210px) minmax(0,1fr) minmax(0,150px);
  gap:26px; align-items:start; padding:6px 0 2px;
}
@media (max-width:900px) {
  .cl-stage { grid-template-columns:1fr; gap:12px; }
  .cl-stage .cv-wires { display:none; }
}
.cl-col { position:relative; z-index:1; display:grid; gap:10px; align-content:start; }
/* Wide enough for a fall-through connector, and for the label that sits in the
   gap where the cascade stops, to have somewhere to be. */
.cl-col-rungs { gap:30px; }

.cl-entry {
  border:2px solid var(--pi-ink); box-shadow:var(--pi-shadow-s); background:#fff;
  padding:9px 11px 11px; position:relative;
}
.cl-entry::before { content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--t); }
.cl-cap {
  font-family:var(--pi-font-title); font-size:8px; letter-spacing:.06em; color:var(--pi-muted);
}
.cl-big {
  font-family:var(--pi-font-body); font-weight:700; font-size:38px; line-height:1.05;
  color:var(--t); margin:4px 0 2px;
}
.cl-note { margin:2px 0 0; font-size:12px; line-height:1.45; color:var(--pi-muted); }
.cl-sub {
  margin-top:7px; padding-top:6px; border-top:1px solid var(--pi-line);
  font-size:11px; line-height:1.4; color:var(--pi-muted);
}

.cl-rung {
  border:2px solid var(--pi-ink); background:#fff; padding:8px 10px 9px;
  box-shadow:var(--pi-shadow-s); position:relative;
}
.cl-rung[data-fired="no"] { opacity:.5; box-shadow:none; border-color:var(--pi-line); }
.cl-rung[data-fired="yes"]::before {
  content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--t);
}
.cl-rung-head { display:flex; align-items:center; gap:9px; }
.cl-num {
  font-family:var(--pi-font-title); font-size:11px; color:var(--t);
  border:1.5px solid currentColor; width:22px; height:22px; flex:none;
  display:grid; place-items:center;
}
.cl-rung[data-fired="no"] .cl-num { color:var(--pi-muted); }
.cl-rung-nm { min-width:0; }
.cl-rung-t { font-family:var(--pi-font-body); font-weight:600; font-size:14px; line-height:1.25; }
.cl-rung-g { font-size:12px; color:var(--pi-muted); line-height:1.35; }
.cl-chip {
  margin-left:auto; flex:none; font-family:var(--pi-font-body); font-size:12px;
  border:1px solid var(--t); color:var(--t); padding:1px 6px;
}
.cl-rung[data-fired="no"] .cl-chip { border-color:var(--pi-line); color:var(--pi-muted); }

.cl-stop {
  position:absolute; z-index:2; transform:translateY(-50%);
  font-family:var(--pi-font-code); font-size:11px; color:var(--pi-muted);
  background:#fff; padding:1px 7px; border:1px dashed var(--pi-line);
}
@media (max-width:900px) { .cl-stop { display:none; } }

.cl-exit-slot { display:grid; gap:6px; align-content:start; min-height:52px; }
.cl-exit {
  display:flex; align-items:center; gap:6px; color:var(--t);
  border:2px solid var(--t); background:#fff; padding:4px 8px;
}
.cl-exit-n { font-family:var(--pi-font-body); font-weight:700; font-size:16px; }
.cl-exit-w { font-family:var(--pi-font-body); font-size:12px; }
`;
  document.head.appendChild(s);
}

export default Ladder;
