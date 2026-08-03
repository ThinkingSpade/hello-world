/* claims.js — the typed claim ledger.
 *
 * Every material statement in the final output is a row in here, and every row
 * carries a type. The types are not decoration; they are the difference between
 * "the data says" and "I think", and collapsing that difference is how analyses
 * quietly become fiction.
 *
 *   observed              a fact read off a source file
 *   calculated            a figure two engines independently reproduced
 *   analytical_assumption a choice we made that could have gone another way
 *   hypothesis            a candidate explanation with a named test
 *   external_context      something from outside the case, human-approved
 *   limitation            a question this data cannot answer
 *   recommendation        an action, resting on named claims
 *
 * validate() is strict on purpose. A claim that cannot state where it came from
 * does not get to be evidence.
 *
 * See CONTRACT.md §6.
 */
import { U } from "./util.js";

const TYPES = [
  "observed", "calculated", "analytical_assumption", "hypothesis",
  "external_context", "limitation", "recommendation",
];

const TYPE_META = {
  observed:              { label: "Observed",   blurb: "Read directly off a source file.", tone: "ok" },
  calculated:            { label: "Calculated", blurb: "Computed by SQL and reproduced by an independent reducer.", tone: "ok" },
  analytical_assumption: { label: "Assumption", blurb: "A choice we made. States what breaks if it is wrong.", tone: "warn" },
  hypothesis:            { label: "Hypothesis", blurb: "A candidate explanation. States the test that would settle it.", tone: "warn" },
  external_context:      { label: "External",   blurb: "From outside the case. Quarantined until a human approves it.", tone: "acc" },
  limitation:            { label: "Limitation", blurb: "Something this data cannot answer. Names the decision it constrains.", tone: "err" },
  recommendation:        { label: "Recommendation", blurb: "An action. Must rest on named observed or calculated claims.", tone: "acc" },
};

let ledger = [];
let runId = "";

function provenanceComplete(p) {
  const missing = [];
  if (!p) return ["provenance entry is empty"];
  if (!p.fileId) missing.push("fileId");
  if (!p.fileName) missing.push("fileName");
  if (!p.sha256) missing.push("sha256");
  if (!p.locator || !Object.keys(p.locator).length) missing.push("locator");
  return missing.map((m) => `provenance is missing ${m}`);
}

