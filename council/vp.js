/* vp.js — the visitor's desk.
 *
 * The page's thesis is "models argue, engines compute, a person signs" — so the
 * run stops at every gate and a bundle lands here, on the desk, until the
 * visitor signs it. Nothing in this module states a case fact: every summary
 * line is read off live state at render time, so the desk works identically
 * when a visitor drops their own workbook.
 *
 * app.js imports this module and hands it { approveGate, getState, stage } at
 * boot. This module imports nothing from app.js — the only signal back is the
 * document-level "council:gate" CustomEvent that app.js dispatches from
 * setGate(), which is also how an approval made from a stage's own button
 * resolves the same stop.
 */
import { U } from "./util.js";
import { Claims } from "./claims.js";
import { ROSTER } from "./council.js";

const GATE_META = {
  data_contract:        { n: 1, name: "data contract",           stage: "contract" },
  calc_definitions:     { n: 2, name: "calculation definitions", stage: "calc" },
  final_recommendation: { n: 4, name: "final recommendation",    stage: "report" },
};

let deps = null;      // { approveGate, getState, stage }
let pending = null;   // { id, resolve } while a stop is parked at a gate

/* ---------- small helpers ---------- */

const $id = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function safeState() {
  try { return (deps && typeof deps.getState === "function" && deps.getState()) || {}; }
  catch { return {}; }
}

function fmtValue(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "ratio" || unit === "pct") return U.fmt.pct(v, 2);
  return U.fmt.compact(v);
}

function seatName(agentId) {
  const s = (ROSTER || []).find((r) => r && r.id === agentId);
  return s ? s.seat : agentId;
}

function fine(text) {
  const p = el("p", "fine", text);
  p.style.cssText = "font-size:12px;color:var(--pi-muted);margin:8px 0 0";
  return p;
}

/* ---------- desk chrome ---------- */

function deskIdle() {
  const lamp = $id("vp-desk-lamp");
  if (lamp) lamp.className = "pwin-lamp";
  const count = $id("vp-desk-count");
  if (count) count.textContent = "nothing waiting";
  const body = $id("vp-desk-body");
  if (body) {
    body.innerHTML = "";
    body.appendChild(el("p", "c-empty",
      "Nothing is awaiting your signature. Take the case and the first bundle will be walked over."));
  }
}

function deskWaiting(meta) {
  const lamp = $id("vp-desk-lamp");
  if (lamp) lamp.className = "pwin-lamp warn";
  const count = $id("vp-desk-count");
  if (count) count.textContent = `gate ${meta.n} · waiting on you`;
}

