/* cast.js — the fifteen, and the one who signs.
 *
 * Shared by both drivers: ../agents.js dresses the live bench from this, and
 * ./run.js dresses the recorded one. Seat ids, lenses and permitted claim types
 * are the ones ../council.js runs; `r` is a recipe for Munder Difflin's cast art
 * (vendor/munder-people.js) in their own vocabulary — a hair style, a hair
 * colour, a garment, a tie, a brow, a mouth.
 */

export const SEATS = [
  {
    id: "contract", code: "CONTRACT", name: "Data Contract", lens: "grain & keys", tag: "GRAIN", color: "#4ECDC4",
    may: "assumption · limitation",
    r: { skin:"light", hairc:[58,42,28],   hair:"styleShort",  hairargs:{part:"L"}, cloth:"suit", c1:[58,63,74], tie:[78,205,196], brow:"flat", mouth:"neutral" },
  },
  {
    id: "math", code: "MATH", name: "Math Audit", lens: "recompute", tag: "RECOMPUTE", color: "#6BCF7F",
    may: "nothing — specifications only",
    r: { skin:"tan",   hairc:[38,32,26],   hair:"styleRecede", cloth:"dressshirt", c1:[172,196,224], tie:[107,207,127], glasses:true, brow:"flat", mouth:"neutral" },
  },
  {
    id: "analytics", code: "ANALYTICS", name: "Analytics Audit", lens: "method fitness", tag: "METHOD", color: "#4ECDC4",
    may: "assumption · hypothesis · limitation",
    r: { skin:"brown", hairc:[120,76,42],  hair:"styleFrame",  hairargs:{length:18, vol:2}, cloth:"cardigan", c1:[124,190,208], c2:[244,242,238], glasses:true, brow:"soft", mouth:"neutral", lashes:true },
  },
  {
    id: "definition", code: "DEFINITION", name: "Definition Consistency", lens: "one metric, one meaning", tag: "MEANING", color: "#B197FC",
    may: "assumption · limitation",
    r: { skin:"dark",  hairc:[32,26,24],   hair:"styleBun",    cloth:"blouse", c1:[177,151,252], brow:"soft", mouth:"smile", lashes:true },
  },
  {
    id: "causal", code: "CAUSAL", name: "Causal Inference", lens: "confounds", tag: "CONFOUND", color: "#FFD93D",
    may: "hypothesis · limitation · assumption",
    r: { skin:"light", hairc:[92,60,34],   hair:"styleFloppy", cloth:"dressshirt", c1:[224,196,140], tie:[170,58,58], brow:"angry", mouth:"neutral" },
  },
  {
    id: "sensitivity", code: "SENSITIVITY", name: "Uncertainty & Sensitivity", lens: "how far it moves", tag: "RANGE", color: "#FFD93D",
    may: "assumption · limitation · hypothesis",
    r: { skin:"tan",   hairc:[150,96,48],  hair:"styleCurly",  cloth:"suit", c1:[92,84,110], tie:[255,217,61], brow:"raised", mouth:"neutral", lashes:true },
  },
  {
    id: "viz", code: "VIZ", name: "Visualization Integrity", lens: "chart vs claim", tag: "CHART", color: "#B197FC",
    may: "limitation · assumption",
    r: { skin:"light", hairc:[46,38,42],   hair:"styleMessy",  hairargs:{length:15}, cloth:"polo", c1:[145,124,200], c2:[120,102,172], glasses:true, brow:"soft", mouth:"smile" },
  },
  {
    id: "narrative", code: "RED TEAM", name: "Narrative Red Team", lens: "the counter-story", tag: "COUNTER", color: "#FF6B6B",
    may: "hypothesis · limitation",
    r: { skin:"dark",  hairc:[28,24,26],   hair:"styleSpiky",  cloth:"suit", c1:[74,58,72], tie:[255,107,107], brow:"angry", mouth:"frown" },
  },
  {
    id: "story", code: "STORY", name: "Story Audit", lens: "does it follow", tag: "LOGIC", color: "#4ECDC4",
    may: "limitation",
    r: { skin:"brown", hairc:[110,72,38],  hair:"styleFrame",  hairargs:{length:22, vol:2}, cloth:"sweater", c1:[164,206,214], brow:"soft", mouth:"smile", lashes:true },
  },
  {
    id: "defensibility", code: "DEFENSE", name: "Defensibility Audit", lens: "the question that breaks it", tag: "PRESSURE", color: "#FF6B6B",
    may: "limitation · hypothesis",
    r: { skin:"light", hairc:[64,48,28],   hair:"styleShort",  hairargs:{part:"L", recede:1}, cloth:"suit", c1:[64,52,60], tie:[184,60,60], glasses:true, facial:"goatee", brow:"angry", mouth:"neutral" },
  },
  {
    id: "assumption", code: "ASSUMPTION", name: "Assumption Ledger", lens: "what's implicit", tag: "IMPLICIT", color: "#FFD93D",
    may: "assumption · limitation",
    r: { skin:"tan",   hairc:[70,54,36],   hair:"styleBald",   cloth:"polo", c1:[212,176,96], c2:[186,152,80], glasses:true, brow:"flat", mouth:"neutral", heavy:true },
  },
  {
    id: "decision", code: "DECISION", name: "Decision Quality", lens: "is it actionable", tag: "ACTION", color: "#6BCF7F",
    may: "recommendation · limitation",
    r: { skin:"brown", hairc:[30,26,24],   hair:"styleShort",  hairargs:{part:"R"}, cloth:"suit", c1:[52,74,66], tie:[107,207,127], brow:"flat", mouth:"smile" },
  },
  {
    id: "exec", code: "EXEC", name: "Executive Communication", lens: "leadership fit", tag: "AUDIENCE", color: "#FFA07A",
    may: "limitation",
    r: { skin:"light", hairc:[40,34,30],   hair:"styleShort",  hairargs:{part:"L"}, cloth:"suit", c1:[42,40,52], tie:[255,160,122], facial:"mustacheSm", brow:"flat", mouth:"smile" },
  },
  {
    id: "research", code: "RESEARCH", name: "External Research", lens: "quarantined context", tag: "OUTSIDE", color: "#FFA07A",
    may: "external_context · hypothesis",
    r: { skin:"tan", hairc:[86,58,32],   hair:"styleFloppy", cloth:"dressshirt", c1:[226,160,120], brow:"soft", mouth:"neutral" },
  },
  {
    id: "sentinel", code: "SENTINEL", name: "Provenance Sentinel", lens: "the trust boundary", tag: "TRUST", color: "#FF6B6B",
    may: "limitation",
    r: { skin:"dark",  hairc:[60,54,48],   hair:"styleRecede", cloth:"dressshirt", c1:[196,86,86], tie:[54,46,58], glasses:true, facial:"mustache", brow:"angry", mouth:"neutral", heavy:true },
  },
];

