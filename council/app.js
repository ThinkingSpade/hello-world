/* app.js — orchestration.
 *
 * The run is a state machine with four hard stops in it. Each stop is a human
 * gate, and nothing downstream of a pending gate is allowed to execute. That is
 * the whole architecture: the interesting work is deciding what the numbers
 * mean, and the software's job is to make sure a person decides it.
 *
 * Nothing here knows anything about a particular dataset. Every measure is
 * derived from the approved data contract at run time.
 */
import { U } from "./util.js";
import { Ingest } from "./ingest.js";
import { Vectorizer } from "./vector.js";
import { Contract } from "./contract.js";
import { Calc } from "./calc.js";
import { Claims } from "./claims.js";
import { Council } from "./council.js";
import { Bench } from "./agents.js";
import { buildDeliberation } from "./deliberate.js";
import { Trace } from "./trace.js";
import { EmbedView } from "./embedview.js";
import { Viz } from "./viz.js";
import { Report } from "./report.js";
import { initVP, stopAtGate, cancelStop, caseCardToOwn, caseManifest } from "./vp.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------- state ---------- */

const S = {
  files: [], tables: [], spans: [],
  index: null,
  fact: null, factContract: null, collapsed: null,
  reference: null,                 // an attribute table joined to the fact table
  model: null,
  specs: [], results: [],
  findings: [], resolutions: [], turns: [],
  charts: [],
  gates: {
    data_contract:        { id: "data_contract",        status: "pending", approvedBy: null, approvedAt: null, notes: "", blocks: ["calc_definitions", "council", "final_recommendation"] },
    calc_definitions:     { id: "calc_definitions",     status: "pending", approvedBy: null, approvedAt: null, notes: "", blocks: ["calculated claims", "final_recommendation"] },
    external_evidence:    { id: "external_evidence",    status: "pending", approvedBy: null, approvedAt: null, notes: "", blocks: ["external claims in output"] },
    final_recommendation: { id: "final_recommendation", status: "pending", approvedBy: null, approvedAt: null, notes: "", blocks: ["final export"] },
  },
};

/* ---------- chrome ---------- */

function toast(msg, kind = "") {
  const t = el("div", `c-toast ${kind}`, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5200);
}

