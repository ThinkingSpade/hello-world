/* lens.js — the decision lens.
 *
 * Six stages of work exist to answer one question: will a person sign this?
 * This draws that convergence literally. Every signal the run actually
 * produced — a reconciliation, a blocker still standing, an escalation the
 * ladder refused to settle, a dissent nobody withdrew — is a card on the left,
 * joined by a connector to a single lens on the right that holds the verdict.
 *
 * The verdict is derived, never authored and never voted. It is a pure
 * function of the gate statuses, the reconciliation results, the resolution
 * outcomes and the claim ledger. Change one of those and it changes; nothing
 * else can move it. In particular no model writes it, because the whole
 * premise of this application is that the thing which decides must not be the
 * thing which argues.
 *
 * Colour is state here, as everywhere else. The halo takes the tone of the
 * verdict, a connector is solid when its signal actually moves the verdict and
 * dotted when it is only context, and every card carries a shape, a colour and
 * a word — so the encoding survives greyscale, colour blindness, and the
 * reader who has turned motion off.
 *
 * The connector language itself — solid versus dotted, the tone vocabulary, the
 * glyph shapes — lives in converge.js, because the resolution ladder and the
 * reconciliation view draw the same picture and should not each invent a line.
 *
 * See CONTRACT.md §9d.
 */
import { Converge } from "./converge.js";

/* The lens rings occupy this fraction of the core box; connectors terminate on
 * the outermost ring, so the two have to agree. */
const RING = 0.46;

/* Below this the grid collapses to one column and the connectors would be
 * drawing across a layout that no longer converges on anything. */
const WIRE_MIN_W = 900;

/* Effect vocabulary. Shape, colour and word for each — a card has to stay
 * readable with colour removed and animation off, so no state is ever carried
 * by one channel alone. `solid` decides whether the connector reads as a line
 * that moves the verdict or a dotted one that only adds context. */
const EFFECT = {
  blocks:  { word: "Blocks the signature", tone: "err",  solid: true,  icon: "octagon" },
  human:   { word: "Needs a human",        tone: "warn", solid: true,  icon: "diamond" },
  raises:  { word: "Raises risk",          tone: "warn", solid: true,  icon: "up" },
  clears:  { word: "Clears",               tone: "ok",   solid: true,  icon: "check" },
  context: { word: "Adds context",         tone: "",     solid: false, icon: "bars" },
};

/* Reading order: what stops the signature first, what needs a person next,
 * then risk, then what is already settled, then background. */
const EFFECT_ORDER = ["blocks", "human", "raises", "clears", "context"];

const VERDICT = {
  blocked:   { label: "BLOCKED",   tone: "err",    lamp: "err",
               gloss: "Something downstream of this is a hard stop. Clear it, or record why it stands." },
  escalated: { label: "ESCALATED", tone: "warn",   lamp: "warn",
               gloss: "The ladder ran out of rungs. What is left is a judgement, and it is yours." },
  signed:    { label: "SIGNED",    tone: "ok",     lamp: "on",
               gloss: "Gate 4 is approved. The bundle re-executes against the source files and holds." },
  open:      { label: "OPEN",      tone: "accent", lamp: "",
               gloss: "The run is still moving. Nothing blocks it and nothing has been signed." },
  idle:      { label: "NO RUN",    tone: "idle",   lamp: "",
               gloss: "Load a case. The lens fills in as the run produces something to weigh." },
};

let host = null, stageEl = null, wiresEl = null, signalsEl = null;
let coreEl = null, legendEl = null, headEl = null;
let cards = [], jump = null, ro = null, raf = 0;

/* ---------- derivation ---------- */

const arr = (v) => (Array.isArray(v) ? v : []);

/* A finding still counts against the run unless the ladder overturned it.
 * `unresolved` and `escalated` both leave it standing — that is the point of
 * preserving them rather than clearing them.
 *
 * The research seat is excluded outright, whatever severity it claimed for
 * itself. External context is quarantined until Gate 3 and can never overturn
 * source-grounded work; letting it reach the verdict here would hand it exactly
 * the authority the rest of the application spends its time denying it. It is
 * still shown — as a quarantine signal that adds context and weighs nothing. */
function standingFindings(S) {
  const byId = new Map(arr(S.resolutions).map((r) => [r.findingId, r]));
  return arr(S.findings).filter((f) => {
    if (f.agentId === "research") return false;
    const r = byId.get(f.findingId);
    return !r || r.outcome !== "overturned";
  });
}

