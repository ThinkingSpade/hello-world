/* run.js — the recorded run.
 *
 * Four acts over council/demo/portfolio-demo.xlsx, in the shape of Munder
 * Difflin's floor states — a title, a wall clock, a readout and what everyone is
 * doing — with Council's gates in place of their times of day. The cast itself
 * lives in ./cast.js, because the live bench needs it too.
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
    ships: ["grain settled", "41 splits kept", "partial week excluded", "injection quarantined"],
    tools: [["contract","Grep","1,284 repeated keys"],["sentinel","Read","brief.md ¶14"],["contract","Bash","profile the grain"]],
    btn: "GATE 1 · CONTRACT", sub: "grain & keys",
    title: "SETTLING THE GRAIN — BEFORE ANYONE COMPUTES ANYTHING",
    time: "03:12 · GATE 1",
    read: "6 CLAIMS · 1 BLOCKED · 0 DISSENT",
    eng: "run", signer: true,
    st: Object.assign(all("idle"), { contract: "flag", sentinel: "flag", definition: "on" }),
    now: { contract: "telling split records from duplicates", sentinel: "scanning the brief for instructions", definition: "waiting on the specifications" },
    log: [
      "run 7f3a91c4 · corpus 2 files · 14,706 cells · sha256 verified",
      "profiling the grain — no model is consulted here",
      "grain candidate: retailer × sku × week",
      "1,284 repeated keys — duplicate, or split record?",
      "41 weeks straddle a fiscal boundary · units split, inventory recorded twice",
      "units are a flow · summing across segments is correct",
      "inventory is a level · summing across segments double counts — BLOCKED",
      "final week 2026-W31 covers 3 of 7 days — structurally incomplete",
      "brief.md ¶14 tries to instruct the reader-model · quoted, located, kept as data",
      "gate 1 · the data contract is waiting on a human",
      "gate 1 approved · contract hash 9c21f0",
    ],
    talk: [
      ["contract", "that key repeats"],
      ["sentinel", "data, not orders"],
      ["contract", "split records, not duplicates"],
      ["definition", "which period?"],
      ["contract", "partial week — out of every window"],
    ],
  },
  {
    ships: ["S1 reconciled", "S2 reconciled", "S3 unblocked", "11 specs frozen"],
    tools: [["math","Bash","SQL + reducer"],["math","Write","spec S3"],["definition","Grep","'adoption' ×2"]],
    btn: "GATE 2 · DEFINITIONS", sub: "every figure twice",
    title: "EVERY FIGURE COMPUTED TWICE, BY TWO ENGINES",
    time: "03:48 · GATE 2",
    read: "19 CLAIMS · 1 BLOCKED · 0 DISSENT",
    eng: "split", signer: true,
    st: Object.assign(all("idle"), { math: "block", definition: "flag", analytics: "flag", contract: "done", sentinel: "done" }),
    now: { math: "respecifying S3 after a reconciliation gap", definition: "'adoption' means two things", analytics: "the comparison windows are unequal", contract: "the contract holds", sentinel: "quarantined" },
    log: [
      "gate 2 · calculation specifications",
      "a seat proposes a spec · a seat never states a figure",
      "S1 sell_through_units · 13w window · W31 excluded",
      "SQL 412,880 · reducer 412,880 · reconciled",
      "S2 adoption_share · denominator = family units, collapsed",
      "SQL 0.883 · reducer 0.883 · reconciled",
      "S3 unit_price_index · by buyer group",
      "SQL 138.4 · reducer 141.2 · Δ2.8 — the figure cannot become a claim",
      "'adoption' means units here and revenue on slide 4",
      "the prior base is 14 weeks against 13",
      "S3 respecified — collapse before filter, not after",
      "SQL 138.4 · reducer 138.4 · reconciled · unblocked",
      "gate 2 approved · 11 specifications frozen into the run id",
    ],
    talk: [
      ["math", "show me the spec"],
      ["definition", "one word, two meanings"],
      ["math", "twice or not at all"],
      ["analytics", "equal windows"],
      ["math", "now it reproduces"],
    ],
  },
  {
    ships: ["claim typed", "counter-story filed", "dissent recorded", "resolved at rung 2"],
    tools: [["causal","Read","the shipment note"],["sensitivity","Bash","re-run without W31"],["viz","Read","chart axis"],["research","WebFetch","outside the case"]],
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
      causal: "the channel was instructed to switch", narrative: "building the strongest opposing case",
      sensitivity: "the headline flips under another rule", viz: "the value axis starts at 340k",
      story: "'demand fell' does not follow", defensibility: "claim 3 fails its own hardest question",
      exec: "the headline states an activity", research: "held outside the evidence set",
      assumption: "the successor mapping is asserted", decision: "there is no threshold yet",
    },
    log: [
      "convening · fifteen seats, one lens each, none of them asked for a number",
      "causal: retailers were told to return legacy stock — uptake is not a preference signal",
      "red team: \"the channel switched; the customer was never asked\"",
      "sensitivity: excluding W31 moves the headline from −9.4% to −4.1%",
      "sensitivity: a conclusion that flips under a defensible choice is a blocker",
      "visualization: the value axis starts at 340k",
      "story: 'demand fell' is one step past 'units fell'",
      "assumption: the successor mapping is asserted, never measured",
      "defensibility: \"if the channel had a choice, would this curve look any different?\"",
      "gate 3 · external research is held outside the evidence set",
      "gate 3 · 1 item admitted as external_context · 1 rejected",
      "disagreement · analytics and sensitivity differ on the comparison window",
      "ladder rung 1, source quality: tie",
      "ladder rung 2, formula reproducibility: the sensitivity variant reproduces",
      "resolved at rung 2 · no vote was taken · the dissent is kept in the export",
      "retention: nothing in the corpus identifies a customer — a limitation, not a finding",
      "council closed · 47 claims typed and sourced · 2 dissents recorded",
    ],
    talk: [
      ["causal", "after ≠ because"],
      ["narrative", "what else fits?"],
      ["sensitivity", "how far does it move?"],
      ["viz", "zero the axis"],
      ["research", "not evidence"],
      ["defensibility", "and then?"],
      ["story", "one step too far"],
      ["exec", "so what?"],
    ],
  },
  {
    ships: ["owner named", "threshold set", "signed", "47/47 verified"],
    tools: [["decision","TodoWrite","owner + threshold"],["exec","Write","the headline"],["math","Bash","verify 47/47"]],
    btn: "GATE 4 · DECISION", sub: "a person signs",
    title: "THE MODELS ARGUED · THE ENGINES COMPUTED · A PERSON SIGNS",
    time: "05:06 · GATE 4",
    read: "47 CLAIMS · 1 BLOCKED · 2 DISSENT",
    eng: "ok", signer: true,
    st: Object.assign(all("done"), { decision: "on", exec: "on", sensitivity: "flag", research: "done" }),
    now: { decision: "naming an owner and a threshold", exec: "putting the conclusion first", sensitivity: "dissent recorded, not resolved away" },
    log: [
      "gate 4 · decision",
      "hold the price architecture for the high-yield group; re-test in six weeks",
      "owner named · trigger at 4.0% unit decline · reversible without a relaunch",
      "1 figure is still blocked and is excluded from the report rather than softened",
      "awaiting signature",
      "signed · run 7f3a91c4 · bundle 1.2 MB",
      "replay re-renders every figure from the bundle alone, with no source files",
      "verify re-executes each calculation against the originals · 47/47 match",
    ],
    talk: [
      ["decision", "who owns it?"],
      ["exec", "so what? — put it first"],
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
