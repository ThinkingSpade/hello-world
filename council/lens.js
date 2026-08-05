/* lens.js — the decision radar.
 *
 * The application answers "what did the run find?" in three places: the ledger
 * answers it in prose, the console answers it in lines, the charts answer it in
 * numbers. None of them answer the question a reader actually arrives with,
 * which is *what does all of this come to* — and, just as importantly, which
 * pieces of the pile bear on that and which were read and changed nothing.
 *
 * So this draws it. Evidence down the left, the reading in the middle of a
 * lens on the right, and a line from each piece of evidence into the lens:
 *
 *   solid  — this moved the reading, and the line carries its colour
 *   dotted — this was read and changed nothing
 *
 * Three properties this module holds to:
 *
 *   1. NOTHING IS INVENTED. Every card is an item that exists in the run —
 *      a filed finding, an executed figure, a recorded dissent. The verdict is
 *      not a score and not a model's opinion; it is the first rung of a fixed
 *      ladder that matches, and the rung that fired is printed under it.
 *   2. NO MEASUREMENT. Every coordinate is in one fixed logical space that the
 *      host reproduces with `aspect-ratio`, so the picture scales without this
 *      file ever touching getBoundingClientRect. Same run, same picture.
 *   3. IT IS A READING, NOT A DECISION. The lens says what the evidence
 *      currently comes to. Gate 4 is still a person. The footer says so, and
 *      the verdict changes to `Signed` only when a human has actually signed.
 *
 * Input is one plain snapshot object (see `render`). This module knows nothing
 * about ingest, the engines, or the seats — it is handed already-formatted
 * strings and draws them.
 */
"use strict";

const NS = "http://www.w3.org/2000/svg";

/* ------------------------------------------------------------------ space */

/* One logical drawing space, reproduced by the host's aspect-ratio. */
const VB = { w: 1200, h: 780 };
const CARD = { w: 436, h: 104 };
const LENS = { cx: 838, cy: 388, rx: 266, ry: 290 };

/* Six slots, staggered horizontally the way a scatter of evidence actually
 * arrives — and each with the angle on the lens rim it reports to. Angles are
 * degrees counter-clockwise from the positive x axis. */
const SLOTS = [
  { x: 46, y:  44, a: 149 },
  { x: 78, y: 168, a: 165 },
  { x: 26, y: 292, a: 180 },
  { x: 64, y: 416, a: 195 },
  { x: 98, y: 540, a: 212 },
  { x: 38, y: 656, a: 244 },
];
const MAX_CARDS = SLOTS.length;

/* ------------------------------------------------------------------ tones */

/* Colour here is state, never decoration — the same four the rest of the
 * application uses, plus the violet the lens body is made of. */
const TONE = {
  hot:  { line: "#b3372c", dot: "#b3372c", solid: true },
  warm: { line: "#9a6a00", dot: "#9a6a00", solid: true },
  good: { line: "#1d7a4d", dot: "#1d7a4d", solid: true },
  cool: { line: "#b9b4a8", dot: "#b9b4a8", solid: false },
};

const RIM = {
  err:  "#e3b9b4",
  warn: "#e8cf9a",
  ok:   "#a8d6bd",
  acc:  "#c3c8f2",
  idle: "#dedbd3",
};

/* ------------------------------------------------------------------ nodes */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const pct = (v, total) => `${((v / total) * 100).toFixed(4)}%`;
const rad = (deg) => (deg * Math.PI) / 180;

/* A point on the lens rim, at `out` times its radius. */
function rim(deg, out = 1) {
  return {
    x: LENS.cx + LENS.rx * out * Math.cos(rad(deg)),
    y: LENS.cy - LENS.ry * out * Math.sin(rad(deg)),
  };
}

/* ------------------------------------------------------- the reading rule */

/* Ordered. The first rung that matches decides, and the rung that fired is
 * printed. This is deliberately the same shape as the resolution ladder: a
 * fixed order of precedence, never a count of votes and never a score. */