function scrollDeskIntoView() {
  const desk = $id("vp-desk");
  if (!desk || typeof desk.scrollIntoView !== "function") return;
  let reduced = false;
  try { reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { reduced = false; }
  desk.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
}

/* ---------- contested highlight on the stage's approve row ---------- */

function approveRow(id) {
  const btn = document.querySelector(`[data-approve="${id}"]`);
  return btn ? btn.parentElement : null;
}

function markContested(id) {
  const row = approveRow(id);
  if (row) row.classList.add("c-contested");
}

function clearContested(id) {
  if (!id) return;
  const row = approveRow(id);
  if (row) row.classList.remove("c-contested");
}

function clearAllContested() {
  for (const id of Object.keys(GATE_META)) clearContested(id);
}

/* ---------- summary lines, from live state only ---------- */

function contractLines(st) {
  const lines = [];
  const c = st.factContract;
  if (c && Array.isArray(c.grain) && c.grain.length) {
    lines.push(`One row means one ${c.grain.join(" × ")} combination — the grain everything downstream inherits.`);
  }
  if (c && c.rowCount != null && c.collapsedRowCount != null) {
    const repeats = c.grainIsUnique === false
      ? " — keys repeat in the source, so rows are folded, not assumed unique"
      : "";
    lines.push(`${c.rowCount} source rows collapse to ${c.collapsedRowCount} distinct keys${repeats}.`);
  }
  if (c && Array.isArray(c.splitRowGroups) && c.splitRowGroups.length) {
    const n = c.splitRowGroups.length;
    const dup = Array.isArray(c.duplicateKeys) ? c.duplicateKeys.length : 0;
    lines.push(
      `${plural(n, "key")} arrive${n === 1 ? "s" : ""} in segments — one fact split across rows, not duplicates` +
      (dup ? `; ${plural(dup, "other key")} repeat${dup === 1 ? "s" : ""} identically (true duplicates)` : "") + ".");
  }
  if (c && Array.isArray(c.incompletePeriods) && c.incompletePeriods.length) {
    const n = c.incompletePeriods.length;
    const first = c.incompletePeriods[0];
    lines.push(
      `${plural(n, "period")} look${n === 1 ? "s" : ""} structurally incomplete` +
      (first && first.period ? ` (${first.period})` : "") +
      ` and ${n === 1 ? "is" : "are"} excluded from every trailing comparison.`);
  }
  const flagged = (Array.isArray(st.spans) ? st.spans : []).filter((s) => s && s.injection).length;
  if (flagged) {
    lines.push(`${plural(flagged, "span")} in the files read like instructions to a model — quarantined by the sentinel, never obeyed.`);
  }
  return lines;
}

function calcLines(st) {
  const lines = [];
  const specs = Array.isArray(st.specs) ? st.specs : [];
  const c = st.factContract;
  if (specs.length) {
    lines.push(`${plural(specs.length, "calculation definition")} were derived from the approved contract — none were hand-written for this case.`);
  }
  const cols = [];
  for (const s of specs) {
    const col = s && s.params && s.params.col;
    if (col && !cols.includes(col)) cols.push(col);
  }
  for (const col of cols.slice(0, 3)) {
    const n = specs.filter((s) => s && s.params && s.params.col === col).length;
    const rule = c && Array.isArray(c.collapseRules) && c.collapseRules.find((r) => r && r.col === col);
    const meas = c && Array.isArray(c.measures) && c.measures.find((m) => m && m.col === col);
    lines.push(
      `"${col}"${meas && meas.role ? ` (${meas.role})` : ""} — ${plural(n, "definition")}` +
      (rule && rule.rule ? `, folded with ${String(rule.rule).toUpperCase()} across split keys` : "") + ".");
  }
  lines.push("Every figure is computed twice — once in SQL, once by an independent reducer — and must reconcile before it can be cited.");
  return lines;
}

function headlineResults(st, max) {
  const out = [];
  const specs = Array.isArray(st.specs) ? st.specs : [];
  const results = Array.isArray(st.results) ? st.results : [];
  for (const spec of specs) {
    if (!spec) continue;
    const r = results.find((x) => x && x.specId === spec.specId);
    if (!r || r.undefinedResult || r.error) continue;
    if (r.sqlValue === null || r.sqlValue === undefined) continue;
    out.push({ spec, r });
    if (out.length >= max) break;
  }
  return out;
}

function dissentSeatIds(st) {
  const ids = new Set();
  for (const r of Array.isArray(st.resolutions) ? st.resolutions : []) {
    if (!r || r.outcome !== "escalated") continue;
    for (const d of r.dissent || []) if (d && d.agentId) ids.add(d.agentId);
  }
  let ledger = [];
  try { ledger = Claims.ledger(); } catch { ledger = []; }
  for (const cl of ledger) {
    if (!cl || !Array.isArray(cl.dissent)) continue;
    for (const d of cl.dissent) if (d && d.agentId) ids.add(d.agentId);
  }
  return [...ids];
}

function finalLines(st) {
  const lines = [];
  for (const { spec, r } of headlineResults(st, 2)) {
    lines.push(
      `${spec.name}: ${fmtValue(r.sqlValue, spec.unit)} — ` +
      (r.reconciled ? "reconciled across both engines." : "the engines DISAGREE on this figure."));
  }
  const results = Array.isArray(st.results) ? st.results : [];
  if (results.length) {
    const rec = results.filter((r) => r && r.reconciled).length;
    const undef = results.filter((r) => r && r.undefinedResult).length;
    lines.push(
      `${rec} of ${plural(results.length, "figure")} reconciled across both engines` +
      (undef ? `; ${undef} are undefined — no comparison base exists, so no number is invented` : "") + ".");
  }
  const seats = dissentSeatIds(st);
  lines.push(seats.length
    ? `Dissent is on record from ${plural(seats.length, "seat")}: ${seats.map(seatName).join(", ")}.`
    : "No seat is on record against this — which is not the same as corroboration.");
  lines.push("Signing preserves every dissent in the export, over your signature.");
  return lines;
}

const FALLBACK_LINES = {
  data_contract: [
    "The contract fixes the grain, the fold rule for every measure, and the periods to exclude — before anything computes.",
    "Every choice here is visible and editable in the Contract stage behind the rail.",
    "Nothing downstream runs until you approve what a row means.",
  ],
  calc_definitions: [
    "Each definition states its window, its SQL, and its independent reducer before it may produce a figure.",
    "The full list is one click away in the Calc stage behind the rail.",
    "Nothing executes until you approve what each measure means.",
  ],
  final_recommendation: [
    "The decision record carries every claim with its type, its provenance, and any dissent still standing.",
    "The full record is one click away in the Decide stage behind the rail.",
    "Signing records who approved it, against which run id.",
  ],
};

function summaryLines(id, st) {
  let lines = [];
  if (id === "data_contract") lines = contractLines(st);
  else if (id === "calc_definitions") lines = calcLines(st);
  else if (id === "final_recommendation") lines = finalLines(st);
  const fallback = FALLBACK_LINES[id] || [];
  for (const f of fallback) {
    if (lines.length >= 3) break;
    lines.push(f);
  }
  return lines.slice(0, 5);
}

/* ---------- chips ---------- */

function chipSpecs(id, st) {
  const chips = [];
  const c = st.factContract;
  if (id === "data_contract") {
    if (c && c.grainIsUnique === true) chips.push({ tone: "ok", text: "grain unique" });
    if (c && c.grainIsUnique === false) chips.push({ tone: "warn", text: "grain repeats" });
    if (c && Array.isArray(c.splitRowGroups) && c.splitRowGroups.length) {
      chips.push({ tone: "warn", text: `${plural(c.splitRowGroups.length, "split key")}` });
    }
    if (c && Array.isArray(c.incompletePeriods) && c.incompletePeriods.length) {
      chips.push({ tone: "warn", text: `${plural(c.incompletePeriods.length, "incomplete period")}` });
    }
    const flagged = (Array.isArray(st.spans) ? st.spans : []).filter((s) => s && s.injection).length;
    if (flagged) chips.push({ tone: "err", text: `${plural(flagged, "flagged span")}` });
  } else if (id === "calc_definitions") {
    const specs = Array.isArray(st.specs) ? st.specs : [];
    if (specs.length) chips.push({ tone: "acc", text: `${plural(specs.length, "spec")}` });
    chips.push({ tone: "ok", text: "sql + reducer" });
  } else if (id === "final_recommendation") {
    const results = Array.isArray(st.results) ? st.results : [];
    const bad = results.filter((r) => r && !r.reconciled && !r.undefinedResult && !r.error).length;
    const seats = dissentSeatIds(st);
    if (seats.length) chips.push({ tone: "warn", text: `${plural(seats.length, "dissent")}` });
    if (bad) chips.push({ tone: "err", text: `${bad} unreconciled` });
    if (results.length && !bad) chips.push({ tone: "ok", text: "all figures reconciled" });
    const esc = (Array.isArray(st.resolutions) ? st.resolutions : []).filter((r) => r && r.outcome === "escalated").length;
    if (esc) chips.push({ tone: "warn", text: `${esc} escalated to you` });
  }
  return chips.slice(0, 4);
}

/* ---------- the bundle ---------- */

function renderBundle(id) {
  const body = $id("vp-desk-body");
  const meta = GATE_META[id] || { n: "?", name: String(id).replace(/_/g, " "), stage: null };
  deskWaiting(meta);
  if (!body) return;
  const st = safeState();

  body.innerHTML = "";
  const bundle = el("div", "c-bundle");
  bundle.appendChild(el("h3", null, `GATE ${meta.n} · ${meta.name}`));

  const ul = el("ul");
  for (const line of summaryLines(id, st)) ul.appendChild(el("li", null, line));
  bundle.appendChild(ul);

  const chips = chipSpecs(id, st);
  if (chips.length) {
    const row = el("div", "chips");
    for (const ch of chips) row.appendChild(el("span", `pchip ${ch.tone || ""}`.trim(), ch.text));
    bundle.appendChild(row);
  }

  const actions = el("div", "actions");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
  const sign = el("button", "pbtn primary", "Sign");
  sign.type = "button";
  sign.addEventListener("click", async () => {
    sign.disabled = true;
    try {
      if (deps && typeof deps.approveGate === "function") await deps.approveGate(id);
    } catch (e) {
      console.error(e);
    } finally {
      /* The promise resolves only via the "council:gate" event. If the gate did
       * not actually clear (a precondition failed), give the button back. */
      const g = safeState().gates;
      if (!g || !g[id] || g[id].status !== "approved") sign.disabled = false;
    }
  });
  actions.appendChild(sign);
  const back = el("button", "pbtn", "Send back");
  back.type = "button";
  back.addEventListener("click", () => sendBack(id));
  actions.appendChild(back);
  bundle.appendChild(actions);

  const gate = st.gates && st.gates[id];
  const blocks = gate && Array.isArray(gate.blocks) ? gate.blocks : [];
  if (blocks.length) {
    bundle.appendChild(fine(`Signing unlocks: ${blocks.map((b) => String(b).replace(/_/g, " ")).join(" · ")}.`));
  }

  const quarantined = externalItemCount(st);
  if (quarantined) {
    bundle.appendChild(fine(`${plural(quarantined, "external item")} are quarantined — admit them individually in External.`));
  }

  body.appendChild(bundle);
}

/* External evidence never stops the run — it only gets a footer line. Count
 * items the research seat actually retrieved (they carry an external record),
 * not its "did not run" placeholder note. */
function externalItemCount(st) {
  if (Array.isArray(st.research)) return st.research.length;
  const findings = Array.isArray(st.findings) ? st.findings : [];
  return findings.filter((f) => f && f.agentId === "research" && f.external && f.external.url).length;
}

function sendBack(id) {
  const meta = GATE_META[id];
  if (meta && meta.stage && deps && typeof deps.stage === "function") deps.stage(meta.stage);
  markContested(id);

  const body = $id("vp-desk-body");
  if (!body) return;
  if (meta) deskWaiting(meta);
  body.innerHTML = "";
  const box = el("div", "c-bundle");
  box.appendChild(el("h3", null, `GATE ${meta ? meta.n : "?"} · sent back`));
  box.appendChild(el("p", null, "You're reviewing — the bundle waits here. Approve from the stage when it holds up, or bring the bundle back."));
  const again = el("button", "pbtn", "Bring the bundle back");
  again.type = "button";
  again.style.marginTop = "8px";
  again.addEventListener("click", () => renderBundle(id));
  box.appendChild(again);
  body.appendChild(box);
}

/* ---------- the gate event ---------- */

function onGateEvent(ev) {
  const d = (ev && ev.detail) || {};
  if (d.status !== "approved") return;
  clearContested(d.id);
  if (pending && pending.id === d.id) {
    const resolve = pending.resolve;
    pending = null;
    deskIdle();
    resolve();
  }
}

/* ---------- public API ---------- */

export function initVP({ approveGate, getState, stage } = {}) {
  deps = { approveGate, getState, stage };
  document.removeEventListener("council:gate", onGateEvent);
  document.addEventListener("council:gate", onGateEvent);
}

export function stopAtGate(id) {
  /* Already cleared (a visitor may sign from a stage before the run arrives):
   * nothing to wait for. */
  const gate = safeState().gates;
  if (gate && gate[id] && gate[id].status === "approved") return Promise.resolve();

  /* Only one stop can be parked at a time; a stale one is released first so no
   * await leaks. */
  if (pending) {
    const stale = pending.resolve;
    pending = null;
    stale();
  }

  return new Promise((resolve) => {
    pending = { id, resolve };
    renderBundle(id);
    scrollDeskIntoView();
  });
}

export function cancelStop() {
  if (!pending) return;
  const resolve = pending.resolve;
  pending = null;
  clearAllContested();
  deskIdle();
  resolve();
}

export function caseCardToOwn() {
  const st = safeState();
  const count = $id("vp-case-count");
  if (count) count.textContent = "your files";
  const body = $id("vp-case-body");
  if (!body) return;

  const files = Array.isArray(st.files) ? st.files : [];
  const tables = Array.isArray(st.tables) ? st.tables : [];
  const spans = Array.isArray(st.spans) ? st.spans : [];
  const sheets = new Set();
  let cells = 0;
  for (const t of tables) {
    if (!t) continue;
    if (t.sheet) sheets.add(t.sheet);
    const rows = Array.isArray(t.rows) ? t.rows.length : 0;
    const cols = Array.isArray(t.header) ? t.header.length : 0;
    cells += rows * cols;
  }

  const bits = [plural(files.length, "file")];
  if (tables.length) {
    bits.push(`${plural(tables.length, "table")}${sheets.size ? ` across ${plural(sheets.size, "sheet")}` : ""}`);
  }
  if (cells) bits.push(`${U.fmt.compact(cells)} cells`);
  if (spans.length) bits.push(plural(spans.length, "text span"));

  body.innerHTML = "";
  const p1 = el("p");
  p1.appendChild(el("b", null, "Your case."));
  p1.appendChild(document.createTextNode(` ${bits.join(" · ")} — profiled, hashed, and on the record.`));
  body.appendChild(p1);
  const p2 = el("p");
  p2.appendChild(document.createTextNode("Same rules as the sample: fifteen auditors take the analysis apart, engines compute every figure twice, and "));
  p2.appendChild(el("b", null, "nothing becomes true until you sign it."));
  body.appendChild(p2);
}
