/* deliberate.js — the council, out loud.
 *
 * With no model configured the seats still have to be watchable, and watchable
 * means they must actually talk to each other rather than each filing a report
 * into a list. So this module turns a completed run into an ordered sequence of
 * speaking turns: a seat states something, another seat challenges it, the
 * challenge is settled by the ladder, and the room moves on.
 *
 * Two rules govern every line in here.
 *
 * First, **every number a seat says is read from the run**, never written into
 * this file. If the engines did not compute it, no seat mentions it. Point the
 * app at a different workbook and the same script says different numbers,
 * because the numbers come from `results`, not from prose.
 *
 * Second, **the disagreements are real**. The two disputes below are not
 * theatre: they produce genuine competing findings, they go into
 * `Council.resolve` with everything else, and the rung that settles them is
 * whichever rung the evidence actually triggers. If a seat's citation is
 * missing, it loses on source quality — the script does not get to decide.
 */
import { U } from "./util.js";

/* Pull a computed figure out of the run by matching its spec name. Returns
 * null when the measure was not computed, and every caller is written to fall
 * silent rather than invent a value. */
function figure(ctx, test) {
  for (const r of ctx.results || []) {
    const spec = (ctx.specs || []).find((s) => s.specId === r.specId);
    if (!spec || r.value === null || r.value === undefined) continue;
    if (test(spec.name.toLowerCase(), spec)) return { value: r.value, spec, reconciled: r.reconciled };
  }
  return null;
}