function readVerdict(s) {
  const findings = (s.findings || []).filter((f) => f.agentId !== "research");
  const blockers = findings.filter((f) => f.severity === "blocker");
  const majors = findings.filter((f) => f.severity === "major");
  const figures = s.figures || [];
  const broken = figures.filter((f) => !f.reconciled && !f.undefinedResult);
  const escalated = (s.resolutions || []).filter((r) => r.outcome === "escalated");
  const standing = blockers.length + majors.length + escalated.length;

  if (s.gates && s.gates.final_recommendation === "approved") {
    return {
      word: "Signed", tone: "ok", rule: "gate 4 · a person signed",
      sub: standing
        ? `Signed with ${standing} finding${standing === 1 ? "" : "s"} still standing. The bundle records who signed, against which run id, and what was still open.`
        : "Signed with nothing standing. The bundle records who signed and against which run id.",
    };
  }
  if (!findings.length && !figures.length) {
    return {
      word: "Unread", tone: "idle", rule: "nothing has been executed yet",
      sub: "No figure has been computed and no seat has filed. There is nothing here to read yet.",
    };
  }
  if (broken.length) {
    return {
      word: "Blocked", tone: "err", rule: "rung 1 · a figure did not reconcile",
      sub: `${broken.length} figure${broken.length === 1 ? "" : "s"} the two engines disagree on. A figure that does not reconcile cannot become a claim, so nothing downstream of it can be signed.`,
    };
  }
  if (blockers.length) {
    return {
      word: "Blocked", tone: "err", rule: "rung 2 · a blocker was filed",
      sub: `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} filed by the bench. Each names a specific figure or definition that has to change before this is defensible.`,
    };
  }
  if (escalated.length) {
    return {
      word: "Escalate", tone: "warn", rule: "rung 3 · the ladder ran out",
      sub: `${escalated.length} disagreement${escalated.length === 1 ? "" : "s"} reached the top of the resolution ladder. The software will not settle these — they are yours.`,
    };
  }
  if (majors.length) {
    return {
      word: "Hold", tone: "warn", rule: "rung 4 · major findings unanswered",
      sub: `${majors.length} major finding${majors.length === 1 ? "" : "s"} stand unanswered. None of them blocks a figure, and all of them change what the figure means.`,
    };
  }
  return {
    word: "Proceed", tone: "ok", rule: "no rung fired",
    sub: "Every figure reconciled across both engines, no blocker was filed, and no disagreement reached the top of the ladder. The signature is still yours to give.",
  };
}

/* --------------------------------------------------------------- evidence */

