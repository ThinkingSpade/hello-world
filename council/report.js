/* report.js — the run bundle.
 *
 * A run bundle is the deliverable. It holds every decision, every executed
 * statement, every figure and every chart specification, so the analysis can be
 * replayed later by someone who was not there — and re-executed against the
 * original files to prove the figures still hold.
 *
 * Two different guarantees, deliberately separated:
 *
 *   replay()  re-renders everything from the bundle alone. No source files.
 *             Answers "what did this run say?"
 *   verify()  re-executes every calculation against the original files and
 *             compares. Answers "is it still true?"
 *
 * The bundle stores file hashes, never file contents. A run bundle is safe to
 * email; the underlying data is not, and this keeps the two apart.
 *
 * See CONTRACT.md §10.
 */
import { U } from "./util.js";
import { Calc } from "./calc.js";
import { Claims } from "./claims.js";
import { Viz } from "./viz.js";

const SCHEMA = "council.run/1";

let state = {
  runId: "", createdAt: "",
  engine: { app: "council/1", vectorizer: "", sqlite: "sql.js" },
  model: null,
  files: [], contract: null, specs: [], results: [],
  findings: [], resolutions: [], gates: [], charts: [], transcript: [],
};

export const Report = {
  init(partial) { state = { ...state, ...partial }; },
  state() { return state; },

  set(key, value) { state[key] = value; return state[key]; },
  push(key, value) { (state[key] = state[key] || []).push(value); return value; },

  /* The run id is a function of the inputs and the decisions, never of the
   * clock. Two runs over the same corpus with the same contract and the same
   * specs produce the same id — which is what makes "reproducible" checkable
   * rather than aspirational. */
  computeRunId() {
    const corpus = state.files.map((f) => `${f.name}:${f.sha256}`).sort().join("|");
    const specs = state.specs.map((s) => `${s.name}:${s.sql}:${s.reducer}`).sort().join("|");
    return U.stableId("run", corpus, state.contract ? state.contract.contractId : "-", specs);
  },

  bundle() {
    const runId = state.runId || Report.computeRunId();
    return {
      schema: SCHEMA,
      runId,
      createdAt: state.createdAt || new Date().toISOString(),
      engine: { ...state.engine },
      model: state.model ? { provider: state.model.provider, model: state.model.model } : null,
      files: state.files.map((f) => ({
        fileId: f.fileId, name: f.name, kind: f.kind, bytes: f.bytes,
        sha256: f.sha256, warnings: f.warnings || [],
      })),
      contract: state.contract,
      specs: state.specs.map((s) => ({ ...s })),
      results: state.results.map((r) => ({ ...r, rows: undefined })),
      claims: Claims.ledger(),
      findings: state.findings,
      resolutions: state.resolutions,
      gates: state.gates,
      charts: state.charts.map((c) => ({ spec: c.spec, rows: c.rows })),
      transcript: state.transcript,
    };
  },

  /* Re-render a bundle with no source files present. Charts come back because
   * their rows travel with the spec; figures come back because they are stored
   * alongside the statement that produced them. */
  async replay(bundle, mounts = {}) {
    if (!bundle || bundle.schema !== SCHEMA) throw new Error("Not a council run bundle.");
    Claims.reset();
    Claims.setRun(bundle.runId);
    Claims.load(bundle.claims || []);
    state = {
      ...state,
      runId: bundle.runId, createdAt: bundle.createdAt,
      engine: bundle.engine, model: bundle.model,
      files: bundle.files, contract: bundle.contract,
      specs: bundle.specs, results: bundle.results,
      findings: bundle.findings || [], resolutions: bundle.resolutions || [],
      gates: bundle.gates || [], charts: bundle.charts || [],
      transcript: bundle.transcript || [],
    };
    if (mounts.charts) {
      mounts.charts.innerHTML = "";
      for (const c of state.charts) {
        const box = document.createElement("div");
        mounts.charts.appendChild(box);
        try { Viz.render(box, c.spec, c.rows); }
        catch (e) { box.textContent = `Chart "${c.spec && c.spec.title}" could not be re-rendered: ${e.message}`; }
      }
    }
    return state;
  },

  /* The reproducibility proof. Needs the original files loaded into Calc.
   * Re-executes each stored spec and compares against the stored figure. */
  async verify(bundle) {
    const failures = [];
    for (const spec of bundle.specs || []) {
      const stored = (bundle.results || []).find((r) => r.specId === spec.specId);
      if (!stored) { failures.push(`${spec.name}: no stored result to compare against.`); continue; }
      let fresh;
      try {
        fresh = await Calc.run({ ...spec, approved: true }, { requireApproval: false });
      } catch (e) {
        failures.push(`${spec.name}: re-execution threw — ${e.message}`);
        continue;
      }
      if (fresh.error) { failures.push(`${spec.name}: ${fresh.error}`); continue; }
      if (!fresh.reconciled) { failures.push(`${spec.name}: engines no longer reconcile.`); continue; }
      // A measure that was undefined before and is undefined now has reproduced.
      if (stored.sqlValue === null && fresh.sqlValue === null) continue;
      if (stored.sqlValue === null || fresh.sqlValue === null) {
        failures.push(`${spec.name}: was ${stored.sqlValue === null ? "undefined" : "defined"} and is now ${fresh.sqlValue === null ? "undefined" : "defined"}.`);
        continue;
      }
      if (!U.closeTo(stored.sqlValue, fresh.sqlValue, spec.tolerance || 1e-9)) {
        failures.push(`${spec.name}: stored ${stored.sqlValue}, recomputed ${fresh.sqlValue}.`);
      }
    }
    return { ok: failures.length === 0, failures, checked: (bundle.specs || []).length };
  },

  /* ---------- exports ---------- */

  toMarkdown(bundle) {
    const L = [];
    const claims = bundle.claims || [];
    const byType = (t) => claims.filter((c) => c.type === t);

    L.push(`# Analysis run \`${bundle.runId}\``, "");
    L.push(`Generated ${bundle.createdAt}. Engine ${bundle.engine.app}, vectorizer ${bundle.engine.vectorizer || "n/a"}.`);
    L.push(bundle.model
      ? `Council seats ran on ${bundle.model.provider} / ${bundle.model.model}.`
      : `Council ran in offline dry-run mode — no model was consulted.`);
    L.push("", "## Sources", "");
    L.push("| File | Kind | Bytes | SHA-256 |", "|---|---|---|---|");
    for (const f of bundle.files) L.push(`| ${f.name} | ${f.kind} | ${f.bytes} | \`${f.sha256.slice(0, 16)}…\` |`);

    if (bundle.contract) {
      const c = bundle.contract;
      L.push("", "## Data contract", "");
      L.push(`- **Grain**: ${c.grain.join(" × ")} — ${c.grainIsUnique ? "unique" : "**not unique in the source**"}`);
      if (c.splitRowGroups && c.splitRowGroups.length) {
        L.push(`- **Split rows**: ${c.splitRowGroups.length} grain keys appear more than once with differing non-key attributes (${c.rowCount} source rows → ${c.collapsedRowCount} keys).`);
      }
      if (c.duplicateKeys && c.duplicateKeys.length) {
        L.push(`- **True duplicates**: ${c.duplicateKeys.length} keys repeat with identical attributes.`);
      }
      for (const m of c.measures || []) L.push(`- **${m.col}** treated as *${m.role}* — ${m.rationale}`);
      for (const p of c.incompletePeriods || []) L.push(`- **Incomplete period ${p.period}** — ${p.reason}`);
    }

    const sections = [
      ["calculated", "Calculated figures"],
      ["observed", "Observed facts"],
      ["analytical_assumption", "Analytical assumptions"],
      ["hypothesis", "Hypotheses"],
      ["limitation", "Limitations"],
      ["external_context", "External context"],
      ["recommendation", "Recommendation"],
    ];
    for (const [t, title] of sections) {
      const rows = byType(t);
      if (!rows.length) continue;
      L.push("", `## ${title}`, "");
      for (const c of rows) {
        const flag = c.status === "disputed" ? " **[disputed]**" : "";
        L.push(`- ${c.text}${flag}`);
        if (c.calc) {
          L.push(`  - SQL \`${c.calc.specId}\` returned \`${c.calc.sqlValue}\`; independent reducer returned \`${c.calc.jsValue}\` — ${c.calc.reconciled ? "reconciled" : "**NOT RECONCILED**"}.`);
        }
        for (const p of c.provenance || []) {
          L.push(`  - Source: ${p.fileName}${locatorText(p.locator)}${p.transformation ? ` · ${p.transformation}` : ""}${p.period ? ` · ${p.period}` : ""}`);
        }
        if (c.breaksIf) L.push(`  - Breaks if: ${c.breaksIf}`);
        if (c.test) L.push(`  - Test: ${c.test}`);
        if (c.constrains) L.push(`  - Constrains: ${c.constrains}`);
        if (c.external) L.push(`  - External: ${c.external.url} (retrieved ${c.external.retrievedAt})${c.external.approved ? "" : " — **NOT APPROVED, excluded from conclusions**"}`);
        for (const d of c.dissent || []) L.push(`  - Dissent (${d.agentId}): ${d.position} — ${d.rationale}`);
      }
    }

    const esc = (bundle.resolutions || []).filter((r) => r.outcome === "escalated");
    if (esc.length) {
      L.push("", "## Unresolved — escalated to human judgment", "");
      for (const r of esc) L.push(`- ${r.rationale}`);
    }

    L.push("", "## Approval gates", "");
    for (const g of bundle.gates || []) {
      L.push(`- **${g.id}** — ${g.status}${g.approvedBy ? ` by ${g.approvedBy} at ${g.approvedAt}` : ""}${g.notes ? ` · ${g.notes}` : ""}`);
    }
    L.push("", "---", "", `Reproduce: load this bundle and run \`Report.verify\` against the original sources. Run id \`${bundle.runId}\` is derived from the file hashes, the approved data contract and the approved calculation specifications — if any of those change, the id changes.`);
    return L.join("\n");
  },

  toHtml(bundle) {
    const md = Report.toMarkdown(bundle);
    const body = U.escapeHtml(md)
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^- /gm, "• ");
    return `<!doctype html><meta charset="utf-8"><title>Run ${U.escapeHtml(bundle.runId)}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:52rem;margin:3rem auto;padding:0 1.5rem;color:#14120e;background:#fff}
h1{font-size:1.5rem}h2{font-size:1.05rem;margin-top:2rem;border-bottom:2px solid #14120e;padding-bottom:.3rem}
code{background:#f6f6f4;padding:.1em .35em;font-size:.9em}pre{white-space:pre-wrap}</style><pre>${body}</pre>`;
  },

  exportBundle() {
    const b = Report.bundle();
    U.download(`council-run-${b.runId}.json`, "application/json", JSON.stringify(b, null, 2));
    return b;
  },

  exportMarkdown() {
    const b = Report.bundle();
    U.download(`council-run-${b.runId}.md`, "text/markdown", Report.toMarkdown(b));
  },

  /* Charts travel as SVG too, so the export is readable without this app. */
  exportCharts() {
    const b = Report.bundle();
    const parts = b.charts.map((c) => {
      try { return `<!-- ${c.spec.title} -->\n${Viz.toSvgString(c.spec, c.rows)}`; }
      catch (e) { return `<!-- ${c.spec.title}: ${e.message} -->`; }
    });
    U.download(`council-charts-${b.runId}.html`, "text/html",
      `<!doctype html><meta charset="utf-8"><title>Charts ${b.runId}</title>
<style>body{background:#fff;font:14px system-ui;margin:2rem}svg{max-width:100%;margin-bottom:2.5rem}</style>
${parts.join("\n")}`);
  },
};

function locatorText(loc) {
  if (!loc) return "";
  const bits = [];
  if (loc.sheet) bits.push(`sheet ${loc.sheet}`);
  if (loc.page) bits.push(`page ${loc.page}`);
  if (loc.slide) bits.push(`slide ${loc.slide}`);
  if (loc.para !== undefined && loc.para >= 0) bits.push(`para ${loc.para}`);
  if (loc.row) bits.push(`row ${loc.row}`);
  if (loc.col) bits.push(`col ${loc.col}`);
  if (loc.range) bits.push(loc.range);
  return bits.length ? ` (${bits.join(", ")})` : "";
}