/* Every signal is read off live state. Nothing here is illustrative, and a
 * lane with nothing to say is omitted rather than padded with a zero. */
function signals(S) {
  const out = [];
  const results = arr(S.results);
  const claims = arr(S.claims);
  const resolutions = arr(S.resolutions);
  const standing = standingFindings(S);
  const gates = S.gates || {};
  const gateList = Object.values(gates);

  const push = (s) => out.push(s);

  if (results.length) {
    const bad = results.filter((r) => !r.reconciled);
    push(bad.length ? {
      id: "recon", stage: "calc", lane: "two-engine reconciliation",
      head: `${bad.length} of ${results.length} figures disagree across engines`,
      detail: "SQL and the independent reducer differ beyond tolerance. A figure that does not reconcile cannot become a calculated claim.",
      effect: "blocks",
    } : {
      id: "recon", stage: "calc", lane: "two-engine reconciliation",
      head: `${results.length} ${results.length === 1 ? "figure" : "figures"} reconciled across both engines`,
      detail: "SQL over SQLite-WASM and the JavaScript reducer agree within tolerance, computed from code that shares nothing.",
      effect: "clears",
    });
  }

  const blockers = standing.filter((f) => f.severity === "blocker");
  if (blockers.length) push({
    id: "blockers", stage: "council", lane: "council · blockers",
    head: `${blockers.length} blocker ${blockers.length === 1 ? "finding" : "findings"} still standing`,
    detail: blockers[0].title,
    effect: "blocks",
  });

  const escalated = resolutions.filter((r) => r.outcome === "escalated");
  if (escalated.length) push({
    id: "escalated", stage: "council", lane: "ladder · rung 4",
    head: `${escalated.length} ${escalated.length === 1 ? "disagreement" : "disagreements"} escalated to human judgment`,
    detail: "Source quality, formula reproducibility and definition consistency all declined to settle it. It is not auto-resolved and it is not counted.",
    effect: "human",
  });

  const majors = standing.filter((f) => f.severity === "major");
  if (majors.length) push({
    id: "majors", stage: "council", lane: "council · major",
    head: `${majors.length} major ${majors.length === 1 ? "finding" : "findings"} unaddressed`,
    detail: majors[0].title,
    effect: "raises",
  });

  const dissent = resolutions.reduce((n, r) => n + arr(r.dissent).length, 0);
  if (dissent) push({
    id: "dissent", stage: "council", lane: "preserved dissent",
    head: `${dissent} ${dissent === 1 ? "dissent" : "dissents"} recorded and preserved`,
    detail: "A seat that lost the point kept its position on the record. Dissent travels in the bundle rather than being resolved away.",
    effect: "raises",
  });

  const disputed = claims.filter((c) => c.status === "disputed");
  if (disputed.length) push({
    id: "disputed", stage: "council", lane: "claim ledger",
    head: `${disputed.length} disputed ${disputed.length === 1 ? "claim" : "claims"} in the ledger`,
    detail: "A disputed claim cannot be promoted. Either the dispute is answered or the claim leaves the output.",
    effect: "blocks",
  });

  const quarantined = claims.filter(
    (c) => c.type === "external_context" && !(c.external && c.external.approved),
  ).length + arr(S.findings).filter((f) => f.agentId === "research").length;
  if (quarantined) push({
    id: "quarantine", stage: "research", lane: "external · quarantined",
    head: `${quarantined} external ${quarantined === 1 ? "item" : "items"} held behind Gate 3`,
    detail: "Retrieved context, not evidence. It cannot overturn anything grounded in the source files, it carries no weight in the verdict, and it cannot enter an output until a person clears it.",
    effect: "context",
  });

  const promotable = claims.filter((c) => c.type === "observed" || c.type === "calculated");
  if (promotable.length) push({
    id: "ledger", stage: "council", lane: "claim ledger",
    head: `${promotable.length} typed ${promotable.length === 1 ? "claim" : "claims"} carrying full provenance`,
    detail: "Each one names its file, sha256, locator, transformation, period and unit, so any figure can be walked back to the cell it came from.",
    effect: "context",
  });

  if (gateList.length) {
    const ok = gateList.filter((g) => g.status === "approved");
    const changes = gateList.filter((g) => g.status === "changes_requested");
    push(changes.length ? {
      id: "gates", stage: "report", lane: "human gates",
      head: `${changes.length} gate ${changes.length === 1 ? "has" : "have"} changes requested`,
      detail: "Nothing downstream of a gate in this state executes.",
      effect: "blocks",
    } : {
      id: "gates", stage: "report", lane: "human gates",
      head: `${ok.length} of ${gateList.length} gates approved`,
      detail: ok.length === gateList.length
        ? "Every hard stop has a name and a timestamp against this run id."
        : "Each gate is a hard stop. Nothing downstream of a pending one runs.",
      effect: ok.length === gateList.length ? "clears" : "context",
    });
  }

  out.sort((a, b) => EFFECT_ORDER.indexOf(a.effect) - EFFECT_ORDER.indexOf(b.effect));
  return out;
}