function seatName(s, id) {
  const r = (s.roster || []).find((x) => x.id === id);
  return r ? r.seat : id;
}
function seatGlyph(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

const SEV_WEIGHT = { blocker: "hot", major: "warm", minor: "cool", note: "cool" };
const SEV_EFFECT = {
  blocker: { word: "Blocks the signature", dir: "up" },
  major:   { word: "Holds the decision", dir: "up" },
  minor:   { word: "No change", dir: "flat" },
  note:    { word: "No change", dir: "flat" },
};
const RANK = { hot: 0, warm: 1, good: 2, cool: 3 };

function findingItems(s) {
  const res = s.resolutions || [];
  return (s.findings || [])
    .filter((f) => f.agentId !== "research")
    .map((f) => {
      const r = res.find((x) => x.findingId === f.findingId);
      const escalated = r && r.outcome === "escalated";
      const seat = seatName(s, f.agentId);
      return {
        glyph: seatGlyph(seat),
        source: seat,
        meta: f.severity,
        title: f.title,
        sub: escalated ? `Escalated — ${r.rationale}` : f.detail,
        effect: escalated ? { word: "Escalated to you", dir: "up" } : SEV_EFFECT[f.severity] || SEV_EFFECT.note,
        weight: escalated ? "hot" : SEV_WEIGHT[f.severity] || "cool",
        stage: "council",
      };
    })
    .sort((a, b) => RANK[a.weight] - RANK[b.weight]);
}

function figureItems(s) {
  return (s.figures || [])
    .map((f) => {
      if (f.undefinedResult) {
        return {
          glyph: "∅", source: f.name, meta: "undefined",
          title: "No value — the comparison base is empty",
          sub: f.note || "Both engines agree there is no value to report. Reporting one would be an invention.",
          effect: { word: "No change", dir: "flat" }, weight: "cool", stage: "calc",
        };
      }
      if (!f.reconciled) {
        return {
          glyph: "≠", source: f.name, meta: "engines disagree",
          title: `SQL ${f.sql} vs reducer ${f.js}`,
          sub: f.error || "Two engines that share no code produced different values. The figure is blocked from becoming a claim.",
          effect: { word: "Blocks the signature", dir: "up" }, weight: "hot", stage: "calc",
        };
      }
      return {
        glyph: "=", source: f.name, meta: "reconciled",
        title: `${f.sql} — confirmed twice`,
        sub: `SQL over SQLite-WASM and the JavaScript reducer agree${f.delta ? ` to ${f.delta}` : ""}. Cleared to become a calculated claim.`,
        effect: { word: "Cleared both engines", dir: "down" }, weight: "good", stage: "calc",
      };
    })
    .sort((a, b) => RANK[a.weight] - RANK[b.weight]);
}

function dissentItems(s) {
  const out = [];
  for (const d of s.dissent || []) {
    for (const e of d.entries || []) {
      const seat = seatName(s, e.agentId);
      out.push({
        glyph: seatGlyph(seat), source: seat, meta: "preserved dissent",
        title: d.text,
        sub: `${e.position} — ${e.rationale}`,
        effect: { word: "Recorded, not resolved", dir: "up" },
        weight: "warm", stage: "council",
      });
    }
  }
  for (const r of (s.resolutions || []).filter((x) => x.outcome === "escalated")) {
    out.push({
      glyph: "↑", source: "resolution ladder", meta: "escalated",
      title: r.rationale,
      sub: (r.dissent || []).map((d) => `${seatName(s, d.agentId)}: ${d.position}`).join(" · ") || "No seat could settle this on the evidence in the run.",
      effect: { word: "Escalated to you", dir: "up" }, weight: "hot", stage: "council",
    });
  }
  return out.sort((a, b) => RANK[a.weight] - RANK[b.weight]);
}

function buildTabs(s) {
  return [
    { id: "findings", label: "Council findings", items: findingItems(s) },
    { id: "figures",  label: "Two-engine figures", items: figureItems(s) },
    { id: "dissent",  label: "Standing dissent", items: dissentItems(s) },
  ];
}

/* Six slots and often twenty items, so something has to be left out — and what
 * gets left out is a claim about the run, so the rule is fixed and printed
 * rather than being "the top six".
 *
 * Every blocker, then the heaviest of the rest, and — if the run contains any —
 * one item that was read and changed nothing. That last slot is the honest one:
 * without it a busy run draws six loud lines and reads as though nothing in the
 * corpus was uncontroversial. Nothing is hidden; the panels below hold all of
 * it, and the legend says how many did not fit.
 */
function selectItems(items, n) {
  if (items.length <= n) return items.slice();
  const hot = items.filter((i) => i.weight === "hot").slice(0, n);
  const cool = items.filter((i) => i.weight === "cool");
  const mid = items.filter((i) => i.weight !== "hot" && i.weight !== "cool");
  const reserve = cool.length && hot.length < n ? 1 : 0;

  const out = [...hot];
  for (const i of mid) { if (out.length >= n - reserve) break; out.push(i); }
  for (const i of cool) { if (out.length >= n) break; out.push(i); }
  return out.slice(0, n).sort((a, b) => RANK[a.weight] - RANK[b.weight]);
}

/* ------------------------------------------------------------------ state */

let host = null;
let snap = null;
let activeTab = "findings";

/* ------------------------------------------------------------------ paint */

function paintHeader(s, tabs, verdict) {
  const wrap = el("div", "c-lens-head");

  const mast = el("div", "c-mast");
  mast.appendChild(el("span", "c-mast-n", "06"));
  mast.appendChild(el("h2", null, "Decision radar"));
  mast.appendChild(el("p", "c-mast-deck",
    "Every piece of evidence the run produced, and the line it draws to the reading."));
  wrap.appendChild(mast);

  const bar = el("div", "c-lens-tabs");
  bar.setAttribute("role", "tablist");
  for (const t of tabs) {
    const b = el("button", "c-lens-tab");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.id === activeTab));
    if (t.id === activeTab) b.dataset.on = "1";
    b.appendChild(el("span", "t", t.label));
    b.appendChild(el("span", "n", String(t.items.length)));
    b.addEventListener("click", () => { activeTab = t.id; paint(); });
    bar.appendChild(b);
  }
  wrap.appendChild(bar);

  const strip = el("div", "c-lens-strip");
  const live = el("div", "c-lens-live");
  live.dataset.state = s.busy ? "busy" : s.convened ? "settled" : "idle";
  live.appendChild(el("i"));
  live.appendChild(el("span", null, s.busy ? "READING" : s.convened ? "SETTLED" : "IDLE"));
  live.appendChild(el("span", "sep", "·"));
  live.appendChild(el("span", "id", `RUN ${String(s.runId || "—").slice(0, 12)}`));
  strip.appendChild(live);

  const figures = s.figures || [];
  const recon = figures.filter((f) => f.reconciled).length;
  const contested = (s.resolutions || []).filter((r) => r.contested);
  const basis = contested.length
    ? contested[0].basis.replace(/_/g, " ")
    : s.convened ? "nothing was contested" : "nothing convened yet";
  const count = tabs.reduce((n, t) => n + t.items.length, 0);
  strip.appendChild(el("div", "c-lens-meta",
    `${count} evidence item${count === 1 ? "" : "s"} · settled on: ${basis} · ${recon}/${figures.length} figures reconciled`));
  wrap.appendChild(strip);

  wrap.appendChild(el("p", "c-vh",
    `Reading: ${verdict.word}. ${verdict.sub}`));
  return wrap;
}