export const Claims = {
  TYPES, TYPE_META,

  setRun(id) { runId = id; },
  reset() { ledger = []; },

  validate(claim) {
    const e = [];
    if (!claim || typeof claim !== "object") return ["claim is not an object"];
    if (!TYPES.includes(claim.type)) e.push(`unknown claim type "${claim.type}"`);
    if (!claim.text || !String(claim.text).trim()) e.push("claim has no text");

    const needsProvenance = claim.type === "observed" || claim.type === "calculated";
    if (needsProvenance) {
      if (!Array.isArray(claim.provenance) || claim.provenance.length === 0) {
        e.push(`a ${claim.type} claim must carry at least one provenance record`);
      } else {
        claim.provenance.forEach((p, i) => provenanceComplete(p).forEach((m) => e.push(`provenance[${i}]: ${m}`)));
      }
    }

    switch (claim.type) {
      case "observed":
        // A model can read a file, but what it reports is testimony, not the file.
        if (claim.author && claim.author.startsWith("council:")) {
          e.push("an observed claim cannot be authored by a council seat — model output is not evidence");
        }
        break;

      case "calculated":
        if (!claim.calc) e.push("a calculated claim must reference the calculation that produced it");
        else {
          if (!claim.calc.specId) e.push("calc.specId is missing");
          if (!claim.calc.sql) e.push("calc.sql is missing — the executed statement is part of the provenance");
          if (claim.calc.reconciled !== true) {
            e.push("calc.reconciled is not true — SQL and the independent reducer did not agree, so this figure cannot be promoted");
          }
        }
        if (claim.author && claim.author.startsWith("council:")) {
          e.push("a calculated claim cannot be authored by a council seat — models propose specifications, engines produce figures");
        }
        break;

      case "analytical_assumption":
        if (!claim.rationale || !String(claim.rationale).trim()) e.push("an assumption must record its rationale");
        if (!claim.breaksIf || !String(claim.breaksIf).trim()) {
          e.push("an assumption must name what breaks if it is wrong");
        }
        break;

      case "hypothesis":
        if (!claim.test || !String(claim.test).trim()) {
          e.push("a hypothesis must name the test that would confirm or kill it");
        }
        break;

      case "external_context":
        if (!claim.external) e.push("external_context requires an external record");
        else {
          if (!claim.external.url) e.push("external.url is missing");
          if (!claim.external.retrievedAt) e.push("external.retrievedAt is missing");
          if (!claim.external.quote && !claim.external.paraphrase) {
            e.push("external evidence needs either a quote or a paraphrase on file");
          }
        }
        break;

      case "limitation":
        if (!claim.constrains || !String(claim.constrains).trim()) {
          e.push("a limitation must name the decision it constrains — an unattached caveat changes nothing");
        }
        break;

      case "recommendation": {
        const refs = claim.restsOn || [];
        if (!refs.length) e.push("a recommendation must reference at least one supporting claim");
        else {
          const ok = refs.some((id) => {
            const c = ledger.find((x) => x.claimId === id);
            return c && (c.type === "observed" || c.type === "calculated");
          });
          if (!ok) e.push("a recommendation must rest on at least one observed or calculated claim");
        }
        break;
      }
    }
    return e;
  },

  add(claim) {
    const c = {
      claimId: "",
      runId: claim.runId || runId,
      type: claim.type,
      text: String(claim.text || "").trim(),
      value: claim.value,
      unit: claim.unit,
      period: claim.period || null,
      provenance: claim.provenance || [],
      calc: claim.calc || null,
      external: claim.external || null,
      rationale: claim.rationale || "",
      breaksIf: claim.breaksIf || "",
      test: claim.test || "",
      constrains: claim.constrains || "",
      restsOn: claim.restsOn || [],
      author: claim.author || "deterministic",
      confidence: claim.confidence || "medium",
      status: claim.status || "draft",
      dissent: claim.dissent || [],
      supersedes: claim.supersedes || undefined,
      tags: claim.tags || [],
    };
    c.claimId = U.stableId("claim", c.type, c.text, String(c.value ?? ""), c.author);

    const errors = Claims.validate(c);
    if (errors.length) {
      const err = new Error(`Claim rejected (${c.type}): ${errors.join("; ")}`);
      err.violations = errors;
      err.claim = c;
      throw err;
    }

    const existing = ledger.findIndex((x) => x.claimId === c.claimId);
    if (existing >= 0) ledger[existing] = c; else ledger.push(c);
    return c;
  },

  /* Add without throwing — returns {claim} or {errors}. The UI uses this so a
   * malformed model proposal surfaces as a visible rejection rather than an
   * exception that eats the rest of the batch. */
  tryAdd(claim) {
    try { return { claim: Claims.add(claim), errors: [] }; }
    catch (e) { return { claim: null, errors: e.violations || [e.message] }; }
  },

  get(id) { return ledger.find((c) => c.claimId === id) || null; },
  byType(type) { return ledger.filter((c) => c.type === type); },
  ledger() { return [...ledger]; },

  promote(claimId, approver) {
    const c = Claims.get(claimId);
    if (!c) throw new Error(`No such claim: ${claimId}`);
    if (c.type === "external_context") {
      if (!c.external || c.external.approved !== true) {
        throw new Error("External evidence must clear Gate 3 before it can be promoted into an output.");
      }
    }
    c.status = "approved";
    c.approvedBy = approver;
    return c;
  },

  reject(claimId, approver, why) {
    const c = Claims.get(claimId);
    if (!c) throw new Error(`No such claim: ${claimId}`);
    c.status = "rejected";
    c.approvedBy = approver;
    c.rejectionReason = why || "";
    return c;
  },

  /* Dissent is recorded on the claim and never resolved by counting. A claim
   * with recorded dissent stays visibly disputed all the way into the export. */
  dispute(claimId, agentId, position, rationale) {
    const c = Claims.get(claimId);
    if (!c) throw new Error(`No such claim: ${claimId}`);
    c.dissent.push({ agentId, position, rationale });
    c.status = "disputed";
    return c;
  },

  clearDissent(claimId, agentId) {
    const c = Claims.get(claimId);
    if (!c) return null;
    c.dissent = c.dissent.filter((d) => d.agentId !== agentId);
    if (!c.dissent.length && c.status === "disputed") c.status = "draft";
    return c;
  },

  /* What may legitimately appear in a leadership-facing output. */
  publishable() {
    return ledger.filter((c) => {
      if (c.status === "rejected") return false;
      if (c.type === "external_context") return c.external && c.external.approved === true;
      if (c.type === "calculated") return c.calc && c.calc.reconciled === true;
      return true;
    });
  },

  summary() {
    const s = { total: ledger.length, disputed: 0, approved: 0, unreconciled: 0, quarantined: 0 };
    for (const t of TYPES) s[t] = 0;
    for (const c of ledger) {
      s[c.type]++;
      if (c.status === "disputed") s.disputed++;
      if (c.status === "approved") s.approved++;
      if (c.type === "calculated" && !(c.calc && c.calc.reconciled)) s.unreconciled++;
      if (c.type === "external_context" && !(c.external && c.external.approved)) s.quarantined++;
    }
    return s;
  },

  load(claims) { ledger = claims.map((c) => ({ ...c })); },
};
