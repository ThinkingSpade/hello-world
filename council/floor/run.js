/* run.js — the recorded run.
 *
 * Four acts over council/demo/meridian/retention-demo.xlsx — the Meridian
 * retention claim, the same case the workbench loads by default, so the room
 * replays the very case a visitor can then take the chair on. The shape is
 * Munder Difflin's floor states — a title, a wall clock, a readout and what
 * everyone is doing — with Council's gates in place of their times of day.
 * The cast itself lives in ./cast.js, because the live bench needs it too.
 *
 * Every number below is real: it comes from the committed workbook and is
 * re-derived by demo/meridian/verify.py. Do not invent figures here.
 */

export { SEATS, SIGNER } from "./cast.js";
import { SEATS } from "./cast.js";

/* ── the four acts ──────────────────────────────────────────────────────────
 * st      per-seat floor state — on | flag | block | done | idle
 * eng     the two engines — off | run | ok | split
 * signer  is a human on the floor, waiting to approve
 * log     the run log, streamed a line at a time and looped
 * talk    [seatId, line] speech, cycled
 * now     what the ID card says each seat is doing in this act
 */

const all = (v) => SEATS.reduce((o, s) => ((o[s.id] = v), o), {});

export const ACTS = [
  {
    ships: ["grain settled", "80 splits kept", "july excluded", "injection quarantined"],
    tools: [["contract","Grep","UK&I vs EMEA-UK"],["sentinel","Read","brief.md ¶14"],["contract","Bash","profile the grain"]],
    btn: "GATE 1 · CONTRACT", sub: "grain & keys",
    title: "SETTLING THE GRAIN — BEFORE ANYONE COMPUTES ANYTHING",
    time: "03:12 · GATE 1",
    read: "6 CLAIMS · 1 BLOCKED · 0 DISSENT",
    eng: "run", signer: true,
    st: Object.assign(all("idle"), { contract: "flag", sentinel: "flag", definition: "on" }),
    now: { contract: "telling split records from duplicates", sentinel: "scanning the brief for instructions", definition: "waiting on the specifications" },
    log: [
      "run m41c88d2 · corpus 2 files · 2,720 cells · sha256 verified",
      "profiling the grain — no model is consulted here",
      "grain candidate: month × region × plan",
      "334 rows, 254 distinct keys — keys repeat. duplicate, or split record?",
      "80 keys arrive in two billing files · flows split cleanly, the subscriber snapshot repeats",
      "churned and new accounts are flows · summing across segments is correct",
      "subscribers (EOM) is a level · summing across files double counts — BLOCKED",
      "\"UK&I\" starts the month \"EMEA-UK\" ends — one desk renamed, not a new region",
      "final month 2025-07 covers 14 of 31 days · 2 of 5 regions reporting",
      "brief.md ¶14 tries to instruct the reader-model · quoted, located, kept as data",
      "gate 1 · the data contract is waiting on a human",
      "gate 1 approved · contract hash 4e0b7a",
    ],
    talk: [
      ["contract", "that key repeats"],
      ["sentinel", "data, not orders"],
      ["contract", "UK&I is EMEA-UK with a new name"],
      ["definition", "which month is whole?"],
      ["contract", "july is half a month — out of every window"],
    ],
  },
  {
    ships: ["churn defined", "level vs flow held", "40 specs frozen", "july fenced"],
    tools: [["math","Bash","SQL + reducer"],["math","Write","churn spec"],["definition","Grep","'churn' ×2"]],
    btn: "GATE 2 · DEFINITIONS", sub: "every figure twice",
    title: "EVERY FIGURE COMPUTED TWICE, BY TWO ENGINES",
    time: "03:48 · GATE 2",
    read: "19 CLAIMS · 1 BLOCKED · 0 DISSENT",
    eng: "split", signer: true,
    st: Object.assign(all("idle"), { math: "block", definition: "flag", analytics: "flag", contract: "done", sentinel: "done" }),
    now: { math: "the two churn definitions disagree", definition: "'churn' means two things in one deck", analytics: "the pre and post windows are unequal", contract: "the contract holds", sentinel: "quarantined" },
    log: [
      "gate 2 · calculation specifications",
      "a seat proposes a spec · a seat never states a figure",
      "S1 monthly_churn · churned ÷ opening subscribers · by plan",
      "SQL 3.94% · reducer 3.94% · reconciled",
      "S2 the deck's number · plan-average, each plan one vote",
      "S3 seat-weighted churn · every account counts once",
      "the deck averages three plans before and two after — the denominator changed shape",
      "subscribers fold at period end · never summed across files",
      "march is the transition month · the deck drops it, so both variants fence it",
      "SQL and reducer agree on all 40 specifications",
      "gate 2 approved · 40 specifications frozen into the run id",
    ],
    talk: [
      ["math", "show me the spec"],
      ["definition", "one word, two denominators"],
      ["math", "twice or not at all"],
      ["analytics", "twelve months against four"],
      ["math", "now it reproduces"],
    ],
  },
  {
    ships: ["claim typed", "counter-story filed", "dissent recorded", "resolved at rung 2"],
    tools: [["causal","Read","the plan migration"],["sensitivity","Bash","re-weight the mix"],["viz","Read","chart axis"],["research","WebFetch","outside the case"]],
    btn: "COUNCIL · CONVENED", sub: "fifteen lenses",
    title: "FIFTEEN LENSES · DISAGREEMENT IS NEVER SETTLED BY COUNTING",
    time: "04:31 · COUNCIL",
    read: "47 CLAIMS · 1 BLOCKED · 2 DISSENT",
    eng: "ok", signer: false,
    st: Object.assign(all("on"), {
      causal: "flag", narrative: "flag", sensitivity: "flag", viz: "flag",
      story: "flag", defensibility: "flag", exec: "flag", research: "block",
    }),
    now: {
      causal: "the plans were merged, not the customers", narrative: "building the strongest opposing case",
      sensitivity: "the improvement shrinks under a fixed mix", viz: "the churn axis starts at 1.5%",
      story: "'retention improved' does not follow", defensibility: "the claim fails its own hardest question",
      exec: "the headline states arithmetic as behavior", research: "held outside the evidence set",
      assumption: "the plan mapping is asserted", decision: "there is no threshold yet",
    },
    log: [
      "convening · fifteen seats, one lens each, none of them asked for a number",
      "causal: Team's 8.05% churners were folded into Core's 41,500 seats — the rate dilutes by construction",
      "red team: \"the customers didn't get better. the denominator did.\"",
      "sensitivity: plan-average says −2.14pt · hold the mix fixed and it is −0.44pt",
      "sensitivity: a conclusion that flips under a defensible choice is a blocker",
      "visualization: the churn axis starts at 1.5%, not zero",
      "story: 'retention improved' is one step past 'the average fell'",
      "assumption: the Team → Core mapping is asserted, never measured",
      "defensibility: \"would this improvement survive one quarter of Core churning like Team?\"",
      "gate 3 · external research is held outside the evidence set",
      "gate 3 · 1 item admitted as external_context · 1 rejected",
      "disagreement · analytics and sensitivity differ on the comparison window",
      "ladder rung 1, source quality: tie",
      "ladder rung 2, formula reproducibility: the fixed-mix variant reproduces",
      "resolved at rung 2 · no vote was taken · the dissent is kept in the export",
      "july: 2 of 5 regions reporting, the two quietest — best month on record, excluded anyway",
      "council closed · 47 claims typed and sourced · 2 dissents recorded",
    ],
    talk: [
      ["causal", "merged plans, same people"],
      ["narrative", "what else fits?"],
      ["sensitivity", "hold the mix still"],
      ["viz", "zero the axis"],
      ["research", "not evidence"],
      ["defensibility", "and next quarter?"],
      ["story", "one step too far"],
      ["exec", "so what?"],
    ],
  },
  {
    ships: ["owner named", "threshold set", "signed", "40/40 verified"],
    tools: [["decision","TodoWrite","owner + threshold"],["exec","Write","the headline"],["math","Bash","verify 40/40"]],
    btn: "GATE 4 · DECISION", sub: "a person signs",
    title: "THE MODELS ARGUED · THE ENGINES COMPUTED · A PERSON SIGNS",
    time: "05:06 · GATE 4",
    read: "47 CLAIMS · 1 BLOCKED · 2 DISSENT",
    eng: "ok", signer: true,
    st: Object.assign(all("done"), { decision: "on", exec: "on", sensitivity: "flag", research: "done" }),
    now: { decision: "naming an owner and a threshold", exec: "putting the real number first", sensitivity: "dissent recorded, not resolved away" },
    log: [
      "gate 4 · decision",
      "report seat-weighted churn: 2.54% before, 2.07% after — real, and one fifth of the deck's claim",
      "owner named · trigger if Core churn crosses 3.0% · july re-opens when all five regions report",
      "the 2.1-point headline is excluded from the report rather than softened",
      "awaiting signature",
      "signed · run m41c88d2 · bundle 0.9 MB",
      "replay re-renders every figure from the bundle alone, with no source files",
      "verify re-executes each calculation against the originals · 40/40 match",
    ],
    talk: [
      ["decision", "who owns it?"],
      ["exec", "the real number leads"],
      ["decision", "reversible in one cycle"],
      ["sensitivity", "dissent stands"],
    ],
  },
];

export const ACT_DUR = 24000;

export const STATE_WORD = {
  on:    "● reviewing",
  flag:  "▲ flagged",
  block: "■ blocked",
  done:  "✓ cleared",
  idle:  "○ idle",
};