function paintCard(item, slot, i) {
  const b = el("button", "c-lens-card");
  b.type = "button";
  b.dataset.w = item.weight;
  b.dataset.i = String(i);
  b.style.left = pct(slot.x, VB.w);
  b.style.top = pct(slot.y, VB.h);
  b.style.width = pct(CARD.w, VB.w);
  b.style.height = pct(CARD.h, VB.h);

  const g = el("span", "g", item.glyph);
  b.appendChild(g);

  const body = el("span", "bd");
  const top = el("span", "tp");
  top.appendChild(el("span", "src", item.source));
  top.appendChild(el("span", "mt", item.meta));
  body.appendChild(top);

  const mid = el("span", "md");
  mid.appendChild(el("span", "ti", item.title));
  const eff = el("span", "eff");
  eff.dataset.dir = item.effect.dir;
  eff.appendChild(el("i", null, item.effect.dir === "up" ? "↗" : item.effect.dir === "down" ? "↘" : "—"));
  eff.appendChild(el("span", null, item.effect.word));
  mid.appendChild(eff);
  body.appendChild(mid);

  body.appendChild(el("span", "sub", item.sub || ""));

  b.appendChild(body);
  b.appendChild(el("span", "go", "→"));

  b.addEventListener("mouseenter", () => setHot(i, true));
  b.addEventListener("mouseleave", () => setHot(i, false));
  b.addEventListener("focus", () => setHot(i, true));
  b.addEventListener("blur", () => setHot(i, false));
  b.addEventListener("click", () => {
    host.dispatchEvent(new CustomEvent("lens:select", { bubbles: true, detail: { stage: item.stage } }));
  });
  return b;
}