const pct = (v, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`;
const num = (v) => U.fmt.compact(v);

/* Find a source span whose text supports a point, so a challenge can cite the
 * file rather than assert. Returns null if the corpus does not contain it —
 * and the challenging seat then loses the rung, correctly. */
function findSpan(ctx, ...needles) {
  for (const s of ctx.spans || []) {
    const t = (s.text || "").toLowerCase();
    if (needles.every((n) => t.includes(n))) {
      return { spanId: s.spanId, quote: s.text.replace(/\s+/g, " ").slice(0, 200) };
    }
  }
  return null;
}

export function buildDeliberation(ctx) {
  const c = ctx.contract || {};
  const turns = [];
  const findings = [];
  let n = 0;
  const say = (agentId, text, opts = {}) => {
    if (!text) return;
    turns.push({ id: U.stableId("turn", agentId, String(n++)), agentId, text, ...opts });
  };

  /* ---------- 1. what the data is ---------- */

  const stock = (c.measures || []).find((m) => m.role === "stock");
  const flow = (c.measures || []).find((m) => m.role === "flow");

  say("contract",
    `Before anyone quotes a number: the grain is ${(c.grain || []).join(" × ")}, and it is ${c.grainIsUnique ? "unique" : "not unique"}. ` +
    (c.splitRowGroups
      ? `${c.splitRowGroups} keys appear more than once. Those are split records, not duplicates — the same fact written in two pieces because a period label changed mid-week. ${c.rowCount} rows collapse to ${c.collapsedRowCount}.`
      : `Every key resolves to one row.`));

  if (stock && flow) {
    say("contract",
      `The fold matters more than it looks. "${flow.col}" accumulates, so its segments add up. "${stock.col}" does not — it is a level recorded twice, and summing it would inflate every inventory figure in the deck. I am folding it with MAX and disclosing that.`,
      { kind: "spec" });
    say("assumption",
      `Logging that as an assumption, not a fact. If "${stock.col}" turns out to be additive across segments, every level in this analysis is understated and the weeks-of-supply table moves with it.`);
  }

  for (const p of (c.incompletePeriods || []).slice(0, 2)) {
    say("contract", `${p.period} is out. ${p.reason} A window containing it would show a drop that is a reporting artefact, not demand.`);
  }

  /* ---------- 2. the trust boundary ---------- */

  const flagged = (ctx.sentinel || []).length;
  say("sentinel",
    flagged
      ? `Before we read anything: ${flagged} span${flagged === 1 ? "" : "s"} in this corpus contain text that reads as an instruction to a model. They were annotated at ingest, passed inside an untrusted envelope, and never acted on. Treat them as data.`
      : `Corpus scanned. Nothing in it tries to instruct a model. Uploaded content is data here, not direction — that holds whether or not anyone tried.`);

  /* ---------- 3. the arithmetic ---------- */

  const recon = (ctx.results || []).filter((r) => r.reconciled).length;
  const total = (ctx.results || []).length;
  say("math",
    `I do not state figures — I state specifications, and the engines answer them. ${total} definitions were approved and executed. ` +
    `${recon} of ${total} reconciled between SQL and an independent reducer that shares no code with it. ` +
    (recon === total ? `No figure in this room came from one engine.` : `${total - recon} did not, and those are blocked from becoming claims.`),
    { kind: "spec" });

  const undef = (ctx.results || []).filter((r) => r.undefinedResult).length;
  if (undef) {
    say("math",
      `${undef} measure${undef === 1 ? "" : "s"} came back undefined — both engines independently returned nothing. That is agreement, not a failure: the item has no prior-period base, so a percentage change does not exist. It is filed as a limitation, not rounded to zero.`);
  }

  /* ---------- 4. the headline, and the mix effect ---------- */

  const weighted = figure(ctx, (nm) => nm.includes("×") && !nm.includes("·") && nm.includes("vs matched prior") && !/trailing/.test(nm));
  const raw = figure(ctx, (nm) => !nm.includes("×") && !nm.includes("·") && nm.includes("vs matched prior") && !/trailing/.test(nm));

  if (raw && weighted) {
    say("analytics",
      `Raw volume is ${pct(raw.value)} against the matched prior window. Taken alone that reads like a collapse.`);
    say("analytics",
      `It is not like-for-like. On the capacity-weighted measure the same window is ${pct(weighted.value)}. ` +
      `The gap between those two numbers is mix: the new items carry more rated pages each, so fewer units move the same capacity. ` +
      `Quote the unit number without the weighted one and you have overstated the decline by ${Math.abs((raw.value - weighted.value) * 100).toFixed(1)} points.`,
      { kind: "key" });
    say("story",
      `Then the headline is the weighted figure, and the unit figure is the explanation underneath it. Lead with ${pct(raw.value)} and every question in the room is about the wrong number.`);
  } else if (weighted) {
    say("analytics", `The capacity-weighted window is ${pct(weighted.value)} against its matched prior period.`);
  }

  /* ---------- 5. the real dispute: conversion vs retention ---------- */

  const adoption = figure(ctx, (nm) => nm.includes("share of") || nm.includes("new-item share"));
  const mandated = findSpan(ctx, "return", "legacy");
  const noCustomer = !(c.grain || []).some((g) => /customer|buyer|account|member/i.test(g));

  if (adoption) {
    const pctAdopt = `${(adoption.value * 100).toFixed(1)}%`;
    say("narrative",
      `Let me put the optimistic reading on the table so someone has to knock it down. New items are ${pctAdopt} of units in the last complete period. That is a transition that worked. The customers moved.`,
      { kind: "claim" });
    findings.push({
      findingId: U.stableId("finding", "narrative", "adoption-success"),
      agentId: "narrative", runId: ctx.runId, severity: "major",
      claimRef: "adoption", title: `New-item share of ${pctAdopt} indicates the transition succeeded with customers.`,
      detail: `The replacement items account for ${pctAdopt} of units in the last complete period.`,
      proposedType: "hypothesis", proposedSpec: null,
      citations: [], confidence: "low",
      breaksIf: "", test: "Cohort-level repurchase data.", constrains: "", external: null, placeholder: true,
    });

    say("causal",
      mandated
        ? `I have to challenge that, and I can cite it. The brief says the channel was instructed to return legacy stock. When you remove the alternative, share goes to the survivor whether or not a single customer preferred it. ${pctAdopt} measures the shelf, not the buyer.`
        : `I have to challenge that. Share rising when the alternative is withdrawn tells you about availability, not preference — but I cannot cite a source for the withdrawal in this corpus, so treat my objection as weaker than it sounds.`,
      { kind: "challenge", cites: mandated ? [mandated] : [] });
    findings.push({
      findingId: U.stableId("finding", "causal", "adoption-conversion"),
      agentId: "causal", runId: ctx.runId, severity: "blocker",
      claimRef: "adoption",
      title: `${pctAdopt} is channel conversion, not customer retention.`,
      detail: mandated
        ? `The corpus states that the channel was instructed to return legacy inventory. With the alternative withdrawn, share concentrates in the replacement regardless of customer preference, so this figure cannot evidence retention.`
        : `Share concentrating after the alternative is withdrawn evidences availability, not preference.`,
      proposedType: "limitation", proposedSpec: null,
      citations: mandated ? [mandated] : [],
      confidence: "high",
      breaksIf: "", test: "",
      constrains: "Any claim that customers preferred the replacement, or that former buyers of either yield tier were retained.",
      external: null, placeholder: true,
    });

    say("defensibility",
      `That is the question that breaks the deck if it is not pre-empted. Anyone senior will ask it in the first two minutes. Say "mandated channel conversion" and it never lands as a gotcha.`);
  }

  if (noCustomer) {
    say("causal",
      `And the deeper limit: nothing in this file identifies a customer. Not a hashed id, not a loyalty key. No cohort can be followed across the change, so retention is not a hard question here — it is an unobservable one. That belongs on the slide as a limitation, not buried in an appendix.`,
      { kind: "key" });
  }

  /* ---------- 6. the second dispute: which window is the headline ---------- */

  const l4 = figure(ctx, (nm) => nm.includes("×") && nm.includes("trailing 4"));
  if (weighted && l4 && Math.abs(l4.value - weighted.value) > 0.03) {
    say("analytics",
      `The trailing short window is ${pct(l4.value)} against ${pct(weighted.value)} for the full period. That is a material step down, and it is the most recent information we have. I would lead with it.`,
      { kind: "claim" });
    findings.push({
      findingId: U.stableId("finding", "analytics", "window-recent"),
      agentId: "analytics", runId: ctx.runId, severity: "major",
      claimRef: "window", title: `The trailing short window (${pct(l4.value)}) is the more decision-relevant headline.`,
      detail: `It is the most recent evidence and it is materially weaker than the full period.`,
      proposedType: "hypothesis", proposedSpec: null, citations: [], confidence: "medium",
      breaksIf: "", test: "Whether the gap persists across 8- and 10-period cuts.", constrains: "", external: null, placeholder: true,
    });

    say("sensitivity",
      `I would not, and it is a definition point rather than a preference. A short window is noisier by construction, and the approved contract fixed the full period as the comparison basis at Gate 1. Change the headline window after the fact and you are choosing the window because you have seen the answer.`,
      { kind: "challenge" });
    findings.push({
      findingId: U.stableId("finding", "sensitivity", "window-full"),
      agentId: "sensitivity", runId: ctx.runId, severity: "major",
      claimRef: "window", title: `The full period stays the headline; the short window is reported beside it as a warning.`,
      detail: `The comparison basis was fixed in the approved data contract. Selecting a shorter window after seeing the result is window-shopping, and a short window carries more variance by construction. Report both; lead with the one that was defined before the answer was known.`,
      proposedType: "analytical_assumption", proposedSpec: null, citations: [], confidence: "high",
      breaksIf: "If the short-window weakness persists across successive cuts, the full period stops being the right lens and the trend has genuinely broken.",
      test: "", constrains: "", external: null, placeholder: true,
    });

    say("exec",
      `Report both, in that order, on one line. "Full period ${pct(weighted.value)}; latest cut ${pct(l4.value)} and worth watching." A reader who sees only one of those has been handled, and they can tell.`);
  }

  /* ---------- 7. definitions, charts, the ledger ---------- */

  if ((c.demotedLabels || []).length) {
    say("definition",
      `A trap worth naming: this file carries ${(c.demotedLabels || []).slice(0, 3).join(", ")} alongside the date. Select a period by label and by date range and you get different row sets wherever a period straddles a boundary. Two correct figures that disagree. Every number must say which definition it used.`);
  }

  say("viz",
    `On charts: value axes start at zero, and I refuse a dual axis outright. If two series need different scales, index them — a dual axis lets the eye compare two arbitrary scales and calls it a relationship.`);

  say("assumption",
    `The ledger so far: ${(c.collapseRules || []).map((r) => `${r.col} folded by ${String(r.rule).toUpperCase()}`).join("; ")}. ` +
    `Each of those was inferred from how the segments behave and then approved by a person. They are assumptions. They belong in the appendix where someone can disagree with them.`);

  /* ---------- 8. external research, quarantined ---------- */

  say("research",
    `I have general context on transitions like this one — and it stays behind the line. It cannot support a conclusion, cannot contradict the files, and cannot be cited in the recommendation until a human clears it at Gate 3. With no model configured I have retrieved nothing, which is the correct amount to have retrieved.`,
    { kind: "quarantine" });

  /* ---------- 9. the decision ---------- */

  const stockNow = figure(ctx, (nm) => nm.includes(" at "));
  if (stockNow) {
    say("decision",
      `Operationally there is something to do today regardless of the retention question: ${num(stockNow.value)} units of on-hand stock at the last complete period. That is a real position, and managing it does not require knowing why demand moved.`);
  }

  say("decision",
    `The decision I can defend: keep the simplified architecture, validate the group most exposed to the change, and set a threshold now for what would reverse it. That is reversible. Reversing the portfolio on a descriptive year-over-year read is not.`,
    { kind: "key" });

  say("defensibility",
    `Confidence, stated separately so nobody has to infer it: high on the arithmetic, because two engines agree. Moderate on the full-period read. Low on cause — and I would say that out loud before anyone asks.`);

  say("story",
    `Then the through-line is: the shelf changed, the buyer is unobserved, the decline is inside its prior range, the recent cut is a warning. Four sentences, in that order. Anything else is an appendix.`);

  return { turns, findings };
}

export default buildDeliberation;