/* The verdict. Ordered by severity of consequence, stopping at the first that
 * applies — the same shape as the resolution ladder, and for the same reason:
 * a rule you can read beats a score you cannot. */
function verdictOf(S) {
  const results = arr(S.results);
  const claims = arr(S.claims);
  const resolutions = arr(S.resolutions);
  const standing = standingFindings(S);
  const gateList = Object.values(S.gates || {});

  const approved = gateList.filter((g) => g.status === "approved");
  const changes = gateList.filter((g) => g.status === "changes_requested");
  const unreconciled = results.filter((r) => !r.reconciled);
  const escalated = resolutions.filter((r) => r.outcome === "escalated");
  const blockers = standing.filter((f) => f.severity === "blocker");
  const disputed = claims.filter((c) => c.status === "disputed");
  const final = (S.gates || {}).final_recommendation;

  const reasons = [];
  if (changes.length) reasons.push(`${changes.length} gate returned for changes`);
  if (unreconciled.length) reasons.push(`${unreconciled.length} figure${unreconciled.length === 1 ? "" : "s"} unreconciled`);
  if (blockers.length) reasons.push(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"} standing`);
  if (disputed.length) reasons.push(`${disputed.length} claim${disputed.length === 1 ? "" : "s"} disputed`);

  if (escalated.length) reasons.push(`${escalated.length} escalation${escalated.length === 1 ? "" : "s"} awaiting judgment`);

  /* A signature outranks everything below it, and deliberately. Gate 4 records
   * that a named person signed against this run id with whatever was still
   * standing at the time — so once it is approved the lens reports the
   * signature, and what stood is carried in the line rather than used to
   * overrule it. The tone still turns if anything survived: signed over two
   * blockers is not the same event as signed clean, and must not look like it. */
  let code;
  if (final && final.status === "approved") code = "signed";
  else if (!results.length && !arr(S.findings).length && !approved.length) code = "idle";
  else if (changes.length || unreconciled.length || blockers.length || disputed.length) code = "blocked";
  else if (escalated.length) code = "escalated";
  else code = "open";

  const line = code === "idle"
    ? "nothing loaded"
    : `${approved.length} of ${gateList.length} gates approved` +
      (reasons.length ? ` · ${reasons.join(" · ")}` : "");

  const v = { code, ...VERDICT[code], line, reasons };
  if (code === "signed" && reasons.length) {
    v.tone = "warn";
    v.lamp = "warn";
    v.gloss = "Gate 4 is approved and what follows was signed over, not settled. "
      + "It travels in the bundle under the name that signed it.";
  }
  return v;
}

/* ---------- DOM ---------- */

const svgEl = Converge.svgEl;
const iconEl = (kind) => Converge.icon(kind);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function cardEl(sig, i) {
  const eff = EFFECT[sig.effect] || EFFECT.context;
  const node = el(jump ? "button" : "div", "c-lens-card");
  if (jump) node.type = "button";
  node.dataset.tone = eff.tone;
  /* A gentle, fixed indent pattern so the stack reads as a scatter converging
   * rather than a list. Fixed, not random — this view has to redraw the same
   * way every time it is opened. */
  node.style.setProperty("--i", String([0, 22, 6, 30, 12, 26, 4, 18][i % 8]));

  const top = el("div", "c-lens-card-top");
  top.appendChild(el("span", "c-lens-lane", sig.lane));
  node.appendChild(top);

  const headRow = el("div", "c-lens-card-head");
  headRow.appendChild(el("span", "c-lens-head", sig.head));
  node.appendChild(headRow);

  const tag = el("span", "c-lens-tag");
  tag.appendChild(iconEl(eff.icon));
  tag.appendChild(el("span", null, eff.word));
  node.appendChild(tag);

  node.appendChild(el("p", "c-lens-detail", sig.detail));

  if (jump) {
    node.appendChild(el("span", "c-lens-go", "→"));
    node.addEventListener("click", () => jump(sig.stage));
    node.setAttribute("aria-label", `${sig.lane}: ${sig.head}. ${eff.word}. Go to this stage.`);
  }
  return node;
}

function buildCore(v) {
  coreEl.innerHTML = "";
  coreEl.dataset.tone = v.tone;

  const svg = svgEl("svg", { viewBox: "0 0 420 420", class: "c-lens-rings", "aria-hidden": "true" });
  const defs = svgEl("defs");
  const grad = svgEl("radialGradient", { id: "c-lens-halo" });
  /* Weighted to the rim. A gradient that tints the whole disc reads as a
   * coloured slab behind the verdict; keeping the centre near-white leaves the
   * word on white paper and lets the colour live in the halo. */
  grad.appendChild(svgEl("stop", { offset: "0%",   "stop-color": "currentColor", "stop-opacity": "0" }));
  grad.appendChild(svgEl("stop", { offset: "62%",  "stop-color": "currentColor", "stop-opacity": ".02" }));
  grad.appendChild(svgEl("stop", { offset: "86%",  "stop-color": "currentColor", "stop-opacity": ".11" }));
  grad.appendChild(svgEl("stop", { offset: "97%",  "stop-color": "currentColor", "stop-opacity": ".05" }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": "0" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  svg.appendChild(svgEl("circle", { cx: 210, cy: 210, r: 196, fill: "url(#c-lens-halo)" }));

  /* Concentric rings, faint and dashed: a scale for the eye to read the
   * convergence against, not decoration. The outermost is where the
   * connectors land. */
  [196, 168, 138, 106, 72].forEach((r, i) => {
    svg.appendChild(svgEl("circle", {
      cx: 210, cy: 210, r,
      fill: "none", stroke: "currentColor",
      "stroke-opacity": (0.26 - i * 0.04).toFixed(2),
      "stroke-width": i === 0 ? 1.5 : 1,
      "stroke-dasharray": i === 0 ? "none" : "2 6",
    }));
  });
  coreEl.appendChild(svg);

  const read = el("div", "c-lens-read");
  read.appendChild(el("div", "c-lens-eyebrow", "DECISION LENS"));
  read.appendChild(el("div", "c-lens-verdict", v.label));
  read.appendChild(el("div", "c-lens-line", v.line));
  read.appendChild(el("p", "c-lens-gloss", v.gloss));
  coreEl.appendChild(read);
}

function buildLegend(sigs) {
  legendEl.innerHTML = "";
  legendEl.appendChild(el("div", "c-lens-legend-t", "How to read"));
  for (const key of EFFECT_ORDER) {
    const n = sigs.filter((s) => s.effect === key).length;
    if (!n) continue;
    const eff = EFFECT[key];
    const row = el("div", "c-lens-legend-r");
    row.dataset.tone = eff.tone;
    row.appendChild(iconEl(eff.icon));
    row.appendChild(el("span", null, `${n} ${eff.word.toLowerCase()}`));
    legendEl.appendChild(row);
  }
  const foot = el("div", "c-lens-legend-f",
    "Solid connectors move the verdict. Dotted ones are context.");
  legendEl.appendChild(foot);
}

/* ---------- connectors ---------- */

/* Measured against live layout rather than assumed, so the drawing survives a
 * resize, a font that loads late, and a card that wrapped to three lines. */
function drawWires(sigs) {
  if (!cards.length) { wiresEl.innerHTML = ""; return; }
  const box = stageEl.getBoundingClientRect();
  const pts = Converge.arc(coreEl, box, cards.length, { radiusFrac: RING, facing: "left" });

  Converge.wires(wiresEl, stageEl, cards.map((card, i) => {
    const eff = EFFECT[sigs[i].effect] || EFFECT.context;
    return {
      from: { el: card, side: "right" },
      to: pts[i],
      tone: eff.tone,
      solid: eff.solid,
    };
  }), { minWidth: WIRE_MIN_W });
}

function schedule(sigs) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => drawWires(sigs));
}

/* ---------- api ---------- */

/* ---------- self test ----------
 *
 * The verdict table is the only opinion this module holds, so it is the part
 * worth pinning down. These run headless — no DOM — because the derivation has
 * to be checkable without rendering anything.
 */
function __selfTest() {
  const out = {};
  const gates = (o = {}) => ({
    data_contract:        { id: "data_contract",        status: o.g1 || "pending" },
    calc_definitions:     { id: "calc_definitions",     status: o.g2 || "pending" },
    external_evidence:    { id: "external_evidence",    status: o.g3 || "pending" },
    final_recommendation: { id: "final_recommendation", status: o.g4 || "pending" },
  });
  const signed = { g1: "approved", g2: "approved", g3: "approved", g4: "approved" };
  const find = (severity, findingId, agentId = "math") => ({ findingId, agentId, severity, title: findingId });
  const ok = [{ reconciled: true }];

  const expect = (name, state, label) => {
    try {
      const got = verdictOf(state).label;
      out[name] = got === label ? "ok" : `error: expected ${label}, got ${got}`;
    } catch (e) { out[name] = `error: ${e && e.message ? e.message : String(e)}`; }
  };

  expect("idle", {}, "NO RUN");
  expect("open", { results: ok, findings: [find("note", "a")], gates: gates({ g1: "approved" }) }, "OPEN");
  expect("unreconciled", { results: [{ reconciled: false }], gates: gates({ g1: "approved" }) }, "BLOCKED");
  expect("blocker", { results: ok, findings: [find("blocker", "a")], gates: gates({ g1: "approved" }) }, "BLOCKED");
  expect("overturned", {
    results: ok, findings: [find("blocker", "a")],
    resolutions: [{ findingId: "a", outcome: "overturned", dissent: [] }], gates: gates({ g1: "approved" }),
  }, "OPEN");
  expect("changesRequested", { results: ok, gates: gates({ g1: "changes_requested" }) }, "BLOCKED");
  expect("disputedClaim", {
    results: ok, claims: [{ type: "observed", status: "disputed" }], gates: gates({ g1: "approved" }),
  }, "BLOCKED");
  expect("escalated", {
    results: ok, findings: [find("minor", "a")],
    resolutions: [{ findingId: "a", outcome: "escalated", dissent: [] }], gates: gates({ g1: "approved" }),
  }, "ESCALATED");
  expect("signedClean", { results: ok, gates: gates(signed) }, "SIGNED");
  expect("signedOverBlocker", { results: ok, findings: [find("blocker", "a")], gates: gates(signed) }, "SIGNED");

  /* Signed clean and signed over a standing blocker are different events and
   * must not render alike. */
  try {
    const clean = verdictOf({ results: ok, gates: gates(signed) });
    const over = verdictOf({ results: ok, findings: [find("blocker", "a")], gates: gates(signed) });
    out.signedTonesDiffer = clean.tone === "ok" && over.tone === "warn"
      ? "ok" : `error: ${clean.tone} vs ${over.tone}`;
  } catch (e) { out.signedTonesDiffer = `error: ${e && e.message ? e.message : String(e)}`; }

  /* Quarantine is the load-bearing one: external research must never reach the
   * verdict, however severe it claims to be, and must still be visible. */
  try {
    const state = {
      results: ok, findings: [find("blocker", "r", "research")], gates: gates({ g1: "approved" }),
    };
    const v = verdictOf(state);
    const shown = signals(state).some((s) => s.id === "quarantine" && s.effect === "context");
    out.researchCannotBlock = v.label === "BLOCKED" ? "error: research reached the verdict" : "ok";
    out.researchStillShown = shown ? "ok" : "error: quarantined research was hidden";
  } catch (e) { out.researchCannotBlock = `error: ${e && e.message ? e.message : String(e)}`; }

  /* Nothing is padded: an empty run has nothing to say. */
  try {
    out.emptyDerivesNothing = signals({}).length === 0 ? "ok" : "error: signals invented for an empty run";
  } catch (e) { out.emptyDerivesNothing = `error: ${e && e.message ? e.message : String(e)}`; }

  /* Same state in, same drawing out — this view sits in front of a run id. */
  try {
    const state = { results: ok, findings: [find("major", "a")], gates: gates({ g1: "approved" }) };
    const a = JSON.stringify(signals(state));
    const b = JSON.stringify(signals(state));
    out.deterministic = a === b ? "ok" : "error: non-deterministic signals";
  } catch (e) { out.deterministic = `error: ${e && e.message ? e.message : String(e)}`; }

  return out;
}

export const Lens = {
  /* onJump(stage) — optional. Given it, each card becomes a control that moves
   * the run to the stage the signal came from. */
  mount(node, { onJump = null } = {}) {
    Converge.injectCSS();
    injectCSS();
    host = node;
    jump = onJump;
    host.innerHTML = "";
    host.classList.add("cv", "c-lens");

    headEl = el("div", "c-lens-head-strip");
    host.appendChild(headEl);

    stageEl = el("div", "c-lens-stage");
    wiresEl = svgEl("svg", { class: "cv-wires", "aria-hidden": "true" });
    signalsEl = el("div", "c-lens-signals");
    coreEl = el("div", "c-lens-core");
    legendEl = el("div", "c-lens-legend");
    stageEl.appendChild(wiresEl);
    stageEl.appendChild(signalsEl);
    stageEl.appendChild(coreEl);
    stageEl.appendChild(legendEl);
    host.appendChild(stageEl);

    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => schedule(this._sigs || []));
      ro.observe(stageEl);
    }
    return this;
  },

  verdict: verdictOf,
  signals,
  __selfTest,

  render(state) {
    if (!host) return null;
    const sigs = signals(state || {});
    const v = verdictOf(state || {});
    this._sigs = sigs;

    headEl.innerHTML = "";
    const lamp = el("span", `c-lens-lamp ${v.lamp}`);
    const left = el("div", "c-lens-head-l");
    left.appendChild(lamp);
    left.appendChild(el("span", "c-lens-run", state && state.runId
      ? `RUN ${String(state.runId).slice(0, 10)}` : "NO RUN"));
    headEl.appendChild(left);
    headEl.appendChild(el("div", "c-lens-head-r",
      `${sigs.length} ${sigs.length === 1 ? "signal" : "signals"} · resolved by ladder, never by vote`));

    signalsEl.innerHTML = "";
    cards = sigs.map((s, i) => {
      const c = cardEl(s, i);
      signalsEl.appendChild(c);
      return c;
    });
    if (!sigs.length) {
      signalsEl.appendChild(el("p", "c-lens-empty",
        "No signals yet. Load a case and the lens fills in as the run produces something to weigh."));
    }

    buildCore(v);
    buildLegend(sigs);
    schedule(sigs);
    return { ...v, signals: sigs.length };
  },

  destroy() {
    if (ro) { ro.disconnect(); ro = null; }
    cancelAnimationFrame(raf);
    cards = [];
    host = stageEl = wiresEl = signalsEl = coreEl = legendEl = headEl = null;
  },
};