function setHot(i, on) {
  if (!host) return;
  for (const n of host.querySelectorAll(`[data-link="${i}"]`)) n.classList.toggle("hot", on);
}

function paintLens(verdict, s) {
  const g = svg("svg", { class: "c-lens-svg", viewBox: `0 0 ${VB.w} ${VB.h}`, "aria-hidden": "true" });
  const rimColor = RIM[verdict.tone] || RIM.acc;

  const defs = svg("defs");

  const core = svg("radialGradient", { id: "c-lens-core", cx: "50%", cy: "50%", r: "50%" });
  /* The body is opaque white with a feathered edge, so the reading is printed
   * on paper rather than on the page's grid. The tint is a separate ring laid
   * over it — one gradient doing both jobs bands where the white runs out. */
  for (const [o, a] of [[0, 1], [0.86, 1], [1, 0]]) {
    core.appendChild(svg("stop", { offset: o, "stop-color": "#ffffff", "stop-opacity": a }));
  }
  defs.appendChild(core);

  const ring = svg("radialGradient", { id: "c-lens-ring", cx: "50%", cy: "50%", r: "50%" });
  for (const [o, a] of [[0.55, 0], [0.88, 0.3], [0.965, 0.58], [1, 0]]) {
    ring.appendChild(svg("stop", { offset: o, "stop-color": rimColor, "stop-opacity": a }));
  }
  defs.appendChild(ring);

  const halo = svg("radialGradient", { id: "c-lens-halo", cx: "50%", cy: "50%", r: "50%" });
  for (const [o, a] of [[0.55, 0], [0.8, 0.14], [1, 0]]) {
    halo.appendChild(svg("stop", { offset: o, "stop-color": rimColor, "stop-opacity": a }));
  }
  defs.appendChild(halo);
  g.appendChild(defs);

  g.appendChild(svg("ellipse", {
    class: "c-lens-halo", cx: LENS.cx, cy: LENS.cy,
    rx: LENS.rx * 1.42, ry: LENS.ry * 1.42, fill: "url(#c-lens-halo)",
  }));

  /* Fine dotted rings outside the body — the graticule that makes it read as
   * an instrument rather than a glow. */
  const rings = svg("g", { class: "c-lens-rings" });
  for (const [k, op] of [[1.05, 0.72], [1.14, 0.5], [1.25, 0.32], [1.38, 0.18]]) {
    rings.appendChild(svg("ellipse", {
      cx: LENS.cx, cy: LENS.cy, rx: (LENS.rx * k).toFixed(1), ry: (LENS.ry * k).toFixed(1),
      fill: "none", stroke: rimColor, "stroke-width": 1.3,
      "stroke-dasharray": "1.6 7", opacity: op,
    }));
  }
  g.appendChild(rings);

  g.appendChild(svg("ellipse", {
    class: "c-lens-core", cx: LENS.cx, cy: LENS.cy,
    rx: LENS.rx, ry: LENS.ry, fill: "url(#c-lens-core)",
  }));
  g.appendChild(svg("ellipse", {
    class: "c-lens-rim", cx: LENS.cx, cy: LENS.cy,
    rx: LENS.rx, ry: LENS.ry, fill: "url(#c-lens-ring)",
  }));

  return g;
}