function stage(name) {
  $$(".stage").forEach((s) => s.classList.toggle("c-hidden", s.dataset.stage !== name));
  $$(".c-step").forEach((b) => {
    if (b.dataset.stage === name) b.dataset.state = "active";
    else if (b.dataset.state === "active") b.dataset.state = "";
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function railStatus(id, text, state) {
  const s = $(`#rail-${id}`);
  if (s) s.textContent = text;
  const b = $(`.c-step[data-stage="${id}"]`);
  if (b && state && b.dataset.state !== "active") b.dataset.state = state;
}

function tick(node, value) {
  if (!node) return;
  node.textContent = value;
  node.classList.remove("c-tick");
  void node.offsetWidth;
  node.classList.add("c-tick");
}

function refreshRunStrip() {
  const sum = Claims.summary();
  const rec = S.results.filter((r) => r.reconciled).length;
  $("#run-strip").innerHTML =
    `RUN <b>${U.escapeHtml(Report.computeRunId().slice(0, 12))}</b> · CLAIMS <b>${sum.total}</b> · RECONCILED <b>${rec}/${S.results.length}</b>`;
}

/* ---------- 01 · intake ---------- */

async function ingestFiles(fileList) {
  const drop = $("#drop");
  drop.classList.add("busy");
  Bench.setState("sentinel", "reading", "scanning intake");
  Trace.rule("intake");

  for (const f of fileList) {
    try {
      Trace.step("ingest", `${f.name}`);
      const res = await Ingest.ingest(f, f.name);
      Trace.detail("ingest", `kind=${res.file.kind} bytes=${res.file.bytes} sha256=${res.file.sha256.slice(0, 16)}`);
      Trace.detail("ingest", `${res.tables.length} table(s), ${res.spans.length} span(s)`);
      for (const w of res.file.warnings || []) Trace.warn("ingest", w);
      const inj = res.spans.filter((x) => x.injection);
      if (inj.length) Trace.warn("sentinel", `${inj.length} span(s) contain instruction-like text — annotated, never acted on`);
      S.files.push(res.file);
      S.tables.push(...res.tables);
      S.spans.push(...res.spans);
      renderFileCard(res);
    } catch (e) {
      Trace.error("ingest", `${f.name}: ${e.message}`);
      toast(`${f.name}: ${e.message}`, "err");
      console.error(e);
    }
  }

  drop.classList.remove("busy");
  tick($("#intake-count"), `${S.files.length} file${S.files.length === 1 ? "" : "s"}`);
  railStatus("corpus", `${S.files.length} files · ${S.tables.length} tables · ${S.spans.length} spans`, "done");

  await buildIndex();
  renderSentinel();
  pickFactTable();
  Bench.setState("sentinel", "done", `${S.spans.length} spans clean`);
}

function renderFileCard(res) {
  const f = res.file;
  const flagged = res.spans.filter((s) => s.injection);
  const card = el("div", `c-file${flagged.length ? " flag" : ""}`);
  card.appendChild(el("div", "k", f.kind.toUpperCase()));
  const body = el("div");
  body.appendChild(el("div", "nm", f.name));
  const meta = el("div", "mt");
  meta.textContent = `${U.fmt.compact(f.bytes)}B · ${res.tables.length} table${res.tables.length === 1 ? "" : "s"} · ${res.spans.length} spans · sha ${f.sha256.slice(0, 10)}`;
  body.appendChild(meta);
  if (f.warnings && f.warnings.length) {
    const w = el("div", "mt");
    w.style.color = "var(--pi-warn)";
    w.textContent = f.warnings.slice(0, 2).join(" · ");
    body.appendChild(w);
  }
  if (flagged.length) {
    const w = el("div", "mt");
    w.style.color = "var(--pi-err)";
    w.textContent = `${flagged.length} span${flagged.length === 1 ? "" : "s"} flagged by the sentinel`;
    body.appendChild(w);
  }
  card.appendChild(body);
  $("#files").appendChild(card);
}

async function buildIndex() {
  if (!S.spans.length) return;
  $("#vec-lamp").className = "pwin-lamp warn";
  S.index = Vectorizer.build(S.spans);
  const st = Vectorizer.stats(S.index);
  Trace.step("index", `embedding ${st.spans} spans into ${st.dim} dimensions`);
  Trace.detail("index", `recipe: word unigrams + bigrams + char 4-grams, signed FNV-1a hashing, (1+log tf)·idf, L2 normalised`);
  Trace.detail("index", `vocabulary ${st.vocab} distinct terms across ${st.spans} spans`);
  Trace.detail("index", `embedder ${st.version} — deterministic, so the same corpus always yields the same vectors`);

  /* Paint the matrix as it fills. The corpus visibly becoming numbers is worth
   * the second it costs: it is the step most retrieval systems ask you to take
   * on faith, and here it is the actual index being drawn. */
  await EmbedView.stream(S.index, {
    onStep: (done, total) => { $("#vec-count").textContent = `embedding ${done}/${total}`; },
  });
  const dims = EmbedView.render(S.index);
  if (dims) Trace.result("index", `matrix ${dims.rows} × ${dims.dim}, peak |weight| ${dims.peak.toFixed(3)}`);
  $("#embed-legend").innerHTML =
    `<span><i class="pos"></i>positive</span><span><i class="neg"></i>negative</span>` +
    `<span><i class="zed"></i>zero</span><span><i class="hit"></i>matches your question</span>` +
    `<span>${st.spans} spans × ${st.dim} dims = ${U.fmt.compact(st.spans * st.dim)} weights</span>`;
  $("#vec-lamp").className = "pwin-lamp on";
  $("#vec-count").textContent = `${st.spans} spans · ${st.vocab} terms · ${st.dim}d · ${st.version}`;
  Report.set("engine", { app: "council/1", vectorizer: st.version, sqlite: "sql.js" });
}

function renderSentinel() {
  const box = $("#sentinel");
  box.innerHTML = "";
  const flagged = S.spans.filter((s) => s.injection);
  const lamp = $("#sentinel-lamp");

  const intro = el("p");
  intro.style.cssText = "margin:0 0 10px;font-size:13px;color:var(--pi-muted)";
  intro.textContent = "Uploaded content is data, never instruction. Anything below that reads as an instruction to a model is quarantined and shown to you verbatim.";
  box.appendChild(intro);

  if (!flagged.length) {
    lamp.className = "pwin-lamp on";
    const ok = el("p");
    ok.style.cssText = "margin:0;font-size:13px";
    ok.textContent = `${S.spans.length} spans scanned. Nothing in the corpus attempts to instruct the model.`;
    box.appendChild(ok);
    return;
  }

  lamp.className = "pwin-lamp err";
  for (const s of flagged.slice(0, 12)) {
    const d = el("div", "c-untrusted");
    d.appendChild(el("span", "lbl", `${s.injection.severity.toUpperCase()} · ${s.injection.pattern} · ${locatorLabel(s.locator)}`));
    d.appendChild(document.createTextNode(s.injection.excerpt));
    box.appendChild(d);
  }
  Claims.tryAdd({
    type: "limitation",
    text: `${flagged.length} extracted span(s) contain text that reads as an instruction to a language model rather than as case content.`,
    constrains: "Any council reading of those spans — they are passed to models inside an untrusted envelope and may not be treated as direction.",
    author: "deterministic",
    confidence: "high",
  });
}

function locatorLabel(loc = {}) {
  const b = [];
  if (loc.sheet) b.push(loc.sheet);
  if (loc.page) b.push(`p${loc.page}`);
  if (loc.slide) b.push(`slide ${loc.slide}`);
  if (loc.para >= 0) b.push(`¶${loc.para}`);
  if (loc.row) b.push(`row ${loc.row}`);
  if (loc.range) b.push(loc.range);
  return b.join(" ") || "—";
}

/* ---------- table roles ----------
 * The fact table is the widest one with a date column. A reference table is a
 * narrow table whose key column shares its values with a fact column — that is
 * how the app finds a yield or price attribute without being told about it. */

function pickFactTable() {
  if (!S.tables.length) return;
  const scored = S.tables.map((t) => {
    const hasDate = (t.colTypes || []).includes("date");
    return { t, score: (hasDate ? 1e6 : 0) + t.rows.length };
  }).sort((a, b) => b.score - a.score);
  S.fact = scored[0].t;

  S.reference = null;
  for (const cand of S.tables) {
    if (cand === S.fact || cand.rows.length > 200 || cand.rows.length < 2) continue;
    const link = findLink(S.fact, cand);
    if (link) { S.reference = { table: cand, ...link }; break; }
  }

  Trace.rule("data contract");
  Trace.step("contract", `profiling "${S.fact.sheet}" (${S.fact.rows.length} rows × ${S.fact.header.length} cols)`);
  S.factContract = Contract.profile(S.fact);
  const fc = S.factContract;
  Trace.detail("contract", `grain proposed: ${fc.grain.join(" × ")}`);
  if ((fc.demotedLabels || []).length) {
    Trace.detail("contract", `demoted to labels: ${fc.demotedLabels.join(", ")} (mean distinct per parent < 1.5)`);
  }
  Trace.test("contract", `unique? ${fc.collapsedRowCount} keys / ${fc.rowCount} rows → ${fc.grainIsUnique ? "yes" : "NO"}`);
  if (fc.splitRowGroups.length || fc.duplicateKeys.length) {
    Trace.test("contract", `${fc.duplicateKeys.length} identical-attribute groups → true duplicates`);
    Trace.test("contract", `${fc.splitRowGroups.length} differing-attribute groups → split records`);
  }
  for (const m of fc.measures) Trace.result("contract", `${m.col} → ${m.role}`);
  for (const r of fc.collapseRules) Trace.detail("contract", `fold ${r.col} with ${String(r.rule).toUpperCase()}`);
  for (const p of fc.incompletePeriods) Trace.warn("contract", `${p.period} incomplete — ${p.reason}`);
  if (S.reference) Trace.detail("contract", `attribute table "${S.reference.table.sheet}" joined ${S.reference.factKeyCol} → ${S.reference.refKeyCol}`);
  renderContract();
  railStatus("contract", "profiled · awaiting approval", "");
  stage("contract");
}

function findLink(fact, ref) {
  for (let rc = 0; rc < ref.header.length; rc++) {
    const refVals = new Set(ref.rows.map((r) => String(r[rc] ?? "")).filter(Boolean));
    if (refVals.size < 2) continue;
    for (let fc = 0; fc < fact.header.length; fc++) {
      const factVals = new Set(fact.rows.slice(0, 4000).map((r) => String(r[fc] ?? "")).filter(Boolean));
      if (factVals.size < 2 || factVals.size > refVals.size * 4) continue;
      let hit = 0;
      for (const v of factVals) if (refVals.has(v)) hit++;
      if (hit / factVals.size > 0.95) {
        return { refKeyCol: ref.header[rc], factKeyCol: fact.header[fc] };
      }
    }
  }
  return null;
}

/* ---------- 02 · data contract ---------- */

function renderContract() {
  const c = S.factContract;
  const box = $("#contract-body");
  box.innerHTML = "";
  $("#contract-count").textContent = `${c.rowCount} rows → ${c.collapsedRowCount} keys`;

  box.appendChild(kv("Fact table", `${S.fact.sheet} · ${S.fact.header.length} columns · ${c.rowCount} rows`));
  if (S.reference) {
    box.appendChild(kv("Attribute table", `${S.reference.table.sheet}, joined ${S.reference.factKeyCol} → ${S.reference.refKeyCol}`));
  }

  /* grain */
  const g = el("div");
  g.style.cssText = "margin:14px 0";
  g.appendChild(hd("Grain"));
  const gp = el("p");
  gp.style.cssText = "margin:4px 0;font-size:14px";
  gp.innerHTML = `<span class="c-num">${c.grain.map(U.escapeHtml).join(" × ")}</span> — ` +
    (c.grainIsUnique
      ? `<span style="color:var(--pi-ok)">unique in the source.</span>`
      : `<span style="color:var(--pi-warn)">not unique.</span> ${c.splitRowGroups.length} key(s) appear more than once.`);
  g.appendChild(gp);
  box.appendChild(g);

  /* the split-row story — the trap most pipelines walk into */
  if (c.splitRowGroups.length) {
    const s = el("div");
    s.style.cssText = "border:2px solid var(--pi-warn);background:var(--pi-warn-soft);padding:12px;margin:12px 0";
    s.appendChild(hd("Repeated keys are not duplicates"));
    const cols = [...new Set(c.splitRowGroups.flatMap((x) => x.differingCols))];
    const p = el("p");
    p.style.cssText = "margin:6px 0;font-size:14px";
    p.textContent =
      `${c.splitRowGroups.length} grain keys appear more than once, and the repeated rows differ in ` +
      `${cols.map((x) => `"${x}"`).join(", ")}. That is one fact recorded in segments, not the same fact twice. ` +
      `Dropping a segment loses real volume; summing every column inflates anything that is a level rather than a rate.`;
    s.appendChild(p);
    if (c.duplicateKeys.length) {
      s.appendChild(el("p", null, `Separately, ${c.duplicateKeys.length} keys repeat with identical attributes — those are true duplicates.`));
    }
    box.appendChild(s);
  }

  /* collapse rules — editable, because this is the human's call */
  const m = el("div");
  m.style.cssText = "margin:14px 0";
  m.appendChild(hd("How each measure folds"));
  const tbl = el("table", "ptable");
  tbl.style.width = "100%";
  tbl.innerHTML = "<thead><tr><th>Column</th><th>Role</th><th>Rule</th><th>Why</th></tr></thead>";
  const tb = el("tbody");
  for (const meas of c.measures) {
    const rule = c.collapseRules.find((r) => r.col === meas.col);
    const tr = el("tr");
    tr.appendChild(el("td", null, meas.col));
    const roleTd = el("td");
    const chip = el("span", `pchip ${meas.role === "stock" ? "warn" : meas.role === "flow" ? "acc" : ""}`, meas.role);
    roleTd.appendChild(chip);
    tr.appendChild(roleTd);
    const sel = el("select");
    sel.style.cssText = "padding:4px;border:1.5px solid var(--pi-ink);font-family:var(--pi-font-code);font-size:12px";
    for (const r of ["sum", "max", "min", "first", "last", "unique"]) {
      const o = el("option", null, r);
      o.value = r;
      if (rule && rule.rule === r) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      rule.rule = sel.value;
      c.approved = false;
      setGate("data_contract", "pending");
      toast(`Collapse rule for "${meas.col}" is now ${sel.value}. The contract needs re-approval.`);
    });
    const td = el("td");
    td.appendChild(sel);
    tr.appendChild(td);
    const why = el("td");
    why.style.fontSize = "12px";
    why.style.color = "var(--pi-muted)";
    why.textContent = meas.rationale;
    tr.appendChild(why);
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const wrap = el("div", "ptable-wrap");
  wrap.appendChild(tbl);
  m.appendChild(wrap);
  box.appendChild(m);

  /* periods and completeness */
  if (c.periods.length) {
    const p = c.periods[0];
    const d = el("div");
    d.style.cssText = "margin:14px 0";
    d.appendChild(hd("Period coverage"));
    d.appendChild(kv("Column", `${p.col} · ${p.min} → ${p.max}${p.cadenceDays ? ` · every ${p.cadenceDays} days` : ""}`));
    if (c.incompletePeriods.length) {
      const box2 = el("div");
      box2.style.cssText = "border:2px solid var(--pi-err);background:var(--pi-err-soft);padding:10px;margin-top:8px";
      box2.appendChild(el("p", null,
        `${c.incompletePeriods.length} period(s) look structurally incomplete and will be excluded from trailing comparisons:`));
      const ul = el("ul");
      ul.style.margin = "6px 0 0 18px";
      for (const i of c.incompletePeriods.slice(0, 6)) {
        ul.appendChild(el("li", null, `${i.period} — ${i.reason}`));
      }
      box2.appendChild(ul);
      d.appendChild(box2);
    }
    box.appendChild(d);
  }

  Bench.setState("contract", "done", `${c.rowCount}→${c.collapsedRowCount} keys`);
}

function hd(t) {
  const h = el("h3", null, t);
  h.style.cssText = "font-family:var(--pi-font-title);font-size:10px;margin:0";
  return h;
}
function kv(k, v) {
  const d = el("div");
  d.style.cssText = "display:flex;gap:10px;font-size:14px;padding:3px 0";
  const a = el("span", null, k);
  a.style.cssText = "color:var(--pi-muted);min-width:130px";
  d.appendChild(a);
  d.appendChild(el("span", "c-num", v));
  return d;
}

/* ---------- gates ---------- */

function setGate(id, status, notes = "") {
  const g = S.gates[id];
  g.status = status;
  g.notes = notes;
  if (status === "approved") {
    g.approvedBy = "operator (this session)";
    g.approvedAt = new Date().toISOString();
  }
  Trace.gate(`gate "${id}" → ${status}`);
  const node = $(`#gate-${id}`);
  node.dataset.status = status;
  $$(".c-gate-approved-stamp", node).forEach((n) => n.remove());
  if (status === "approved") {
    const stamp = el("span", "c-gate-approved-stamp", "APPROVED");
    node.appendChild(stamp);
    Bench.gavel();
  }
  Report.set("gates", Object.values(S.gates));
  refreshRunStrip();
  document.dispatchEvent(new CustomEvent("council:gate", { detail: { id, status } }));
}

async function approveGate(id) {
  switch (id) {
    case "data_contract": {
      S.factContract.approved = true;
      S.collapsed = Contract.applyCollapse(S.fact, S.factContract);
      await Calc.init();
      await Calc.loadTable(S.collapsed, S.factContract, "fact");
      if (S.reference) await Calc.loadTable(S.reference.table, null, "ref");
      recordContractClaims();
      deriveSpecs();
      setGate("data_contract", "approved");
      railStatus("contract", "approved", "done");
      railStatus("calc", `${S.specs.length} specs · awaiting approval`, "");
      Report.set("contract", S.factContract);
      stage("calc");
      toast("Data contract approved. Calculations are unlocked.", "ok");
      break;
    }
    case "calc_definitions": {
      if (S.gates.data_contract.status !== "approved") return toast("Gate 1 has to clear first.", "err");
      S.specs.forEach((s) => { s.approved = true; });
      renderSpecs();
      setGate("calc_definitions", "approved");
      railStatus("calc", "approved", "done");
      await runAllSpecs();
      stage("council");
      break;
    }
    case "external_evidence":
      setGate("external_evidence", "approved");
      railStatus("research", "reviewed", "done");
      renderResearch();
      break;
    case "final_recommendation": {
      const unrec = S.results.filter((r) => !r.reconciled && !r.error).length;
      const disputed = Claims.ledger().filter((c) => c.status === "disputed").length;
      setGate("final_recommendation", "approved",
        `${disputed} claim(s) still carry recorded dissent; ${unrec} figure(s) unreconciled.`);
      railStatus("report", "signed", "done");
      toast(disputed ? `Signed with ${disputed} dissent(s) preserved in the bundle.` : "Signed.", "ok");
      break;
    }
  }
  renderReproduce();
}

/* ---------- contract → claims ---------- */

function recordContractClaims() {
  const c = S.factContract;
  const f = S.files.find((x) => x.fileId === S.fact.fileId) || S.files[0];
  const prov = (locator, transformation) => [{
    fileId: f.fileId, fileName: f.name, sha256: f.sha256,
    locator, transformation, runId: Report.computeRunId(),
  }];

  Claims.tryAdd({
    type: "observed",
    text: `The source carries ${c.rowCount} rows at ${c.grain.join(" × ")}, which collapse to ${c.collapsedRowCount} distinct keys.`,
    value: c.collapsedRowCount, unit: "keys",
    provenance: prov({ sheet: S.fact.sheet, range: S.fact.range }, "row count before and after applying the approved collapse rules"),
    author: "deterministic", confidence: "high",
  });

  if (c.splitRowGroups.length) {
    const cols = [...new Set(c.splitRowGroups.flatMap((x) => x.differingCols))];
    Claims.tryAdd({
      type: "observed",
      text: `${c.splitRowGroups.length} grain keys are recorded in more than one segment, differing only in ${cols.join(", ")}.`,
      value: c.splitRowGroups.length, unit: "keys",
      provenance: prov({ sheet: S.fact.sheet, range: S.fact.range }, "grouped by the approved grain; segments compared on non-key attributes"),
      author: "deterministic", confidence: "high",
    });
    for (const m of c.measures.filter((x) => x.role !== "attribute")) {
      const rule = c.collapseRules.find((r) => r.col === m.col);
      Claims.tryAdd({
        type: "analytical_assumption",
        text: `"${m.col}" is treated as a ${m.role} and folded with ${rule.rule.toUpperCase()} across segments of the same key.`,
        rationale: m.rationale,
        breaksIf: m.role === "stock"
          ? `If "${m.col}" is in fact additive across segments, every level in this analysis is understated.`
          : `If "${m.col}" is in fact a point-in-time level, every total here is overstated wherever a key is split.`,
        author: "deterministic", confidence: m.role === "stock" ? "medium" : "high",
      });
    }
  }

  for (const p of c.incompletePeriods) {
    Claims.tryAdd({
      type: "observed",
      text: `Period ${p.period} is structurally incomplete — ${p.reason}`,
      provenance: prov({ sheet: S.fact.sheet, range: S.fact.range }, "distinct contributing entities per period versus the modal count"),
      author: "deterministic", confidence: "high",
    });
    Claims.tryAdd({
      type: "analytical_assumption",
      text: `Period ${p.period} is excluded from every trailing and year-over-year comparison.`,
      rationale: "A partially reported period depresses any window that contains it, and the drop is an artefact of reporting rather than of demand.",
      breaksIf: "If the period is genuinely complete and simply small, excluding it hides a real decline.",
      author: "deterministic", confidence: "high",
    });
  }
  renderClaims();
}

/* ---------- 03 · derive calculation specs ----------
 * Derived from the approved contract, never from a hardcoded schema. If the
 * corpus has a period column, a flow measure and a numeric attribute in a
 * joined reference table, the app builds the matched-window comparisons that
 * any period-over-period analysis needs — and nothing it cannot source. */

function deriveSpecs() {
  S.specs = [];
  const c = S.factContract;
  const dateCol = c.periods.length ? c.periods[0].col : null;
  if (!dateCol) { renderSpecs(); return; }

  const complete = completePeriods();
  if (complete.length < 8) { renderSpecs(); return; }

  const flows = c.measures.filter((m) => m.role === "flow").map((m) => m.col);
  const stocks = c.measures.filter((m) => m.role === "stock").map((m) => m.col);
  const dims = c.grain.filter((g) => g !== dateCol);
  const weights = referenceWeights();

  const last = complete[complete.length - 1];
  const cadence = c.periods[0].cadenceDays || 7;
  const yearBack = (d, n = 1) => shiftDays(d, -Math.round(364 * n * (cadence === 7 ? 1 : 365 / 364)));

  /* the launch/change point: the first period in which a value appears that was
   * absent from the first half of the series. Structural, not hardcoded. */
  const change = detectChange(dims);
  const from = (change && change.period) || complete[Math.max(0, complete.length - 16)];

  const windows = [
    { id: "full", label: `${from} → ${last}`, from, to: last },
    { id: "l4",  label: `trailing 4 periods`,  from: complete[Math.max(0, complete.length - 4)],  to: last },
    { id: "l8",  label: `trailing 8 periods`,  from: complete[Math.max(0, complete.length - 8)],  to: last },
    { id: "l13", label: `trailing 13 periods`, from: complete[Math.max(0, complete.length - 13)], to: last },
  ];

  for (const flow of flows) {
    for (const w of windows) {
      addSpec(matchedSpec({ measure: flow, dateCol, w, weights: null }));
      if (weights) addSpec(matchedSpec({ measure: flow, dateCol, w, weights }));
    }
    for (const d of dims) {
      for (const v of distinctValues(d).slice(0, 8)) {
        addSpec(matchedSpec({ measure: flow, dateCol, w: windows[0], weights, filter: { col: d, value: v } }));
      }
    }
  }

  /* Share of the last complete period held by items that only appear in the
   * back half of the series. Structural, not semantic: the app never has to be
   * told which items are "new", and this is the figure everyone reaches for
   * first — which is exactly why the council has to say what it does not mean. */
  if (change && change.values.length && flows.length) {
    const inList = change.values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
    addSpec({
      name: `New-item share of ${flows[0]} · ${last}`,
      description:
        `Share of ${flows[0]} in the last complete period held by ${change.dim} values that never appear in the first half ` +
        `of the series (${change.values.join(", ")}), i.e. items that arrived with the change. Measures channel composition, not customer behaviour.`,
      unit: "ratio", period: { from: last, to: last },
      sql: `SELECT CAST(SUM(CASE WHEN ${q(change.dim)} IN (${inList}) THEN ${q(flows[0])} ELSE 0 END) AS REAL) ` +
           `/ NULLIF(SUM(${q(flows[0])}), 0) AS v FROM fact WHERE ${q(dateCol)} = $d`,
      params: {
        $d: last, col: flows[0],
        filters: [{ col: dateCol, op: "eq", value: last }, { col: change.dim, op: "in", value: change.values }],
        denomFilters: [{ col: dateCol, op: "eq", value: last }],
      },
      reducer: "share_where",
    });
  }

  for (const stock of stocks) {
    addSpec({
      name: `${stock} at ${last}`,
      description: `On-hand ${stock} at the last complete period, using the approved ${collapseRuleFor(stock).toUpperCase()} fold.`,
      unit: "units", period: { from: last, to: last },
      sql: `SELECT SUM(${q(stock)}) AS v FROM fact WHERE ${q(dateCol)} = $d`,
      params: { $d: last, col: stock, filters: [{ col: dateCol, op: "eq", value: last }] },
      reducer: "sum_where",
    });
  }

  renderSpecs();
  Trace.rule("calculation definitions");
  Trace.step("calc", `derived ${S.specs.length} specifications from the approved contract`);
  if (change) Trace.detail("calc", `change point detected at ${change.period} on "${change.dim}" (${change.values.length} arriving value(s))`);
  if (weights) Trace.detail("calc", `weight column chosen: "${weights.col}" (widest spread in the attribute table)`);
  railStatus("calc", `${S.specs.length} specs · awaiting approval`, "");
}

function matchedSpec({ measure, dateCol, w, weights, filter }) {
  const priorFrom = shiftDays(w.from, -364);
  const priorTo = shiftDays(w.to, -364);
  const wname = weights ? `${measure} × ${weights.col}` : measure;
  const fname = filter ? ` · ${filter.col}=${filter.value}` : "";

  const joinSql = weights
    ? `FROM fact f JOIN ref r ON f.${q(S.reference.factKeyCol)} = r.${q(S.reference.refKeyCol)}`
    : `FROM fact f`;
  const valueExpr = weights ? `f.${q(measure)} * r.${q(weights.col)}` : `f.${q(measure)}`;
  const filterSql = filter ? ` AND f.${q(filter.col)} = $fv` : "";

  const sql =
    `SELECT (SELECT COALESCE(SUM(${valueExpr}),0) ${joinSql} ` +
    `WHERE f.${q(dateCol)} BETWEEN $a1 AND $a2${filterSql}) / ` +
    `NULLIF((SELECT COALESCE(SUM(${valueExpr}),0) ${joinSql} ` +
    `WHERE f.${q(dateCol)} BETWEEN $b1 AND $b2${filterSql}),0) - 1 AS v`;

  return {
    name: `${wname}${fname} — ${w.label} vs matched prior`,
    description:
      `Change in ${wname}${fname} between ${w.from}…${w.to} and the same-length window one year earlier ` +
      `(${priorFrom}…${priorTo}), aligned on a 364-day offset so weekday effects match. ` +
      `Structurally incomplete periods are excluded.`,
    unit: "ratio",
    period: { from: w.from, to: w.to },
    sql,
    params: {
      $a1: w.from, $a2: w.to, $b1: priorFrom, $b2: priorTo,
      ...(filter ? { $fv: String(filter.value) } : {}),
      col: measure, dateCol,
      fromA: w.from, toA: w.to, fromB: priorFrom, toB: priorTo,
      weightKey: weights ? S.reference.factKeyCol : undefined,
      weights: weights ? weights.map : undefined,
      filters: filter ? [{ col: filter.col, op: "eq", value: filter.value }] : [],
    },
    reducer: "ratio_of_windows",
  };
}

function addSpec(partial) {
  const spec = {
    specId: U.stableId("spec", partial.name, partial.sql),
    runId: "",
    proposedBy: "human",
    approved: false,
    tolerance: 1e-9,
    ...partial,
  };
  if (!S.specs.some((s) => s.specId === spec.specId)) S.specs.push(spec);
  return spec;
}

function q(name) { return `"${String(name).replace(/"/g, '""')}"`; }

function collapseRuleFor(col) {
  const r = S.factContract.collapseRules.find((x) => x.col === col);
  return r ? r.rule : "sum";
}

function completePeriods() {
  const c = S.factContract;
  const dateCol = c.periods.length ? c.periods[0].col : null;
  if (!dateCol) return [];
  const bad = new Set(c.incompletePeriods.map((i) => i.period));
  const idx = S.collapsed ? S.collapsed.header.indexOf(dateCol) : S.fact.header.indexOf(dateCol);
  const rows = S.collapsed ? S.collapsed.rows : S.fact.rows;
  return [...new Set(rows.map((r) => String(r[idx] ?? "").slice(0, 10)))]
    .filter((d) => d && !bad.has(d)).sort();
}

function distinctValues(col) {
  const idx = S.collapsed.header.indexOf(col);
  return [...new Set(S.collapsed.rows.map((r) => String(r[idx] ?? "")))].filter(Boolean).sort();
}

/* A numeric attribute on the reference table becomes a weight — that is how a
 * rated-capacity measure appears without the app being told what a yield is. */
function referenceWeights() {
  if (!S.reference) return null;
  const t = S.reference.table;
  const keyIdx = t.header.indexOf(S.reference.refKeyCol);
  let best = null;
  for (let c = 0; c < t.header.length; c++) {
    if (c === keyIdx) continue;
    const vals = t.rows.map((r) => Number(r[c])).filter((v) => Number.isFinite(v));
    if (vals.length !== t.rows.length) continue;
    const spread = Math.max(...vals) / Math.max(1, Math.min(...vals));
    if (!best || spread > best.spread) best = { col: t.header[c], idx: c, spread };
  }
  if (!best) return null;
  const map = {};
  for (const r of t.rows) map[String(r[keyIdx])] = Number(r[best.idx]);
  return { col: best.col, map };
}

/* The change point: the first period containing a dimension value that never
 * occurs in the first half of the series. That is a launch, a new account, a
 * new SKU — whatever the data's own structure says changed.
 *
 * Returns the arriving values too, because "how much of today is the new thing"
 * is the question everyone asks first, and it can be answered structurally
 * without the app being told what any of these items are. */
function detectChange(dims) {
  if (!S.collapsed || !dims.length) return null;
  const dateCol = S.factContract.periods[0].col;
  const di = S.collapsed.header.indexOf(dateCol);
  const periods = completePeriods();
  const half = periods[Math.floor(periods.length / 2)];
  for (const d of dims) {
    const ci = S.collapsed.header.indexOf(d);
    const early = new Set();
    for (const r of S.collapsed.rows) {
      if (String(r[di]).slice(0, 10) <= half) early.add(String(r[ci]));
    }
    const arrivals = new Set();
    let first = null;
    for (const r of S.collapsed.rows) {
      const v = String(r[ci]);
      if (early.has(v)) continue;
      arrivals.add(v);
      const p = String(r[di]).slice(0, 10);
      if (!first || p < first) first = p;
    }
    if (first) return { period: first, dim: d, values: [...arrivals].sort() };
  }
  return null;
}

function shiftDays(iso, days) {
  const t = Date.parse(iso + "T00:00:00Z");
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/* ---------- render specs + results ---------- */

function renderSpecs() {
  const box = $("#specs");
  box.innerHTML = "";
  $("#spec-count").textContent = `${S.specs.length} specs`;
  if (!S.specs.length) {
    box.appendChild(el("p", "c-empty", "No calculations could be derived — the corpus has no period column with enough complete periods."));
    return;
  }
  const wrap = el("div", "c-scroll");
  for (const s of S.specs) {
    const d = el("div");
    d.style.cssText = "border-bottom:1px solid var(--pi-line);padding:8px 10px";
    const hdRow = el("div");
    hdRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = s.approved;
    cb.addEventListener("change", () => { s.approved = cb.checked; });
    hdRow.appendChild(cb);
    const nm = el("span", null, s.name);
    nm.style.cssText = "font-weight:600;font-size:13px";
    hdRow.appendChild(nm);
    const by = el("span", `pchip ${s.proposedBy === "human" ? "" : "warn"}`, s.proposedBy === "human" ? "derived" : s.proposedBy);
    hdRow.appendChild(by);
    d.appendChild(hdRow);
    const de = el("div", null, s.description);
    de.style.cssText = "font-size:12px;color:var(--pi-muted);margin:4px 0 0 22px";
    d.appendChild(de);
    const sql = el("pre");
    sql.style.cssText = "font-family:var(--pi-font-code);font-size:11px;background:var(--c-sunken);border:1px solid var(--pi-line);padding:6px;margin:6px 0 0 22px;overflow-x:auto;white-space:pre-wrap";
    sql.textContent = s.sql;
    d.appendChild(sql);
    wrap.appendChild(d);
  }
  box.appendChild(wrap);
}

async function runAllSpecs() {
  const approved = S.specs.filter((s) => s.approved);
  if (!approved.length) return toast("Nothing to run — no definition is approved.", "err");
  Bench.setState("math", "thinking", "executing");
  S.results = [];
  const box = $("#recon");
  box.innerHTML = "";

  Trace.rule("execution — two engines per figure");
  for (const spec of approved) {
    const r = await Calc.run({ ...spec, runId: Report.computeRunId() }, { tableName: "fact" });
    if (r.undefinedResult) {
      Trace.warn("engines", `${spec.name} → undefined (both engines agree there is no value)`);
    } else if (r.reconciled) {
      Trace.result("engines", `${spec.name} → ${formatValue(r.sqlValue, spec.unit)}  [sql==js, Δ${r.delta.toExponential(1)}, ${r.ms.toFixed(1)}ms]`);
    } else {
      Trace.error("engines", `${spec.name} → ${r.error}`);
    }
    S.results.push(r);
    renderReconRow(box, spec, r);

    /* A measure that is undefined over its window is a limitation, not a
     * figure. The commonest cause is an item with no prior-period base — a
     * product that did not exist a year ago has no year-over-year change, and
     * reporting one would be an invention. */
    if (r.undefinedResult) {
      Claims.tryAdd({
        type: "limitation",
        text: `${spec.name} is undefined — the comparison base for this window is empty.`,
        constrains: `Any statement about how this item changed year over year. It has no prior-period base, so a percentage change cannot be computed and must not be inferred from the absolute level.`,
        author: "deterministic", confidence: "high",
      });
      continue;
    }

    if (r.reconciled && r.sqlValue !== null) {
      const f = S.files.find((x) => x.fileId === S.fact.fileId) || S.files[0];
      Claims.tryAdd({
        type: "calculated",
        text: `${spec.name}: ${formatValue(r.sqlValue, spec.unit)}`,
        value: r.sqlValue, unit: spec.unit, period: spec.period,
        calc: { specId: spec.specId, sql: spec.sql, sqlValue: r.sqlValue, jsValue: r.jsValue, reconciled: true },
        provenance: [{
          fileId: f.fileId, fileName: f.name, sha256: f.sha256,
          locator: { sheet: S.fact.sheet, range: S.fact.range },
          transformation: spec.description,
          period: spec.period ? `${spec.period.from} → ${spec.period.to}` : undefined,
          unit: spec.unit, runId: Report.computeRunId(),
        }],
        author: "deterministic", confidence: "high",
      });
    }
  }

  const ok = S.results.filter((r) => r.reconciled).length;
  const undef = S.results.filter((r) => r.undefinedResult).length;
  $("#recon-count").textContent = `${ok}/${S.results.length}${undef ? ` · ${undef} undefined` : ""}`;
  $("#recon-lamp").className = `pwin-lamp ${ok === S.results.length ? "on" : "err"}`;
  Bench.setState("math", ok === S.results.length ? "done" : "flagged", `${ok}/${S.results.length} reconciled`);
  Report.set("specs", S.specs);
  Report.set("results", S.results);
  buildCharts();
  renderClaims();
  refreshRunStrip();
  railStatus("report", "ready", "");
  toast(`${ok} of ${S.results.length} figures reconciled across both engines.`, ok === S.results.length ? "ok" : "err");
}

function renderReconRow(box, spec, r) {
  const d = el("div");
  d.style.cssText = "border-bottom:1px solid var(--pi-line);padding:8px 0";
  const t = el("div", null, spec.name);
  t.style.cssText = "font-size:13px;font-weight:600";
  d.appendChild(t);

  if (r.error && r.sqlValue === null) {
    const e = el("div", null, r.error);
    e.style.cssText = "font-size:12px;color:var(--pi-err);margin-top:4px";
    d.appendChild(e);
    box.appendChild(d);
    return;
  }

  if (r.undefinedResult) {
    const n = el("div", null, r.note);
    n.style.cssText = "font-size:12px;color:var(--pi-warn);margin-top:4px";
    d.appendChild(n);
    box.appendChild(d);
    return;
  }

  const eng = el("div", `c-engines ${r.reconciled ? "ok" : "bad"}`);
  const a = el("div", "eng");
  a.appendChild(el("div", "lab", "SQL · SQLite-WASM"));
  a.appendChild(el("div", null, formatValue(r.sqlValue, spec.unit)));
  eng.appendChild(a);
  eng.appendChild(el("div", "vs", r.reconciled ? "==" : "≠"));
  const b = el("div", "eng");
  b.appendChild(el("div", "lab", `JS · ${spec.reducer}`));
  b.appendChild(el("div", null, formatValue(r.jsValue, spec.unit)));
  eng.appendChild(b);
  d.appendChild(eng);

  const badge = el("div", `c-recon ${r.reconciled ? "ok" : "bad"}`);
  badge.appendChild(el("span", "lamp"));
  badge.appendChild(el("span", null,
    r.reconciled ? `reconciled · Δ ${r.delta.toExponential(1)} · ${r.ms.toFixed(1)}ms` : (r.error || "engines disagree")));
  badge.style.marginTop = "5px";
  d.appendChild(badge);
  box.appendChild(d);
}

function formatValue(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "ratio" || unit === "pct") return U.fmt.pct(v, 2);
  if (unit === "weeks") return v.toFixed(1);
  return U.fmt.compact(v);
}

/* ---------- charts ---------- */

function buildCharts() {
  S.charts = [];
  const mount = $("#charts");
  mount.innerHTML = "";
  if (!S.collapsed) return;

  const c = S.factContract;
  const dateCol = c.periods.length ? c.periods[0].col : null;
  if (!dateCol) return;
  const flows = c.measures.filter((m) => m.role === "flow").map((m) => m.col);
  const stocks = c.measures.filter((m) => m.role === "stock").map((m) => m.col);
  const weights = referenceWeights();
  const complete = new Set(completePeriods());
  const di = S.collapsed.header.indexOf(dateCol);

  if (flows.length) {
    const fi = S.collapsed.header.indexOf(flows[0]);
    const ki = S.reference ? S.collapsed.header.indexOf(S.reference.factKeyCol) : -1;
    const byPeriod = new Map();
    for (const r of S.collapsed.rows) {
      const p = String(r[di]).slice(0, 10);
      if (!complete.has(p)) continue;
      const v = Number(r[fi]) || 0;
      const w = weights && ki >= 0 ? (weights.map[String(r[ki])] ?? 0) : 1;
      const cur = byPeriod.get(p) || { period: p, raw: 0, weighted: 0 };
      cur.raw += v;
      cur.weighted += v * w;
      byPeriod.set(p, cur);
    }
    const rows = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

    /* Two series on one axis only works if they share a scale. Raw units and
     * yield-weighted capacity differ by two orders of magnitude, so plotting
     * both against one axis hides the smaller one entirely — and a dual axis
     * would be worse, because it lets the eye compare two arbitrary scales.
     * Indexing both to their own first period is the honest third option: it
     * puts them on a shared footing and makes the divergence between them —
     * which is exactly the mix effect — the thing you actually see. */
    if (weights) {
      const base = rows.find((r) => r.raw > 0 && r.weighted > 0) || rows[0];
      for (const r of rows) {
        r.rawIdx = base.raw ? (r.raw / base.raw) * 100 : null;
        r.weightedIdx = base.weighted ? (r.weighted / base.weighted) * 100 : null;
      }
    }

    addChart(weights ? {
      chartId: "trend-flow", kind: "line",
      title: `${flows[0]} against ${weights.col}-weighted capacity`,
      subtitle: `Both indexed to 100 at ${rows[0].period}. Where the lines separate, the mix changed — units and capacity are no longer telling the same story.`,
      x: { field: "period", label: dateCol, type: "time" },
      y: { field: "weightedIdx", label: `index (${rows[0].period} = 100)`, zero: true, format: "n" },
      series: [{ field: "weightedIdx", label: `${weights.col}-weighted capacity` }, { field: "rawIdx", label: flows[0] }],
      sourceNote: sourceNote(`Indexed, not absolute. Excludes ${c.incompletePeriods.length} structurally incomplete period(s).`),
      specHash: "",
    } : {
      chartId: "trend-flow", kind: "line",
      title: `${flows[0]} by period`,
      x: { field: "period", label: dateCol, type: "time" },
      y: { field: "raw", label: flows[0], zero: true, format: "compact" },
      series: [{ field: "raw", label: flows[0] }],
      sourceNote: sourceNote(`Excludes ${c.incompletePeriods.length} structurally incomplete period(s).`),
      specHash: "",
    }, rows);
  }

  const dims = c.grain.filter((g) => g !== dateCol);
  if (dims.length && flows.length) {
    const dimCol = dims[dims.length - 1];
    const ci = S.collapsed.header.indexOf(dimCol);
    const fi = S.collapsed.header.indexOf(flows[0]);
    const periods = completePeriods();
    const recent = new Set(periods.slice(-4));
    const prior = new Set(periods.slice(-4).map((p) => shiftDays(p, -364)));
    const agg = new Map();
    for (const r of S.collapsed.rows) {
      const p = String(r[di]).slice(0, 10);
      const k = String(r[ci]);
      const cur = agg.get(k) || { name: k, current: 0, prior: 0 };
      if (recent.has(p)) cur.current += Number(r[fi]) || 0;
      if (prior.has(p)) cur.prior += Number(r[fi]) || 0;
      agg.set(k, cur);
    }
    const rows = [...agg.values()].sort((a, b) => b.current - a.current).slice(0, 12);
    addChart({
      chartId: "dim-compare", kind: "grouped-bar",
      title: `${flows[0]} by ${dimCol} — last 4 periods vs matched prior year`,
      x: { field: "name", label: dimCol, type: "category" },
      y: { field: "current", label: flows[0], zero: true, format: "compact" },
      series: [{ field: "current", label: "current" }, { field: "prior", label: "matched prior" }],
      sourceNote: sourceNote(),
      specHash: "",
    }, rows);
  }

  if (stocks.length) {
    const si = S.collapsed.header.indexOf(stocks[0]);
    const byPeriod = new Map();
    for (const r of S.collapsed.rows) {
      const p = String(r[di]).slice(0, 10);
      if (!complete.has(p)) continue;
      byPeriod.set(p, (byPeriod.get(p) || 0) + (Number(r[si]) || 0));
    }
    const rows = [...byPeriod.entries()].sort().map(([period, v]) => ({ period, value: v }));
    addChart({
      chartId: "stock-trend", kind: "area",
      title: `${stocks[0]} on hand`,
      subtitle: `Folded with ${collapseRuleFor(stocks[0]).toUpperCase()} across split keys — summing would overstate it`,
      x: { field: "period", label: dateCol, type: "time" },
      y: { field: "value", label: stocks[0], zero: true, format: "compact" },
      sourceNote: sourceNote(),
      specHash: "",
    }, rows);
  }

  $("#chart-count").textContent = String(S.charts.length);
  for (const ch of S.charts) {
    const box = el("div", "pwin");
    box.style.padding = "10px";
    mount.appendChild(box);
    try { Viz.render(box, ch.spec, ch.rows); }
    catch (e) { box.textContent = `Chart failed: ${e.message}`; }
  }
  Report.set("charts", S.charts);
}

function addChart(spec, rows) {
  spec.specHash = U.stableId("chart", spec.chartId, JSON.stringify(spec), JSON.stringify(rows).length);
  S.charts.push({ spec, rows });
}

function sourceNote(extra = "") {
  const f = S.files.find((x) => x.fileId === S.fact.fileId) || S.files[0];
  return `Source: ${f ? f.name : "corpus"} · ${S.fact.sheet} · grain ${S.factContract.grain.join(" × ")} · sha ${f ? f.sha256.slice(0, 10) : "—"}. ${extra}`.trim();
}

/* ---------- 04 · council ---------- */

async function convene({ autoplay = true } = {}) {
  if (S.gates.data_contract.status !== "approved") return toast("The data contract has to clear first.", "err");
  $("#council-lamp").className = "pwin-lamp warn";
  $("#findings").innerHTML = "";
  S.findings = [];

  const context = buildCouncilContext();
  const findings = await Council.conveneAll(context, (agentId, phase, note) => {
    Bench.setState(agentId, phase, note);
    if (phase === "writing") Bench.pulse(agentId);
  });

  /* Without a model the seats file useful but static findings. The deliberation
   * is what makes the room legible: the same run, spoken, with the disputes it
   * actually contains. Its findings join the pool so the ladder rules on them
   * for real rather than being narrated. */
  const spoken = buildDeliberation(context);
  S.turns = spoken.turns;
  findings.push(...spoken.findings);

  S.findings = findings;
  const calcRunner = async (spec) => Calc.run({ ...spec, approved: true }, { requireApproval: false, tableName: "fact" });
  S.resolutions = await Council.resolve(findings, { calcRunner, contract: S.factContract });

  renderFindings();
  renderLadder();
  renderResearch();
  renderDissent();
  applyFindingsToLedger();
  $("#council-lamp").className = "pwin-lamp on";
  $("#finding-count").textContent = String(findings.length);
  railStatus("council", `${findings.length} findings`, "done");
  Report.set("findings", findings);
  Report.set("resolutions", S.resolutions);
  Report.set("transcript", Council.transcript());
  Report.set("deliberation", S.turns);
  Report.set("console", Trace.lines());
  refreshRunStrip();
  if (autoplay) await playDeliberation();
}

function buildCouncilContext() {
  const c = S.factContract;
  return {
    runId: Report.computeRunId(),
    files: S.files.map((f) => ({ name: f.name, kind: f.kind, sha256: f.sha256, warnings: f.warnings })),
    contract: {
      grain: c.grain, grainIsUnique: c.grainIsUnique,
      rowCount: c.rowCount, collapsedRowCount: c.collapsedRowCount,
      splitRowGroups: c.splitRowGroups.length,
      duplicateKeys: c.duplicateKeys.length,
      measures: c.measures, collapseRules: c.collapseRules,
      periods: c.periods, incompletePeriods: c.incompletePeriods,
    },
    schema: S.collapsed ? { header: S.collapsed.header, rows: S.collapsed.rows.length } : null,
    reference: S.reference ? { sheet: S.reference.table.sheet, header: S.reference.table.header, rows: S.reference.table.rows } : null,
    specs: S.specs.map((s) => ({ specId: s.specId, name: s.name, description: s.description, sql: s.sql, unit: s.unit })),
    results: S.results.map((r) => ({ specId: r.specId, value: r.sqlValue, reconciled: r.reconciled })),
    claims: Claims.ledger().map((c2) => ({ claimId: c2.claimId, type: c2.type, text: c2.text })),
    spans: dedupeSpans(S.index ? Vectorizer.search(S.index, "conclusion recommendation risk assumption trend driver", { k: 40 }) : [], 24),
    sentinel: S.spans.filter((s) => s.injection).map((s) => ({ spanId: s.spanId, locator: s.locator, flag: s.injection })),
  };
}

/* Decks repeat their furniture — a confidentiality footer sits on every slide
 * and retrieves identically from each one. Left alone, three of the council's
 * twenty-four context slots go to the same sentence. Dedupe on normalised text,
 * keeping the highest-scoring instance and its locator. */
function dedupeSpans(hits, limit) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = h.span.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      spanId: h.spanId,
      text: h.span.text.slice(0, 1200),
      locator: h.span.locator,
      injection: h.span.injection,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function renderFindings() {
  const box = $("#findings");
  box.innerHTML = "";
  const filter = $("#sev-filter").value;
  const list = S.findings.filter((f) => f.agentId !== "research" && (!filter || f.severity === filter));
  if (!list.length) { box.appendChild(el("p", "c-empty", "Nothing at this severity.")); return; }

  const order = { blocker: 0, major: 1, minor: 2, note: 3 };
  for (const f of [...list].sort((a, b) => order[a.severity] - order[b.severity])) {
    const d = el("div", "c-finding");
    d.dataset.sev = f.severity;
    const h = el("div");
    h.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    h.appendChild(el("span", `pchip ${f.severity === "blocker" ? "err" : f.severity === "major" ? "warn" : ""}`, f.severity));
    h.appendChild(el("span", "pchip acc", f.agentId));
    if (f.placeholder) h.appendChild(el("span", "pchip", "dry run — not model generated"));
    d.appendChild(h);
    const t = el("div", "ti", f.title);
    t.style.marginTop = "4px";
    d.appendChild(t);
    d.appendChild(el("div", "de", f.detail));
    for (const cite of f.citations || []) {
      const ci = el("div", "ci");
      ci.textContent = `↳ ${cite.spanId}: "${(cite.quote || "").slice(0, 180)}"`;
      d.appendChild(ci);
    }
    const res = S.resolutions.find((r) => r.findingId === f.findingId);
    if (res) {
      const r = el("div", "ci");
      r.style.color = res.outcome === "escalated" ? "var(--pi-warn)" : "var(--pi-muted)";
      r.textContent = `↳ ${res.outcome} on ${res.basis.replace(/_/g, " ")} — ${res.rationale}`;
      d.appendChild(r);
    }
    box.appendChild(d);
  }
}

function renderLadder() {
  /* Count only genuine disagreements. An uncontested finding was never
   * adjudicated, and counting it here would make the ladder look busier — and
   * the review look more rigorous — than it actually was. */
  const counts = { source_quality: 0, formula_reproducibility: 0, definition_consistency: 0, human_judgment: 0 };
  const contested = S.resolutions.filter((r) => r.contested);
  for (const r of contested) if (counts[r.basis] !== undefined) counts[r.basis]++;

  const note = $("#ladder-note");
  if (note) {
    const uncontested = S.resolutions.length - contested.length;
    note.textContent = contested.length
      ? `${contested.length} contested point(s) went to the ladder; ${uncontested} finding(s) were uncontested and were not adjudicated.`
      : `No two seats reached different conclusions on the same point, so the ladder did not need to run. ${uncontested} finding(s) stand uncontested — which is not the same as corroborated.`;
  }

  for (const rung of $$(".c-rung")) {
    const b = rung.dataset.basis;
    rung.classList.toggle("fired", counts[b] > 0);
    rung.classList.toggle("escalated", b === "human_judgment" && counts[b] > 0);
    $("[data-n]", rung).textContent = String(counts[b]);
  }
  const box = $("#escalations");
  box.innerHTML = "";
  const esc = S.resolutions.filter((r) => r.outcome === "escalated");
  if (!esc.length) return;
  const h = el("p", null, `${esc.length} disagreement(s) reached the top of the ladder and stay open for you:`);
  h.style.cssText = "font-size:13px;margin:0 0 6px";
  box.appendChild(h);
  for (const r of esc) {
    const d = el("div", "c-finding");
    d.dataset.sev = "major";
    d.appendChild(el("div", "ti", r.rationale));
    for (const dis of r.dissent || []) {
      d.appendChild(el("div", "de", `${dis.agentId}: ${dis.position} — ${dis.rationale}`));
    }
    box.appendChild(d);
  }
}

function renderResearch() {
  const box = $("#research");
  box.innerHTML = "";
  const items = S.findings.filter((f) => f.agentId === "research");
  if (!items.length) {
    box.appendChild(el("p", "c-empty", "Nothing retrieved. External research runs only when a model is configured, and never enters a conclusion without your approval."));
    railStatus("research", "nothing retrieved", "");
    return;
  }
  for (const f of items) {
    const d = el("div", "c-finding");
    d.dataset.sev = "note";
    d.appendChild(el("div", "ti", f.title));
    d.appendChild(el("div", "de", f.detail));
    const meta = el("div", "ci");
    const url = (f.external && f.external.url) || "(no URL recorded)";
    meta.textContent = `↳ ${url} · retrieved ${(f.external && f.external.retrievedAt) || "—"}`;
    d.appendChild(meta);
    const btn = el("button", "pbtn", "Approve as external context");
    btn.style.marginTop = "6px";
    btn.addEventListener("click", () => {
      const { claim, errors } = Claims.tryAdd({
        type: "external_context",
        text: f.title,
        external: { ...(f.external || {}), approved: true },
        author: `council:${f.agentId}`, confidence: f.confidence || "low",
      });
      if (errors.length) return toast(errors[0], "err");
      Claims.promote(claim.claimId, "operator (this session)");
      btn.disabled = true;
      btn.textContent = "approved";
      renderClaims();
      toast("Promoted to external context and logged with its URL and retrieval date.", "ok");
    });
    d.appendChild(btn);
    box.appendChild(d);
  }
  railStatus("research", `${items.length} quarantined`, "");
}

function renderDissent() {
  const box = $("#dissent");
  box.innerHTML = "";
  const disputed = Claims.ledger().filter((c) => c.dissent && c.dissent.length);
  $("#dissent-count").textContent = String(disputed.length);
  if (!disputed.length) {
    box.appendChild(el("p", "c-empty", "No dissent recorded."));
    return;
  }
  for (const c of disputed) {
    const d = el("div", "c-finding");
    d.dataset.sev = "major";
    d.appendChild(el("div", "ti", c.text));
    for (const dis of c.dissent) {
      d.appendChild(el("div", "de", `${dis.agentId}: ${dis.position} — ${dis.rationale}`));
      Bench.dissent(dis.agentId);
    }
    box.appendChild(d);
  }
}

/* Council findings become PROPOSED claims, typed by the seat that raised them.
 * A seat can never author an observed or calculated claim — those come only
 * from files and engines respectively. */
function applyFindingsToLedger() {
  for (const f of S.findings) {
    if (!f.proposedType) continue;
    if (f.proposedType === "observed" || f.proposedType === "calculated") continue;
    if (f.agentId === "research") continue;
    Claims.tryAdd({
      type: f.proposedType,
      text: f.title,
      rationale: f.detail,
      breaksIf: f.breaksIf || f.detail,
      test: f.test || f.detail,
      constrains: f.constrains || f.detail,
      restsOn: f.restsOn || [],
      author: `council:${f.agentId}`,
      confidence: f.confidence || "low",
    });
  }
  renderClaims();
  renderDissent();
}

/* ---------- deliberation playback ----------
 *
 * The council reads as a list of filings unless you can watch it happen, so the
 * turns are revealed on a timer with the speaking seat lit on the bench. It is
 * a replay of a completed run, not a live one — every figure was computed
 * before the first word is spoken, which is the point.
 */

let delibTimer = null;
let delibDone = null;   /* the running playDeliberation's resolve */

/* Stopping a deliberation must also RELEASE whoever is awaiting it. The skip
 * button starts a second, instant playDeliberation whose first act is this
 * function — before this resolved the abandoned promise, that click left the
 * gate-to-gate run parked on the first promise forever. */
function stopDeliberation() {
  clearTimeout(delibTimer);
  delibTimer = null;
  if (delibDone) { const r = delibDone; delibDone = null; r(); }
  Bench.hush();
}

function playDeliberation({ instant = false } = {}) {
  stopDeliberation();
  const box = $("#delib");
  box.innerHTML = "";
  const turns = S.turns || [];
  if (!turns.length) {
    box.appendChild(el("p", "c-empty", "Convene the council first."));
    return Promise.resolve();
  }
  $("#delib-lamp").className = "pwin-lamp warn";
  $("#trace-lamp").className = "pwin-lamp warn";
  $("#delib-controls").classList.remove("c-hidden");
  Trace.rule("deliberation");

  const pace = Number($("#delib-pace").value) || 1700;
  return new Promise((resolve) => {
    delibDone = resolve;
    let i = 0;
    const step = () => {
      if (i >= turns.length) {
        $("#delib-lamp").className = "pwin-lamp on";
        $("#trace-lamp").className = "pwin-lamp on";
        $("#trace-count").textContent = `${Trace.lines().length} lines`;
        $("#delib-count").textContent = `${turns.length} turns`;
        Bench.hush();
        /* Settle the room. Leaving every seat reading "speaking" after the last
         * word makes the bench look stuck, and a seat that raised a blocker
         * should still show it — the state is the record of what it did. */
        for (const seat of Council.ROSTER) {
          const raised = S.findings.filter((f) => f.agentId === seat.id);
          const blocked = raised.some((f) => f.severity === "blocker");
          Bench.setState(seat.id, blocked ? "flagged" : "done",
            raised.length ? `${raised.length} finding${raised.length === 1 ? "" : "s"}` : "no findings");
        }
        appendRulings(box);
        delibDone = null;
        resolve();
        return;
      }
      const t = turns[i++];
      $("#delib-count").textContent = `${i}/${turns.length}`;

      if (instant) {
        emitThoughts(t);
        renderTurn(box, t);
        step();
        return;
      }

      Bench.say(t.agentId, t.text, t.kind);
      Bench.setState(t.agentId, t.kind === "challenge" ? "flagged" : "writing", t.kind === "challenge" ? "challenging" : "speaking");

      /* The seat works before it speaks: its reasoning streams into the console
       * line by line, and only then does the sentence land in the transcript.
       * Watching the working arrive is the point — a conclusion that appears
       * fully formed is exactly what this application argues against. */
      const think = t.think || [];
      const perThought = Math.max(160, Math.min(420, pace * 0.34));
      Trace.step(t.agentId, t.kind === "challenge" ? "challenging the previous claim" : "considering");
      let k = 0;
      const tick = () => {
        if (k < think.length) {
          const line = think[k++];
          Trace.line(t.agentId, /^result:|^found:|^therefore|^expect|^assigned|^no figure|^retention/.test(line) ? "result" : /\?|test|compare|scanned|searched/i.test(line) ? "test" : "detail", line, { indent: 1 });
          delibTimer = setTimeout(tick, perThought);
          return;
        }
        Trace.say(t.agentId, t.text);
        for (const c of t.cites || []) Trace.detail(t.agentId, `cites ${c.spanId}: "${c.quote.slice(0, 90)}…"`);
        renderTurn(box, t);
        box.scrollTop = box.scrollHeight;
        $("#trace-count").textContent = `${Trace.lines().length} lines`;
        // Longer lines get longer on screen; nobody can read 40 words in a second.
        const dwell = Math.min(pace * 2.2, pace * (0.55 + t.text.length / 260));
        delibTimer = setTimeout(step, dwell);
      };
      tick();
    };
    step();
  });
}

function emitThoughts(t) {
  Trace.step(t.agentId, t.kind === "challenge" ? "challenging the previous claim" : "considering");
  for (const line of t.think || []) Trace.detail(t.agentId, line);
  Trace.say(t.agentId, t.text);
  for (const c of t.cites || []) Trace.detail(t.agentId, `cites ${c.spanId}: "${c.quote.slice(0, 90)}…"`);
  $("#trace-count").textContent = `${Trace.lines().length} lines`;
}

function renderTurn(box, t) {
  const seat = Council.ROSTER.find((r) => r.id === t.agentId);
  const d = el("div", "c-turn");
  d.dataset.kind = t.kind || "speak";
  d.appendChild(el("div", "who", seat ? seat.seat : t.agentId));
  const what = el("div", "what");
  what.appendChild(el("span", null, t.text));
  for (const c of t.cites || []) {
    const q = el("div", "cite", `“${c.quote}”`);
    what.appendChild(q);
  }
  d.appendChild(what);
  box.appendChild(d);
}

/* After the room has spoken, show how each genuine dispute was settled — the
 * ladder, applied to the arguments that were actually made. */
function appendRulings(box) {
  const contested = (S.resolutions || []).filter((r) => r.contested);
  if (!contested.length) return;
  Trace.rule("resolution ladder");
  const seen = new Set();
  for (const r of contested) {
    if (r.outcome === "overturned") continue;
    // Both sides of one dispute produce a resolution with the same rationale;
    // dedupe before logging, or the console reports each ruling twice.
    const key = r.basis + r.rationale;
    if (seen.has(key)) continue;
    seen.add(key);
    Trace.line("the ladder", r.outcome === "escalated" ? "warn" : "result",
      `${r.outcome} on ${r.basis.replace(/_/g, " ")} — ${r.rationale.slice(0, 140)}`);
    const d = el("div", "c-turn c-ruling");
    d.appendChild(el("div", "who", "the ladder"));
    const what = el("div", "what");
    what.appendChild(el("span", null,
      r.outcome === "escalated"
        ? `Unresolved, and it stays that way. ${r.rationale}`
        : `Settled on ${r.basis.replace(/_/g, " ")}. ${r.rationale}`));
    what.appendChild(el("div", "cite", "No votes were counted. Agreement between seats is recorded as corroboration and never changes an outcome."));
    d.appendChild(what);
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}

/* ---------- autopilot ----------
 * One button, the whole run. Stages advance themselves and the page scrolls to
 * whatever is happening, so a first-time viewer never has to work out which tab
 * to click next. */

async function autopilot() {
  const btns = $$("#btn-auto, #btn-auto-top");
  if (btns.some((b) => b.disabled)) return;          // already running
  btns.forEach((b) => { b.disabled = true; });
  const banner = el("div", "c-auto");
  const label = el("span", "c-auto-step", "starting…");
  const bar = el("div", "c-auto-bar");
  const fill = el("i");
  bar.appendChild(fill);
  banner.appendChild(el("span", null, "▶ the case"));
  banner.appendChild(label);
  banner.appendChild(bar);
  const stop = el("button", "pbtn", "stop");
  stop.style.cssText = "padding:4px 10px;min-height:0";
  banner.appendChild(stop);
  document.body.appendChild(banner);

  let cancelled = false;
  stop.addEventListener("click", () => { cancelled = true; stopDeliberation(); cancelStop(); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (pctDone, text) => { fill.style.width = `${pctDone}%`; label.textContent = text; };

  try {
    if (!S.files.length) {
      at(6, "loading the sample case");
      stage("corpus");
      await loadDemo();
    }
    if (cancelled) return;

    at(24, "profiling the data contract");
    stage("contract");
    await wait(1400);
    if (cancelled) return;

    at(38, "waiting at gate 1 — the bundle is on your desk");
    await stopAtGate("data_contract");
    await wait(900);
    if (cancelled) return;

    at(52, "drafting the calculation definitions");
    stage("calc");
    await wait(1000);
    if (cancelled) return;

    at(62, "waiting at gate 2 — the bundle is on your desk");
    await stopAtGate("calc_definitions");
    if (cancelled) return;
    await wait(900);

    at(74, "convening the council");
    stage("council");
    await wait(600);
    await convene({ autoplay: false });
    if (cancelled) return;

    at(80, "deliberating");
    await playDeliberation();
    if (cancelled) return;

    at(94, "building the decision record");
    stage("report");
    await wait(1200);
    if (cancelled) return;

    at(97, "waiting at gate 4 — the decision is on your desk");
    await stopAtGate("final_recommendation");
    if (cancelled) return;

    at(100, "done — run complete");
    await wait(2200);
  } catch (e) {
    label.textContent = `stopped: ${e.message}`;
    await wait(3000);
  } finally {
    cancelStop();
    banner.remove();
    btns.forEach((b) => { b.disabled = false; });
  }
}

/* Load a sample case by id via the registry vp.js owns. No id means the
 * active case, and if the registry never loaded this resolves to the original
 * demo/manifest.json — so every existing caller keeps working. Manifest file
 * paths are relative to the manifest's own directory. */
async function loadDemo(caseId) {
  const rel = caseManifest(caseId);
  const base = `demo/${rel.slice(0, rel.lastIndexOf("/") + 1)}`;
  const manifest = await (await fetch(`demo/${rel}`)).json();
  const files = [];
  for (const f of manifest.files) {
    const r = await fetch(`${base}${f.path}`);
    if (!r.ok) throw new Error(`${base}${f.path} — ${r.status}`);
    files.push(new File([await r.blob()], f.path));
  }
  await ingestFiles(files);
}

/* ---------- claim ledger ---------- */

let claimFilter = "";

function renderClaims() {
  const box = $("#claims");
  const fbox = $("#claim-filters");
  if (!box) return;
  const all = Claims.ledger();
  $("#claim-count").textContent = String(all.length);

  fbox.innerHTML = "";
  const mk = (label, value, n) => {
    const b = el("button", `pbtn${claimFilter === value ? " on" : ""}`, `${label} ${n}`);
    b.style.cssText = "padding:4px 8px;min-height:0;font-size:12px";
    b.addEventListener("click", () => { claimFilter = claimFilter === value ? "" : value; renderClaims(); });
    return b;
  };
  fbox.appendChild(mk("all", "", all.length));
  for (const t of Claims.TYPES) {
    const n = all.filter((c) => c.type === t).length;
    if (n) fbox.appendChild(mk(Claims.TYPE_META[t].label.toLowerCase(), t, n));
  }

  const list = claimFilter ? all.filter((c) => c.type === claimFilter) : all;
  box.innerHTML = "";
  if (!list.length) { box.appendChild(el("p", "c-empty", "No claims of this type.")); return; }

  for (const c of list) {
    const d = el("div", `c-claim${c.status === "disputed" ? " disputed" : ""}`);
    d.dataset.t = c.type;
    const h = el("div", "hd");
    h.appendChild(el("span", `pchip ${Claims.TYPE_META[c.type].tone}`, Claims.TYPE_META[c.type].label));
    h.appendChild(el("span", "pchip", c.author.startsWith("council:") ? c.author : c.author));
    if (c.status !== "draft") h.appendChild(el("span", `pchip ${c.status === "approved" ? "ok" : c.status === "disputed" ? "warn" : "err"}`, c.status));
    d.appendChild(h);
    d.appendChild(el("div", "tx", c.text));

    if (c.calc) {
      const eng = el("div", `c-engines ${c.calc.reconciled ? "ok" : "bad"}`);
      const a = el("div", "eng"); a.appendChild(el("div", "lab", "SQL")); a.appendChild(el("div", null, String(round(c.calc.sqlValue))));
      const b = el("div", "eng"); b.appendChild(el("div", "lab", "reducer")); b.appendChild(el("div", null, String(round(c.calc.jsValue))));
      eng.appendChild(a); eng.appendChild(el("div", "vs", c.calc.reconciled ? "==" : "≠")); eng.appendChild(b);
      d.appendChild(eng);
    }
    if (c.breaksIf) d.appendChild(small(`Breaks if: ${c.breaksIf}`));
    if (c.test) d.appendChild(small(`Test: ${c.test}`));
    if (c.constrains) d.appendChild(small(`Constrains: ${c.constrains}`));

    for (const p of c.provenance || []) {
      const pv = el("div", "pv");
      pv.innerHTML =
        `<b>${U.escapeHtml(p.fileName)}</b> ${U.escapeHtml(locatorLabel(p.locator))}` +
        (p.transformation ? ` · ${U.escapeHtml(p.transformation)}` : "") +
        (p.period ? ` · ${U.escapeHtml(p.period)}` : "") +
        (p.unit ? ` · ${U.escapeHtml(p.unit)}` : "") +
        ` · sha ${U.escapeHtml(p.sha256.slice(0, 10))} · run ${U.escapeHtml(String(p.runId).slice(0, 10))}`;
      d.appendChild(pv);
    }
    box.appendChild(d);
  }
  refreshRunStrip();
}

function small(t) {
  const s = el("div", null, t);
  s.style.cssText = "font-size:12px;color:var(--pi-muted);margin-top:4px";
  return s;
}
function round(v) { return typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v; }

/* ---------- 06 · reproduce ---------- */

function renderReproduce() {
  const box = $("#reproduce");
  if (!box) return;
  const b = Report.bundle();
  $("#bundle-id").textContent = b.runId;
  box.innerHTML = "";
  const rows = [
    ["Run id", `${b.runId} — derived from file hashes, the approved contract, and the approved specs`],
    ["Files", b.files.map((f) => `${f.name} (${f.sha256.slice(0, 10)})`).join(", ") || "—"],
    ["Contract", b.contract ? `${b.contract.grain.join(" × ")} · ${b.contract.rowCount}→${b.contract.collapsedRowCount}` : "—"],
    ["Specs", `${b.specs.length} defined · ${b.results.filter((r) => r.reconciled).length} reconciled`],
    ["Claims", `${b.claims.length} typed · ${b.claims.filter((c) => c.status === "disputed").length} disputed`],
    ["Model", b.model ? `${b.model.provider} / ${b.model.model}` : "none — offline dry run"],
    ["Gates", Object.values(S.gates).map((g) => `${g.id}:${g.status}`).join(" · ")],
  ];
  for (const [k, v] of rows) box.appendChild(kv(k, v));
}

/* ---------- wiring ---------- */

function init() {
  Bench.mount($("#bench"), Council.ROSTER);
  Trace.mount($("#trace"));
  EmbedView.mount($("#embed"));
  Trace.rule("session");
  Trace.step("council", "engines idle — load a case, or press Take the case");
  Report.init({ gates: Object.values(S.gates) });
  Claims.setRun(Report.computeRunId());
  renderReproduce();
  initVP({
    approveGate, getState: () => S, stage,
    loadCase: async (caseId) => {
      try { await loadDemo(caseId); }
      catch (e) { toast(`Could not load the sample case: ${e.message}`, "err"); }
    },
  });

  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => {
    ev.preventDefault(); drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, (ev) => {
    ev.preventDefault(); drop.classList.remove("over");
  }));
  drop.addEventListener("drop", async (ev) => {
    if (ev.dataTransfer && ev.dataTransfer.files.length) {
      await ingestFiles([...ev.dataTransfer.files]);
      if (S.files.length && (S.tables.length || S.spans.length)) caseCardToOwn();
    }
  });

  $("#btn-pick").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", async (e) => {
    const picked = e.target.files.length ? [...e.target.files] : [];
    e.target.value = "";
    if (picked.length) {
      await ingestFiles(picked);
      if (S.files.length && (S.tables.length || S.spans.length)) caseCardToOwn();
    }
  });

  /* The sample-case chooser is rendered into #case-chooser by vp.js from the
   * case registry; it calls back into loadDemo through the loadCase dep. */

  $$("#btn-auto, #btn-auto-top").forEach((b) => b.addEventListener("click", autopilot));
  $("#btn-trace-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(Trace.toText()); toast("Console copied.", "ok"); }
    catch { U.download(`council-console.txt`, "text/plain", Trace.toText()); }
  });
  $("#btn-delib").addEventListener("click", () => playDeliberation());
  $("#btn-delib-skip").addEventListener("click", () => playDeliberation({ instant: true }));

  $("#btn-search").addEventListener("click", runSearch);
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  /* Arriving at the council with the gates cleared and nothing convened is a
   * dead end the reader has to guess their way out of — so convene on arrival. */
  $$(".c-step").forEach((b) => b.addEventListener("click", async () => {
    stage(b.dataset.stage);
    if (b.dataset.stage === "council"
        && S.gates.calc_definitions.status === "approved"
        && !S.findings.length) {
      await convene();
    }
  }));
  $$("[data-approve]").forEach((b) => b.addEventListener("click", () => approveGate(b.dataset.approve)));
  $$("[data-changes]").forEach((b) => b.addEventListener("click", () => {
    setGate(b.dataset.changes, "changes_requested", "Operator asked for changes.");
    toast("Recorded. Downstream stays locked.", "");
  }));

  $("#btn-approve-all").addEventListener("click", () => {
    S.specs.forEach((s) => { s.approved = true; });
    renderSpecs();
    toast(`${S.specs.length} definitions marked approved — clear gate 2 to execute them.`);
  });
  $("#btn-run-specs").addEventListener("click", () => {
    if (S.gates.calc_definitions.status !== "approved") return toast("Gate 2 has to clear before anything executes.", "err");
    runAllSpecs();
  });
  $("#btn-convene").addEventListener("click", () => convene());
  $("#sev-filter").addEventListener("change", renderFindings);

  $("#btn-export").addEventListener("click", () => { Report.exportBundle(); toast("Bundle exported.", "ok"); });
  $("#btn-export-md").addEventListener("click", () => Report.exportMarkdown());
  $("#btn-export-svg").addEventListener("click", () => Report.exportCharts());
  $("#btn-replay").addEventListener("click", () => $("#replay-input").click());
  $("#replay-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const b = JSON.parse(await f.text());
      await Report.replay(b, { charts: $("#charts") });
      S.findings = b.findings || [];
      S.resolutions = b.resolutions || [];
      renderClaims(); renderFindings(); renderLadder(); renderReproduce();
      stage("report");
      toast(`Replayed run ${b.runId} from the bundle alone — no source files needed.`, "ok");
    } catch (err) {
      toast(`Not a readable run bundle: ${err.message}`, "err");
    }
    e.target.value = "";
  });

  $("#btn-verify").addEventListener("click", async () => {
    const b = Report.bundle();
    if (!b.specs.length) return toast("Nothing to verify yet.", "err");
    const v = await Report.verify(b);
    toast(v.ok
      ? `All ${v.checked} calculations re-executed and matched.`
      : `${v.failures.length} of ${v.checked} did not reproduce: ${v.failures[0]}`, v.ok ? "ok" : "err");
  });

  const dlg = $("#settings");
  $("#btn-settings").addEventListener("click", () => dlg.showModal());
  $("#cfg-provider").addEventListener("change", (e) => {
    $("#cfg-model").value = e.target.value === "anthropic" ? "claude-sonnet-5" : "gpt-4o-mini";
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "save") return;
    const key = $("#cfg-key").value.trim();
    if (!key) return;
    const cfg = { provider: $("#cfg-provider").value, model: $("#cfg-model").value.trim(), apiKey: key };
    Council.configure(cfg);
    S.model = { provider: cfg.provider, model: cfg.model };
    Report.set("model", S.model);
    $("#cfg-key").value = "";
    $("#dry-chip").textContent = `${cfg.provider} · ${cfg.model}`;
    $("#dry-chip").className = "pchip acc";
    toast("Model configured. The key stays in memory for this tab only.", "ok");
  });

  stage("corpus");
}