/* The person who signs. Never one of the fifteen — that is the whole point. */
export const SIGNER = {
  r: { skin:"light", hairc:[120,76,42], hair:"styleFrame", hairargs:{length:18, vol:2}, cloth:"cardigan", c1:[236,174,192], c2:[244,242,238], brow:"soft", mouth:"smile", blush:true, lashes:true },
};

/* ── the break area ──────────────────────────────────────────────────────────
 * Munder Difflin's floor has agents stroll to the cafeteria, say something in
 * character and walk back; two at the same table trade a two-beat exchange.
 * (scene/office/cafeteriaLines.ts.) Theirs are Office jokes; these are auditors
 * on a break, which is the only part that should be ours.
 */
export const BREAK_LINES = {
  table: [
    "if the grain is wrong, nothing downstream is right",
    "I asked what 'adoption' meant and got three answers",
    "the chart was fine. the axis was not",
    "nobody wrote the assumption down. again",
    "it reconciles or it isn't a number",
    "I like the ones where the data says no",
  ],
  coffee: [
    "one row, one fact. one coffee",
    "the reducer agreed with SQL. rare and lovely",
    "still thinking about that partial week",
    "brb, re-deriving the denominator",
  ],
  vending: [
    "the machine is more reproducible than the deck",
    "two engines said 138.4. I trust it",
    "no snack is evidence of anything",
  ],
};

/** Two-beat exchanges for a shared table. */
export const BREAK_EXCHANGES = [
  ["did the split records survive?", "all forty-one of them"],
  ["they called it adoption again", "the channel had no choice"],
  ["gate two is frozen", "then the numbers can stop moving"],
  ["who signs this one?", "a person. that's the whole point"],
  ["the counter-story holds up", "which is exactly the problem"],
  ["excluding W31 flips it", "so we report both, or neither"],
];