function paintLinks(items) {
  const g = svg("g", { class: "c-lens-links" });
  const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let travellers = 0;

  items.forEach((item, i) => {
    const slot = SLOTS[i];
    const tone = TONE[item.weight] || TONE.cool;
    const from = { x: slot.x + CARD.w, y: slot.y + CARD.h / 2 };
    const to = rim(slot.a, 1);
    const dx = to.x - from.x;

    /* A lead-in from the frame edge, so the evidence reads as arriving from
     * somewhere rather than beginning at the card. */
    g.appendChild(svg("path", {
      d: `M 0 ${(slot.y + CARD.h / 2).toFixed(1)} H ${(slot.x + 18).toFixed(1)}`,
      class: "c-lens-lead", "data-link": i,
      fill: "none", stroke: tone.line, "stroke-width": tone.solid ? 1.6 : 1.2,
      "stroke-dasharray": tone.solid ? "none" : "2 7",
      opacity: tone.solid ? 0.4 : 0.28,
    }));

    const id = `c-lens-p${i}`;
    const d =
      `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} ` +
      `C ${(from.x + dx * 0.55).toFixed(1)} ${from.y.toFixed(1)}, ` +
      `${(to.x - dx * 0.45).toFixed(1)} ${to.y.toFixed(1)}, ` +
      `${to.x.toFixed(1)} ${to.y.toFixed(1)}`;

    g.appendChild(svg("path", {
      id, d, class: "c-lens-link", "data-link": i,
      fill: "none", stroke: tone.line, "stroke-width": tone.solid ? 2 : 1.4,
      "stroke-linecap": "round",
      "stroke-dasharray": tone.solid ? "none" : "2 7",
      opacity: tone.solid ? 0.85 : 0.5,
    }));

    g.appendChild(svg("circle", {
      class: "c-lens-anchor", "data-link": i,
      cx: to.x.toFixed(1), cy: to.y.toFixed(1), r: tone.solid ? 6 : 4.5,
      fill: tone.solid ? tone.dot : "#ffffff",
      stroke: tone.dot, "stroke-width": 1.6,
    }));

    /* Only the lines that carry weight get a traveller. The motion is the
     * whole point of the picture: you can watch what bears on the reading. */
    if (motion && tone.solid && travellers < 4) {
      /* animateMotion translates from the element's own origin, so a traveller
       * has to sit at (0,0) until its turn comes — which would park a visible
       * dot in the top-left corner. It stays transparent until it starts. */
      const begin = `${(travellers * 0.8).toFixed(1)}s`;
      const dot = svg("circle", { class: "c-lens-mover", r: 3.6, fill: tone.dot, "data-link": i, opacity: 0 });
      dot.appendChild(svg("animate", {
        attributeName: "opacity", from: 0, to: 1, dur: "0.01s", begin, fill: "freeze",
      }));
      const anim = svg("animateMotion", {
        dur: "3.2s", repeatCount: "indefinite", begin,
        keyPoints: "0;1", keyTimes: "0;1", calcMode: "linear",
      });
      const mp = svg("mpath", { href: `#${id}` });
      mp.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${id}`);
      anim.appendChild(mp);
      dot.appendChild(anim);
      g.appendChild(dot);
      travellers++;
    }
  });

  return g;
}

function paintCentre(verdict, s) {
  const c = el("div", "c-lens-centre");
  c.dataset.tone = verdict.tone;
  c.appendChild(el("span", "c-lens-mark", "◎"));
  c.appendChild(el("span", "c-lens-eyebrow", "decision lens"));
  c.appendChild(el("span", "c-lens-label", "The evidence currently reads"));
  c.appendChild(el("strong", "c-lens-word", verdict.word));
  c.appendChild(el("span", "c-lens-rule", verdict.rule));
  c.appendChild(el("p", "c-lens-sub", verdict.sub));

  const figures = s.figures || [];
  const recon = figures.filter((f) => f.reconciled).length;
  const counts = el("div", "c-lens-counts");
  for (const [k, v] of [
    ["reconciled", `${recon}/${figures.length}`],
    ["claims", String(s.claimCount || 0)],
    ["disputed", String(s.disputedCount || 0)],
  ]) {
    const cell = el("span");
    cell.appendChild(el("b", null, v));
    cell.appendChild(el("i", null, k));
    counts.appendChild(cell);
  }
  c.appendChild(counts);
  return c;
}

function paintLegend(items, total) {
  const box = el("aside", "c-lens-legend");
  box.appendChild(el("h3", null, "How to read"));
  const moved = items.filter((x) => (TONE[x.weight] || TONE.cool).solid).length;
  const still = items.length - moved;
  const rows = items.length
    ? [["solid", `${moved} moved the reading`],
       ["dotted", `${still} ${still === 1 ? "was" : "were"} read and changed nothing`]]
    : [["solid", "moved the reading"],
       ["dotted", "read, and changed nothing"]];
  for (const [kind, text] of rows) {
    const r = el("div", "row");
    r.appendChild(el("span", `k ${kind}`));
    r.appendChild(el("span", null, text));
    box.appendChild(r);
  }
  if (total > items.length) {
    box.appendChild(el("p", "note",
      `${items.length} of ${total} drawn: every blocker, then the heaviest of the rest, then one that changed nothing. ` +
      `All ${total} are in the panels below.`));
  } else {
    box.appendChild(el("p", "note",
      "Line colour is the item's own severity. Nothing here is a score, and nothing here is hidden."));
  }
  return box;
}

function paintEmpty(text) {
  const p = el("p", "c-lens-empty", text);
  return p;
}

function paintFoot(s, verdict) {
  const f = el("div", "c-lens-foot");
  const figures = s.figures || [];
  const recon = figures.filter((x) => x.reconciled).length;
  f.appendChild(el("span", null,
    `Derived from the run · ${recon}/${figures.length} figures confirmed by two engines · no invented numbers`));
  f.appendChild(el("span", "r",
    `A reading, not a decision · gate 4 is still a person · run ${String(s.runId || "—").slice(0, 12)}`));
  return f;
}

/* ------------------------------------------------------------------- draw */

function paint() {
  if (!host || !snap) return;
  const s = snap;
  const tabs = buildTabs(s);
  const tab = tabs.find((t) => t.id === activeTab) || tabs[0];
  activeTab = tab.id;
  const verdict = readVerdict(s);
  const shown = selectItems(tab.items, MAX_CARDS);

  host.textContent = "";
  host.dataset.tone = verdict.tone;
  host.appendChild(paintHeader(s, tabs, verdict));

  const stage = el("div", "c-radar");
  stage.appendChild(paintLens(verdict, s));

  const linkLayer = svg("svg", { class: "c-lens-svg links", viewBox: `0 0 ${VB.w} ${VB.h}`, "aria-hidden": "true" });
  linkLayer.appendChild(paintLinks(shown));
  stage.appendChild(linkLayer);

  stage.appendChild(paintCentre(verdict, s));

  const cards = el("div", "c-lens-cards");
  if (!shown.length) {
    cards.appendChild(paintEmpty(
      tab.id === "dissent"
        ? "No seat put a position on the record against another. Which is not the same as agreement — it means nothing was contested."
        : "Nothing in this tab yet. Run the case and the evidence will draw itself in."));
  }
  shown.forEach((item, i) => cards.appendChild(paintCard(item, SLOTS[i], i)));
  stage.appendChild(cards);

  stage.appendChild(paintLegend(shown, tab.items.length));
  host.appendChild(stage);
  host.appendChild(paintFoot(s, verdict));
}

/* -------------------------------------------------------------------- api */

export const Lens = {
  mount(node) {
    host = node;
    host.classList.add("c-lens");
    snap = snap || {};
    paint();
  },

  /* One snapshot in, one picture out. See the header for the shape. */
  render(next) {
    snap = next || {};
    paint();
  },

  /* The reading, without the picture — so the console and the export can say
   * the same thing the lens says. */
  read(next) {
    return readVerdict(next || snap || {});
  },
};