function runSearch() {
  const q = $("#q").value.trim();
  const box = $("#hits");
  box.innerHTML = "";
  if (!q) return;
  if (!S.index) { box.appendChild(el("p", "c-empty", "Nothing indexed yet.")); return; }

  /* Take the question apart in the open. Anyone can check the arithmetic:
   * the tokens are the recipe's tokens, the destination dimension is
   * fnv1a32(term) % 512, and the weight is (1 + log tf) × idf from this
   * corpus. There is no step here you have to trust. */
  const ex = EmbedView.explain(S.index, q);
  $("#qexplain").classList.remove("c-hidden");
  Trace.rule("query");
  Trace.step("retrieval", `embedding the question: "${q}"`);
  Trace.detail("retrieval", `normalised → "${ex.normalized}"`);
  Trace.detail("retrieval", `${ex.tokenCount} tokens, ${ex.uniqueTerms} distinct (${ex.unseen} unseen in this corpus)`);
  Trace.detail("retrieval", `hashed into ${ex.nonZero} of ${ex.dim} dimensions, then L2 normalised`);

  $("#qmeta").innerHTML =
    `normalised: <b>${U.escapeHtml(ex.normalized.slice(0, 120))}</b> · ` +
    `${ex.tokenCount} tokens → <b>${ex.uniqueTerms}</b> distinct → ` +
    `<b>${ex.nonZero}</b>/${ex.dim} dimensions occupied` +
    (ex.unseen ? ` · <b>${ex.unseen}</b> term(s) unseen in this corpus` : "");

  EmbedView.renderQueryStrip($("#qstrip"), ex.vec);

  const tb = $("#qterms");
  tb.innerHTML = "";
  for (const t of ex.terms.slice(0, 40)) {
    const tr = el("tr");
    if (!t.df) tr.className = "unseen";
    tr.appendChild(el("td", "tok", t.term));
    tr.appendChild(el("td", null, t.kind));
    tr.appendChild(el("td", null, String(t.tf)));
    tr.appendChild(el("td", null, String(t.df)));
    tr.appendChild(el("td", null, t.idf.toFixed(2)));
    tr.appendChild(el("td", null, String(t.dim)));
    tr.appendChild(el("td", t.sign > 0 ? "pos" : "neg", t.sign > 0 ? "+" : "−"));
    tr.appendChild(el("td", null, t.weight.toFixed(3)));
    tb.appendChild(tr);
  }

  const hits = Vectorizer.search(S.index, q, { k: 6 });
  EmbedView.setHighlight(hits.map((h) => h.spanId));
  if (!hits.length) {
    box.appendChild(el("p", "c-empty", "No span in the corpus shares a term or a direction with that question."));
    Trace.warn("retrieval", "no candidate spans");
    return;
  }
  Trace.detail("retrieval", `scored ${hits.length} candidate span(s): score = 0.6·cosine + 0.4·bm25(min-max)`);

  for (const h of hits) {
    Trace.result("retrieval", `${h.score.toFixed(3)}  cos ${h.dense.toFixed(3)}  bm25 ${h.lexical.toFixed(2)}  ${locatorLabel(h.span.locator)}`);
    const d = el("div");
    d.style.cssText = "border:1.5px solid var(--pi-line);padding:7px 9px;margin-bottom:6px;font-size:13px";
    const m = el("div");
    m.style.cssText = "font-family:var(--pi-font-code);font-size:12px;color:var(--pi-muted)";
    m.textContent = `${locatorLabel(h.span.locator)} · score ${h.score.toFixed(3)} = 0.6×cos ${h.dense.toFixed(3)} + 0.4×bm25ₙ ${h.lexicalNorm.toFixed(3)}`;
    d.appendChild(m);
    d.appendChild(el("div", null, h.span.text.slice(0, 260)));
    if (h.span.injection) {
      const w = el("div", null, `⚠ sentinel: ${h.span.injection.pattern}`);
      w.style.cssText = "color:var(--pi-err);font-size:12px;margin-top:4px";
      d.appendChild(w);
    }
    box.appendChild(d);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