/* ---------- CSS ---------- */

function injectCSS() {
  if (document.getElementById("c-lens-css")) return;
  const s = document.createElement("style");
  s.id = "c-lens-css";
  s.textContent = `
.c-lens-head-strip {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding-bottom:10px; margin-bottom:4px; border-bottom:1px solid var(--pi-line);
}
.c-lens-head-l { display:flex; align-items:center; gap:7px; }
.c-lens-lamp {
  width:8px; height:8px; background:var(--pi-muted); display:inline-block;
  box-shadow:0 0 0 3px rgba(0,0,0,.04);
}
.c-lens-lamp.on   { background:var(--pi-ok); }
.c-lens-lamp.warn { background:var(--pi-warn); }
.c-lens-lamp.err  { background:var(--pi-err); }
.c-lens-run { font-family:var(--pi-font-title); font-size:9px; letter-spacing:.08em; }
.c-lens-head-r {
  margin-left:auto; font-family:var(--pi-font-code); font-size:12px; color:var(--pi-muted);
}

.c-lens-stage {
  position:relative;
  display:grid; grid-template-columns:minmax(0, 460px) minmax(0, 1fr);
  gap:24px; align-items:center; padding:26px 0 8px; min-height:520px;
}
@media (max-width:900px) {
  .c-lens-stage { grid-template-columns:1fr; min-height:0; padding-top:16px; }
  .c-lens-stage .cv-wires { display:none; }
}

.c-lens-signals { position:relative; z-index:1; display:grid; gap:14px; }

.c-lens-card {
  position:relative; text-align:left; width:100%;
  background:#fff; border:2px solid var(--pi-ink); box-shadow:var(--pi-shadow-s);
  padding:9px 30px 10px 11px; font:inherit; color:inherit; cursor:default;
  margin-left:calc(var(--i, 0) * 1px);
  transition:transform .18s var(--c-ease), box-shadow .18s, border-color .18s;
}
button.c-lens-card { cursor:pointer; }
button.c-lens-card:hover, button.c-lens-card:focus-visible {
  transform:translate(-2px, -2px); box-shadow:5px 5px 0 var(--pi-ink); border-color:var(--t);
  outline:none;
}
.c-lens-card::before {
  content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--t);
}
.c-lens-card[data-tone=""]::before { background:var(--pi-line); }

.c-lens-card-top { display:flex; align-items:center; gap:8px; }
.c-lens-lane {
  font-family:var(--pi-font-title); font-size:8px; letter-spacing:.06em;
  text-transform:uppercase; color:var(--pi-muted);
}
.c-lens-card-head { margin-top:5px; }
/* Prose, so the body face — --pi-font-ui is for chips and metric labels, and a
   pixel face set at sentence length is a chore to read. */
.c-lens-head { font-family:var(--pi-font-body); font-size:14.5px; font-weight:600; line-height:1.3; }

.c-lens-tag {
  display:inline-flex; align-items:center; gap:5px; margin-top:7px;
  font-family:var(--pi-font-ui); font-size:12px; color:var(--t);
  border:1px solid var(--t); padding:1px 6px;
}
.c-lens-card[data-tone=""] .c-lens-tag { color:var(--pi-muted); border-color:var(--pi-line); }

.c-lens-detail {
  margin:7px 0 0; font-size:12.5px; line-height:1.45; color:var(--pi-muted);
}
.c-lens-go {
  position:absolute; right:9px; top:50%; transform:translateY(-50%);
  font-family:var(--pi-font-code); font-size:15px; color:var(--pi-muted);
}
button.c-lens-card:hover .c-lens-go { color:var(--t); }
.c-lens-empty { margin:0; color:var(--pi-muted); font-size:14px; }

.c-lens-core {
  position:relative; z-index:1; color:var(--t);
  aspect-ratio:1; width:100%; max-width:520px; justify-self:center;
  display:grid; place-items:center;
}
@media (max-width:900px) { .c-lens-core { max-width:380px; margin-top:8px; } }
.c-lens-rings { position:absolute; inset:0; width:100%; height:100%; }

.c-lens-read { position:relative; text-align:center; max-width:74%; }
.c-lens-eyebrow {
  font-family:var(--pi-font-title); font-size:8px; letter-spacing:.16em; color:var(--pi-muted);
}
.c-lens-verdict {
  font-family:var(--pi-font-ui); font-weight:700; font-size:clamp(34px, 5.2vw, 58px);
  line-height:1.02; letter-spacing:-.01em; color:var(--t); margin:10px 0 8px;
}
.c-lens-line {
  font-family:var(--pi-font-code); font-size:12px; color:var(--pi-ink);
  border-top:1px solid var(--pi-line); padding-top:8px;
}
.c-lens-gloss { margin:8px 0 0; font-size:12.5px; line-height:1.45; color:var(--pi-muted); }

.c-lens-legend {
  position:absolute; right:0; bottom:0; z-index:2;
  background:#fff; border:2px solid var(--pi-ink); box-shadow:var(--pi-shadow-s);
  padding:8px 11px 9px; min-width:190px;
}
@media (max-width:900px) { .c-lens-legend { position:static; margin-top:16px; } }
.c-lens-legend-t {
  font-family:var(--pi-font-title); font-size:8px; letter-spacing:.06em;
  text-transform:uppercase; margin-bottom:6px;
}
.c-lens-legend-r {
  display:flex; align-items:center; gap:7px; color:var(--t);
  font-family:var(--pi-font-body); font-size:12.5px; padding:2px 0;
}
.c-lens-legend-r[data-tone=""] { color:var(--pi-muted); }
.c-lens-legend-f {
  margin-top:7px; padding-top:6px; border-top:1px solid var(--pi-line);
  font-size:11px; line-height:1.4; color:var(--pi-muted);
}

@media (prefers-reduced-motion: reduce) {
  .c-lens-card, button.c-lens-card:hover, button.c-lens-card:focus-visible { transition:none; transform:none; }
}
`;
  document.head.appendChild(s);
}

export default Lens;
