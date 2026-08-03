/* viz.js — reproducible charts (CONTRACT.md §8). Owner: Agent C.
 *
 * Pure SVG built with explicit node construction. No chart library, no canvas,
 * no innerHTML anywhere near a data value. Three properties matter more than
 * anything cosmetic:
 *
 *   1. DETERMINISM. build() is a pure function of (spec, rows). It produces a
 *      node tree that is emitted two ways — to the DOM (render) and to a
 *      string (toSvgString) — from the same geometry, in the same order, with
 *      the same rounding. Same input, byte-identical SVG, forever. Nothing in
 *      this file reads the clock, the network, Math.random, or the DOM's
 *      measurement APIs. Every id is derived from spec.chartId.
 *   2. AXIS HONESTY. y.zero defaults true for the bar family (and for percent
 *      axes). A caller may still truncate, but never silently: a truncated
 *      value axis draws a visible break marker on the axis, a warn-coloured
 *      caption, and reports itself through the returned metadata so the app
 *      can raise a `viz` finding. No dual axes, ever — a spec asking for one
 *      throws.
 *   3. NO INVENTED NUMBERS. The only arithmetic here is layout arithmetic.
 *      The one exception is the waterfall's closing bar, which is a display
 *      sum of the caller's own values; it is flagged `derivedEndTotal` in the
 *      metadata, and when the caller supplies its own end total that does not
 *      match the bridge, the residual is reported rather than hidden.
 *
 * Contract reading, where §8 is thin:
 *   - `render` returns the SVGElement, as specified. The metadata object is
 *     additionally attached as `svg.vizMeta` and available as a pure call,
 *     `Viz.meta(spec, rows)`, so the app can raise findings without parsing
 *     the picture.
 *   - `x.type: 'time'` is laid out ordinally, in the row order the caller
 *     supplied. Parsing dates to lay them out proportionally would make the
 *     picture depend on a date parser; ordinal placement is the reproducible
 *     reading. `x.type: 'linear'` does get a true numeric axis.
 */
"use strict";

import { U } from "./util.js";

const SVGNS = "http://www.w3.org/2000/svg";

/* Palette — exactly the seven the contract lists. Nothing added. */
export const PALETTE = Object.freeze({
  ink: "#14120e",
  accent: "#2547c9",
  prior: "#9aa3b2",
  ok: "#1d7a4d",
  warn: "#9a6a00",
  err: "#b3372c",
  grid: "#e8e6e0",
});
const P = PALETTE;
const PAPER = "#ffffff";

const KINDS = ["line", "bar", "grouped-bar", "stacked-bar", "waterfall", "dot", "heatmap", "area"];
const BAR_FAMILY = new Set(["bar", "grouped-bar", "stacked-bar", "waterfall"]);

/* Logical drawing space. Everything scales from the viewBox; the injected
 * stylesheet caps the rendered width so the type never balloons. */
const W = 480;
const PADX = 10;
const FS = { title: 16, sub: 11.5, legend: 11.5, tick: 11, xtick: 10.5, axis: 11, note: 10.5, value: 9.5 };
const CHAR_W = 0.55;             // average advance of the UI face, in em
const PLOT_H = 190;
const HEAT_ROW = 26;
const TICK_TARGET = 5;

/* ------------------------------------------------------------------ nodes */
/* A tiny immutable node tree. `raw` carries module-authored CSS only — it is
 * never used for anything derived from a spec or a row. */

const h = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: kids || [] });
const txt = (s) => ({ text: String(s == null ? "" : s) });
const raw = (s) => ({ raw: String(s) });
const esc = U.escapeHtml;

function ser(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(ser).join("");
  if (node.raw !== undefined) return node.raw;
  if (node.text !== undefined) return esc(node.text);
  let s = "<" + node.tag;
  for (const k of Object.keys(node.attrs)) {
    const v = node.attrs[k];
    if (v == null) continue;
    s += ` ${k}="${esc(v)}"`;
  }
  const kids = flat(node.kids);
  if (!kids.length) return s + "/>";
  return s + ">" + kids.map(ser).join("") + "</" + node.tag + ">";
}

function toDom(node, doc) {
  if (node.raw !== undefined) return doc.createTextNode(node.raw);
  if (node.text !== undefined) return doc.createTextNode(node.text);
  const e = doc.createElementNS(SVGNS, node.tag);
  for (const k of Object.keys(node.attrs)) {
    const v = node.attrs[k];
    if (v == null || k === "xmlns") continue;   // namespace is implied by createElementNS
    e.setAttribute(k, String(v));
  }
  for (const c of flat(node.kids)) e.appendChild(toDom(c, doc));
  return e;
}

function flat(kids) {
  const out = [];
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) out.push(...flat(k));
    else out.push(k);
  }
  return out;
}

/* ------------------------------------------------------- numbers and text */

/* Fixed 2-decimal coordinate rounding: the whole reason two runs agree. */
function fx(n) {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const textW = (s, fs) => String(s).length * fs * CHAR_W;

function trunc(s, chars) {
  const v = String(s == null ? "" : s);
  return v.length <= chars ? v : v.slice(0, Math.max(1, chars - 1)) + "…";
}

function wrap(s, maxW, fs, maxLines) {
  const words = String(s == null ? "" : s).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (cur && textW(next, fs) > maxW) { lines.push(cur); cur = w; } else cur = next;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && cur && lines[maxLines - 1] !== cur) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = trunc(last + " " + cur, Math.floor(maxW / (fs * CHAR_W)));
  }
  return lines.length ? lines : [""];
}

const decimalsFor = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

function formatter(format, step) {
  const d = decimalsFor(step);
  if (format === "pct") return (v) => U.fmt.pct(v, decimalsFor(step * 100));
  if (format === "money") return (v) => U.fmt.money(v, "USD", d);
  if (format === "compact") return (v) => U.fmt.compact(v, 1);
  return (v) => U.fmt.n(v, d);
}

const slug = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "chart";

/* -------------------------------------------------------------- scales */

function niceScale(lo, hi, count) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 1; lo -= pad; hi += pad; }
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  const rawStep = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const d0 = Math.floor(lo / step + 1e-9) * step;
  const d1 = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  const n = Math.round((d1 - d0) / step);
  for (let i = 0; i <= n; i++) ticks.push(Number((d0 + i * step).toFixed(10)));
  return { min: Number(d0.toFixed(10)), max: Number(d1.toFixed(10)), step, ticks };
}

/* ------------------------------------------------------------ colouring */

const PRIOR_RE = /(prior|previous|last[\s_-]?year|baseline|benchmark|\bpy\b|\bly\b)/i;
const CURRENT_RE = /(current|actual|this[\s_-]?year|\bytd\b|latest)/i;
const BASE_COLORS = [P.accent, P.prior, P.ink];
const DASHES = [null, null, null, "7 3", "2 3", "9 3 2 3"];

function colorSeries(list) {
  const assigned = new Array(list.length).fill(null);
  const used = new Set();
  list.forEach((s, i) => {
    const label = `${s.label || ""} ${s.field || ""}`;
    let c = null;
    if (PRIOR_RE.test(label)) c = P.prior;
    else if (CURRENT_RE.test(label)) c = P.accent;
    if (c && !used.has(c)) { assigned[i] = c; used.add(c); }
  });
  let next = 0;
  for (let i = 0; i < list.length; i++) {
    if (assigned[i]) continue;
    while (next < BASE_COLORS.length && used.has(BASE_COLORS[next])) next++;
    const c = next < BASE_COLORS.length ? BASE_COLORS[next] : P.ink;
    assigned[i] = c;
    used.add(c);
    next++;
  }
  return list.map((s, i) => ({ ...s, color: assigned[i], dash: DASHES[i] || "3 3" }));
}

function mix(a, b, t) {
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const k = Math.max(0, Math.min(1, t));
  const c = (x, y) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/* ------------------------------------------------------ spec validation */

function normalize(spec) {
  if (!spec || typeof spec !== "object") throw new Error("viz: a ChartSpec is required");
  const kind = String(spec.kind || "");
  if (!KINDS.includes(kind)) throw new Error(`viz: unknown chart kind "${kind}"`);
  if (!spec.x || !spec.x.field) throw new Error("viz: spec.x.field is required");
  if (!spec.y || !spec.y.field) throw new Error("viz: spec.y.field is required");

  /* No dual axes. Ever. Refuse loudly rather than draw a lie. */
  if (Array.isArray(spec.y)) throw new Error("viz: dual axes are not permitted (spec.y must be a single axis)");
  if (spec.y2 || spec.yRight || spec.secondaryAxis) throw new Error("viz: dual axes are not permitted (spec.y2)");
  if (Array.isArray(spec.axes) && spec.axes.length > 1) throw new Error("viz: dual axes are not permitted (spec.axes)");
  for (const s of spec.series || []) {
    if (s && (s.axis === "right" || s.axis === "y2" || s.yAxis === 2 || s.secondary === true)) {
      throw new Error(`viz: dual axes are not permitted (series "${s.field}" asks for a second axis)`);
    }
  }

  const x = { field: String(spec.x.field), label: String(spec.x.label || spec.x.field), type: spec.x.type || "category" };
  const format = ["n", "pct", "money", "compact"].includes(spec.y.format) ? spec.y.format : "n";
  const y = { field: String(spec.y.field), label: String(spec.y.label || spec.y.field), format, zero: spec.y.zero };
  return {
    chartId: String(spec.chartId || "chart"),
    kind,
    title: String(spec.title || ""),
    subtitle: spec.subtitle ? String(spec.subtitle) : "",
    x, y,
    series: Array.isArray(spec.series) ? spec.series.filter((s) => s && s.field).map((s) => ({ field: String(s.field), label: String(s.label || s.field) })) : null,
    annotations: Array.isArray(spec.annotations) ? spec.annotations.filter((a) => a && a.at != null) : [],
    sourceNote: String(spec.sourceNote || ""),
    specHash: String(spec.specHash || ""),
  };
}

/* ------------------------------------------------------- the stylesheet */
/* Constant, module-authored, and shipped INSIDE every svg so an exported
 * chart carries its own typography, its own motion, and its own
 * reduced-motion opt-out with no external file. */

const SVG_CSS = [
  "svg.cviz{width:100%;height:auto;max-width:640px;display:block;margin:0 auto;background:#ffffff}",
  "svg.cviz text{font-family:'Pixelify Sans','Segoe UI',sans-serif;fill:#14120e}",
  ".cv-title{font-size:16px;letter-spacing:.01em}",
  ".cv-sub{font-size:11.5px;fill:#6b6459}",
  ".cv-legend{font-size:11.5px}",
  ".cv-tick{font-size:11px;fill:#6b6459;font-variant-numeric:tabular-nums}",
  ".cv-xtick{font-size:10.5px;fill:#6b6459}",
  ".cv-axis{font-size:11px;fill:#6b6459;letter-spacing:.04em;text-transform:uppercase}",
  ".cv-note{font-size:10.5px;fill:#6b6459}",
  ".cv-val{font-size:9.5px;font-variant-numeric:tabular-nums}",
  ".cv-break{font-size:10px;fill:#9a6a00;letter-spacing:.03em}",
  "@keyframes cv-draw{from{stroke-dashoffset:var(--l,0)}to{stroke-dashoffset:0}}",
  "@keyframes cv-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}",
  "@keyframes cv-fade{from{opacity:0}to{opacity:1}}",
  ".cv-a-draw{animation:cv-draw .9s steps(18,end) both}",
  ".cv-a-up{transform-box:fill-box;transform-origin:50% 100%;animation:cv-rise .42s steps(6,end) both}",
  ".cv-a-dn{transform-box:fill-box;transform-origin:50% 0;animation:cv-rise .42s steps(6,end) both}",
  ".cv-a-fade{animation:cv-fade .5s steps(4,end) both}",
  "@media (max-width:560px){.cv-tick{font-size:13.5px}.cv-note{font-size:13px}.cv-legend{font-size:13.5px}}",
  "@media (prefers-reduced-motion:reduce){.cv-a-draw,.cv-a-up,.cv-a-dn,.cv-a-fade{animation:none;stroke-dashoffset:0;transform:none;opacity:1}}",
].join("");

const DOC_CSS = [
  ".cviz-fig{margin:0}",
  ".cviz-svg{display:block;width:100%;height:auto;max-width:640px;margin:0 auto}",
  ".cviz-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;",
  "clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}",
].join("");

let cssInjected = false;
function injectCss(doc) {
  if (cssInjected || !doc || !doc.head) return;
  if (doc.getElementById && doc.getElementById("cviz-css")) { cssInjected = true; return; }
  const st = doc.createElement("style");
  st.id = "cviz-css";
  st.textContent = DOC_CSS;
  doc.head.appendChild(st);
  cssInjected = true;
}

/* ------------------------------------------------------------ primitives */

const line = (x1, y1, x2, y2, stroke, wdt, dash, cls) =>
  h("line", { x1: fx(x1), y1: fx(y1), x2: fx(x2), y2: fx(y2), stroke, "stroke-width": fx(wdt), "stroke-dasharray": dash || null, class: cls || null, "shape-rendering": dash ? null : "crispEdges" });

const rect = (x, y, w, ht, fill, extra) =>
  h("rect", { x: fx(x), y: fx(y), width: fx(Math.max(0, w)), height: fx(Math.max(0, ht)), fill, ...(extra || {}) });

const label = (x, y, s, cls, anchor, extra) =>
  h("text", { x: fx(x), y: fx(y), class: cls, "text-anchor": anchor || "start", ...(extra || {}) }, [txt(s)]);

const delay = (i) => ({ style: `animation-delay:${fx(Math.min(0.5, i * 0.03))}s` });

/* ============================================================= the build */

function build(spec, rows) {
  const S = normalize(spec);
  const data = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const id = "cv-" + slug(S.chartId);
  const meta = {
    chartId: S.chartId, specHash: S.specHash, kind: S.kind,
    rowCount: data.length, seriesCount: 0,
    yDomain: null, yZero: true, axisBreak: false,
    findings: [],
  };
  const flag = (severity, title, detail) => meta.findings.push({ severity, title, detail });

  /* --- series ---------------------------------------------------------- */
  let series = S.series && S.series.length ? S.series : [{ field: S.y.field, label: S.y.label }];
  if (S.kind === "bar" || S.kind === "area" || S.kind === "waterfall") series = series.slice(0, 1);
  series = colorSeries(series);
  meta.seriesCount = series.length;

  /* --- categories ------------------------------------------------------ */
  const baseCats = data.map((r, i) => (r[S.x.field] == null ? String(i + 1) : String(r[S.x.field])));
  const linearX = S.x.type === "linear" && ["line", "area", "dot"].includes(S.kind) &&
    data.every((r) => num(r[S.x.field]) !== null);

  /* --- per-kind preparation (values + extents) ------------------------- */
  /* A kind may restate the category list — the waterfall does, because a
   * derived closing total is a band that has no row behind it. */
  const prep = prepare(S, data, series, baseCats, meta, flag);
  const cats = prep.cats || baseCats;

  /* --- y domain -------------------------------------------------------- */
  const zeroRequested = S.y.zero === undefined || S.y.zero === null
    ? (BAR_FAMILY.has(S.kind) || S.y.format === "pct")
    : S.y.zero !== false;
  let lo = prep.min, hi = prep.max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (zeroRequested) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (!zeroRequested && lo === hi) hi = lo + Math.abs(lo || 1) * 0.1;
  const scale = S.kind === "heatmap" ? null : niceScale(lo, hi, TICK_TARGET);

  if (scale) {
    meta.yDomain = [scale.min, scale.max];
    meta.yZero = scale.min <= 0 && scale.max >= 0;
    /* A value axis that excludes zero is truncated. Allowed — never silent. */
    if (!meta.yZero) {
      meta.axisBreak = true;
      flag("major",
        "Value axis does not include zero",
        `Chart "${S.title || S.chartId}" (${S.kind}) plots ${S.y.label} from ${scale.min} to ${scale.max}. ` +
        "Differences are visually exaggerated relative to their share of the total. A break marker is drawn on the axis.");
    }
    if (BAR_FAMILY.has(S.kind) && S.y.zero === false) {
      flag("blocker",
        "Bar chart requested a non-zero baseline",
        "Bar length encodes magnitude, so a truncated baseline misstates ratios between bars. The spec set y.zero = false explicitly.");
    }
  }

  /* --- layout ---------------------------------------------------------- */
  const fmtV = formatter(S.y.format, scale ? scale.step : 1);
  const tickLabels = scale ? scale.ticks.map(fmtV) : [];
  const heat = S.kind === "heatmap";
  const gutterText = heat
    ? Math.max(0, ...series.map((s) => textW(trunc(s.label, 18), FS.tick)))
    : Math.max(0, ...tickLabels.map((t) => textW(t, FS.tick * 1.25)));   // headroom for the small-screen bump
  const mL = Math.max(38, Math.min(150, Math.ceil(gutterText) + (heat ? 10 : 10) + (heat ? 0 : 16)));
  const mR = 14;
  const plotL = mL, plotR = W - mR, plotW = plotR - plotL;

  let y = 8;
  const head = [];
  if (S.title) {
    for (const ln of wrap(S.title, W - 2 * PADX, FS.title, 2)) {
      y += FS.title;
      head.push(label(PADX, y, ln, "cv-title"));
      y += 3;
    }
  }
  if (S.subtitle) {
    for (const ln of wrap(S.subtitle, W - 2 * PADX, FS.sub, 2)) {
      y += FS.sub;
      head.push(label(PADX, y, ln, "cv-sub"));
      y += 2;
    }
  }

  /* legend */
  const legendItems = prep.legend || (series.length > 1 ? series.map((s) => ({ label: s.label, color: s.color })) : []);
  if (legendItems.length) {
    y += 6;
    let lx = PADX, rowTop = y;
    for (const it of legendItems) {
      const wLab = textW(trunc(it.label, 26), FS.legend);
      if (lx > PADX && lx + 12 + wLab > W - PADX) { lx = PADX; rowTop += 15; }
      head.push(rect(lx, rowTop + 2, 9, 9, it.color, { class: "cv-a-fade" }));
      head.push(label(lx + 13, rowTop + 10, trunc(it.label, 26), "cv-legend"));
      lx += 13 + wLab + 12;
    }
    y = rowTop + 13;
  }

  const plotT = y + 8;
  const plotH = heat ? Math.max(HEAT_ROW, series.length * HEAT_ROW) : PLOT_H;
  const plotB = plotT + plotH;

  /* x tick geometry */
  const band = cats.length ? plotW / cats.length : plotW;
  const xLabels = cats.map((c) => trunc(c, 14));
  const maxLab = Math.max(0, ...xLabels.map((l) => textW(l, FS.xtick)));
  const rotate = !linearX && cats.length > 0 && maxLab > band - 3 && band < 64;
  let step = 1;
  if (!linearX && cats.length) {
    const need = rotate ? FS.xtick * 1.15 : maxLab + 8;
    step = Math.max(1, Math.ceil(need / Math.max(0.001, band)));
  }
  const xBlock = cats.length === 0 ? 6 : rotate ? Math.min(46, Math.ceil(Math.sin(0.6109) * maxLab) + 8) : FS.xtick + 6;
  const xAxisLabelY = plotB + xBlock + FS.axis + 4;
  let cursor = xAxisLabelY + 6;

  const noteLines = S.sourceNote ? wrap(S.sourceNote, W - 2 * PADX, FS.note, 3) : [];
  const noteTop = cursor + 6;
  const H = Math.ceil(noteTop + noteLines.length * (FS.note + 3) + 10);

  /* --- scales ---------------------------------------------------------- */
  const yOf = scale
    ? (v) => plotB - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH
    : () => plotB;
  const xDomain = linearX ? niceScale(
    Math.min(...data.map((r) => num(r[S.x.field]))),
    Math.max(...data.map((r) => num(r[S.x.field]))), 5) : null;
  const xOf = linearX
    ? (v) => plotL + ((v - xDomain.min) / (xDomain.max - xDomain.min || 1)) * plotW
    : (i) => plotL + band * (i + 0.5);
  const zeroY = scale ? yOf(Math.max(scale.min, Math.min(0, scale.max))) : plotB;

  /* --- grid + axes ----------------------------------------------------- */
  const grid = [];
  if (scale) {
    for (const t of scale.ticks) {
      const gy = yOf(t);
      const isZero = U.closeTo(t, 0, 1e-12);
      grid.push(line(plotL, gy, plotR, gy, isZero ? P.ink : P.grid, isZero ? 1.2 : 1));
      grid.push(label(plotL - 7, gy + 3.5, fmtV(t), "cv-tick", "end"));
    }
  } else {
    series.forEach((s, i) => grid.push(label(plotL - 7, plotT + i * HEAT_ROW + HEAT_ROW / 2 + 3.5, trunc(s.label, 18), "cv-tick", "end")));
  }
  grid.push(line(plotL, plotT, plotL, plotB, P.ink, 1));
  grid.push(line(plotL, plotB, plotR, plotB, P.ink, 1));

  /* x ticks */
  const xticks = [];
  if (linearX) {
    for (const t of xDomain.ticks) {
      const tx = xOf(t);
      if (tx < plotL - 0.5 || tx > plotR + 0.5) continue;
      xticks.push(line(tx, plotB, tx, plotB + 3, P.ink, 1));
      xticks.push(label(tx, plotB + FS.xtick + 4, U.fmt.n(t, decimalsFor(xDomain.step)), "cv-xtick", "middle"));
    }
  } else {
    cats.forEach((c, i) => {
      if (i % step !== 0 && i !== cats.length - 1) return;
      if (step > 1 && i === cats.length - 1 && (cats.length - 1) % step !== 0 && band * ((cats.length - 1) % step) < maxLab) return;
      const cx = xOf(i);
      const lab = rotate ? trunc(c, 12) : xLabels[i];
      xticks.push(rotate
        ? h("text", { x: fx(cx - 2), y: fx(plotB + 9), class: "cv-xtick", "text-anchor": "end", transform: `rotate(-35 ${fx(cx - 2)} ${fx(plotB + 9)})` }, [txt(lab)])
        : label(cx, plotB + FS.xtick + 4, lab, "cv-xtick", "middle"));
    });
  }

  /* --- marks ----------------------------------------------------------- */
  const ctx = { S, data, series, cats, meta, flag, plotL, plotR, plotT, plotB, plotW, plotH, band, xOf, yOf, zeroY, scale, fmtV, linearX };
  const marks = prep.draw(ctx);

  /* --- annotations ----------------------------------------------------- */
  const anns = [];
  for (const a of S.annotations) {
    const idx = linearX ? null : cats.indexOf(String(a.at));
    const ax = linearX && num(a.at) !== null ? xOf(num(a.at)) : (idx >= 0 ? xOf(idx) : null);
    if (ax == null) continue;
    const kind = a.kind || "line";
    if (kind === "band") {
      anns.push(rect(ax - band / 2, plotT, band, plotH, P.accent, { opacity: "0.07" }));
    } else if (kind === "point") {
      anns.push(h("circle", { cx: fx(ax), cy: fx(zeroY), r: "3.5", fill: PAPER, stroke: P.ink, "stroke-width": "1.4" }));
    } else {
      anns.push(line(ax, plotT, ax, plotB, P.ink, 1, "3 3"));
    }
    if (a.label) anns.push(label(ax + 3, plotT + 10, trunc(a.label, 22), "cv-xtick"));
  }

  /* --- axis break marker ----------------------------------------------- */
  const breakNodes = [];
  if (meta.axisBreak) {
    const by = plotB - 10;
    const zig = (dy) => `M ${fx(plotL - 7)} ${fx(by + dy + 5)} L ${fx(plotL - 1)} ${fx(by + dy)} L ${fx(plotL + 5)} ${fx(by + dy + 5)} L ${fx(plotL + 11)} ${fx(by + dy)}`;
    breakNodes.push(h("path", { d: zig(0), fill: "none", stroke: PAPER, "stroke-width": "5" }));
    breakNodes.push(h("path", { d: zig(-4), fill: "none", stroke: PAPER, "stroke-width": "5" }));
    breakNodes.push(h("path", { d: zig(0), fill: "none", stroke: P.warn, "stroke-width": "1.4" }));
    breakNodes.push(h("path", { d: zig(-4), fill: "none", stroke: P.warn, "stroke-width": "1.4" }));
    breakNodes.push(label(plotR, plotT - 4, "⚠ axis truncated — not zero-based", "cv-break", "end"));
  }

  /* --- footer ---------------------------------------------------------- */
  const foot = [];
  if (S.y.label && !heat) {
    const cy = (plotT + plotB) / 2;
    foot.push(h("text", { x: fx(12), y: fx(cy), class: "cv-axis", "text-anchor": "middle", transform: `rotate(-90 ${fx(12)} ${fx(cy)})` }, [txt(trunc(S.y.label, 28))]));
  }
  if (S.x.label) foot.push(label((plotL + plotR) / 2, xAxisLabelY, trunc(S.x.label, 40), "cv-axis", "middle"));
  noteLines.forEach((ln, i) => foot.push(label(PADX, noteTop + (i + 1) * (FS.note + 3) - 3, ln, "cv-note")));

  if (!data.length) {
    marks.push(label((plotL + plotR) / 2, (plotT + plotB) / 2, "no rows for this chart", "cv-tick", "middle"));
    flag("note", "Chart has no rows", `Chart "${S.title || S.chartId}" rendered with an empty row set.`);
  }
  if (!S.sourceNote) {
    flag("major", "Chart has no source note",
      `Chart "${S.title || S.chartId}" was rendered without spec.sourceNote, so the picture carries no provenance line.`);
  }
  if (BAR_FAMILY.has(S.kind) && cats.length && band < 3) {
    flag("minor", "Too many categories to read",
      `${cats.length} categories at ${fx(band)} units of width each. Bars are narrower than their own outline.`);
  }

  /* --- assemble -------------------------------------------------------- */
  meta.width = W;
  meta.height = H;
  const desc = describe(S, series, cats, scale, meta);
  const root = h("svg", {
    xmlns: SVGNS,
    class: "cviz cviz-svg",
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-labelledby": `${id}-t ${id}-d`,
    "data-chart-id": S.chartId,
    "data-spec-hash": S.specHash || null,
    "data-kind": S.kind,
  }, [
    h("title", { id: `${id}-t` }, [txt(S.title || S.chartId)]),
    h("desc", { id: `${id}-d` }, [txt(desc)]),
    h("style", {}, [raw(SVG_CSS)]),
    rect(0, 0, W, H, PAPER),
    h("g", { class: "cv-head" }, head),
    h("g", { class: "cv-grid" }, grid),
    h("g", { class: "cv-marks" }, marks),
    h("g", { class: "cv-xticks" }, xticks),
    h("g", { class: "cv-ann" }, anns),
    h("g", { class: "cv-break-g" }, breakNodes),
    h("g", { class: "cv-foot" }, foot),
  ]);

  return { root, meta, table: tableModel(S, data, series, cats, prep) };
}

/* ------------------------------------------------------------- describe */

function describe(S, series, cats, scale, meta) {
  const bits = [`${S.kind.replace("-", " ")} chart.`];
  bits.push(`${cats.length} ${cats.length === 1 ? "category" : "categories"} on ${S.x.label}`);
  if (cats.length) bits[bits.length - 1] += `, from ${trunc(cats[0], 24)} to ${trunc(cats[cats.length - 1], 24)}`;
  bits[bits.length - 1] += ".";
  if (scale) {
    bits.push(`${S.y.label} runs ${scale.min} to ${scale.max}${meta.yZero ? ", zero baseline included" : ", ZERO EXCLUDED — axis truncated"}.`);
  }
  if (series.length > 1) bits.push(`Series: ${series.map((s) => s.label).join(", ")}.`);
  const period = (s) => (/[.!?]$/.test(s) ? s : s + ".");
  if (S.subtitle) bits.push(period(S.subtitle));
  if (S.sourceNote) bits.push(period(S.sourceNote));
  return bits.join(" ");
}

/* --------------------------------------------------------- table model */

function tableModel(S, data, series, cats, prep) {
  if (prep.table) return prep.table;
  return {
    caption: S.title || S.chartId,
    columns: [S.x.label, ...series.map((s) => s.label)],
    rows: data.map((r, i) => [cats[i], ...series.map((s) => {
      const v = num(r[s.field]);
      return v == null ? "" : String(v);
    })]),
  };
}

/* ====================================================== kind preparation */
/* Each returns { min, max, draw(ctx) -> nodes[], legend?, table? }. Extents
 * are computed before layout so the axis can be sized; draw() runs after. */

function prepare(S, data, series, cats, meta, flag) {
  switch (S.kind) {
    case "line": case "area": return prepLine(S, data, series, flag);
    case "bar": case "grouped-bar": return prepBars(S, data, series, flag);
    case "stacked-bar": return prepStacked(S, data, series, flag);
    case "waterfall": return prepWaterfall(S, data, meta, flag);
    case "dot": return prepDot(S, data, series, flag);
    case "heatmap": return prepHeat(S, data, series, cats, flag);
    default: throw new Error(`viz: unhandled kind "${S.kind}"`);
  }
}

function extent(values) {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v == null) continue; if (v < min) min = v; if (v > max) max = v; }
  if (min === Infinity) { min = 0; max = 1; }
  return { min, max };
}

function countGaps(S, data, series, flag) {
  for (const s of series) {
    const missing = data.reduce((n, r) => n + (num(r[s.field]) === null ? 1 : 0), 0);
    if (missing) {
      flag("minor", "Series has missing values",
        `"${s.label}" is missing ${missing} of ${data.length} values; the line breaks rather than interpolating across them.`);
    }
  }
}

/* ---- line / area ----------------------------------------------------- */

function prepLine(S, data, series, flag) {
  countGaps(S, data, series, flag);
  const all = [];
  for (const s of series) for (const r of data) all.push(num(r[s.field]));
  const e = extent(all);
  return {
    ...e,
    draw(ctx) {
      const out = [];
      const area = S.kind === "area";
      series.forEach((s, si) => {
        const pts = data.map((r, i) => {
          const v = num(r[s.field]);
          return v == null ? null : { x: ctx.linearX ? ctx.xOf(num(r[S.x.field])) : ctx.xOf(i), y: ctx.yOf(v), v };
        });
        const runs = [];
        let cur = [];
        for (const p of pts) { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
        if (cur.length) runs.push(cur);

        if (area && si === 0) {
          for (const run of runs) {
            const d = run.map((p, i) => `${i ? "L" : "M"} ${fx(p.x)} ${fx(p.y)}`).join(" ") +
              ` L ${fx(run[run.length - 1].x)} ${fx(ctx.zeroY)} L ${fx(run[0].x)} ${fx(ctx.zeroY)} Z`;
            out.push(h("path", { d, fill: s.color, opacity: "0.12", class: "cv-a-fade" }));
          }
        }
        let len = 0, d = "";
        for (const run of runs) {
          d += run.map((p, i) => `${i ? "L" : "M"} ${fx(p.x)} ${fx(p.y)}`).join(" ") + " ";
          for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
        }
        if (d) {
          out.push(h("path", {
            d: d.trim(), fill: "none", stroke: s.color, "stroke-width": si === 0 ? "2" : "1.6",
            "stroke-linejoin": "round", "stroke-linecap": "round",
            "stroke-dasharray": si > 2 ? s.dash : fx(Math.max(1, len)),
            class: si > 2 ? "cv-a-fade" : "cv-a-draw",
            style: si > 2 ? null : `--l:${fx(Math.max(1, len))}`,
          }));
        }
        if (data.length <= 24) {
          for (const run of runs) for (const p of run) {
            out.push(h("circle", { cx: fx(p.x), cy: fx(p.y), r: si === 0 ? "2.6" : "2.2", fill: PAPER, stroke: s.color, "stroke-width": "1.4", class: "cv-a-fade" }));
          }
        }
      });
      return out;
    },
  };
}

/* ---- bar / grouped-bar ------------------------------------------------ */

function prepBars(S, data, series, flag) {
  const all = [];
  for (const s of series) for (const r of data) all.push(num(r[s.field]));
  const e = extent(all);
  return {
    ...e,
    draw(ctx) {
      const out = [];
      const n = series.length;
      const gap = Math.min(6, ctx.band * 0.18);
      const groupW = Math.max(1, ctx.band - gap);
      const barW = Math.max(0.6, groupW / n);
      const showVals = data.length * n <= 14 && ctx.band > 26;
      data.forEach((r, i) => {
        const x0 = ctx.plotL + ctx.band * i + gap / 2;
        series.forEach((s, si) => {
          const v = num(r[s.field]);
          if (v == null) return;
          const yv = ctx.yOf(v), y0 = ctx.zeroY;
          const top = Math.min(yv, y0), hgt = Math.abs(yv - y0);
          out.push(rect(x0 + si * barW, top, Math.max(0.6, barW - (n > 1 ? 1 : 0)), hgt, s.color, {
            class: v >= 0 ? "cv-a-up" : "cv-a-dn", ...delay(i * n + si),
          }));
          if (showVals) {
            out.push(label(x0 + si * barW + barW / 2, v >= 0 ? top - 4 : top + hgt + 9, ctx.fmtV(v), "cv-val", "middle", { fill: P.ink }));
          }
        });
      });
      return out;
    },
  };
}

/* ---- stacked-bar ------------------------------------------------------ */

function prepStacked(S, data, series, flag) {
  let min = 0, max = 0;
  const stacks = data.map((r) => {
    let up = 0, dn = 0;
    const parts = series.map((s) => {
      const v = num(r[s.field]) || 0;
      const base = v >= 0 ? up : dn;
      if (v >= 0) up += v; else dn += v;
      return { v, from: base, to: base + v, color: s.color, label: s.label };
    });
    if (up > max) max = up;
    if (dn < min) min = dn;
    return parts;
  });
  return {
    min, max,
    draw(ctx) {
      const out = [];
      const gap = Math.min(6, ctx.band * 0.18);
      const barW = Math.max(0.6, ctx.band - gap);
      stacks.forEach((parts, i) => {
        const x0 = ctx.plotL + ctx.band * i + gap / 2;
        parts.forEach((p, si) => {
          if (p.v === 0) return;
          const a = ctx.yOf(p.from), b = ctx.yOf(p.to);
          out.push(rect(x0, Math.min(a, b), barW, Math.abs(a - b), p.color, {
            class: p.v >= 0 ? "cv-a-up" : "cv-a-dn", ...delay(i), stroke: PAPER, "stroke-width": "0.6",
          }));
        });
      });
      return out;
    },
  };
}

/* ---- waterfall -------------------------------------------------------- */
/* The demand bridge: a start total, signed contributions, an end total.
 * Totals are drawn from zero; contributions float on the running balance and
 * are connected by hairlines. Sign drives colour — that is real state, not
 * decoration. If the caller supplies its own end total and the bridge does
 * not close to it, the residual is reported instead of being papered over. */

function prepWaterfall(S, data, meta, flag) {
  const xf = S.x.field, yf = S.y.field;
  const isTotal = (r) => r.total === true || r.isTotal === true || r.kind === "total" || r.type === "total" ||
    r.role === "total" || r.step === "total";
  const steps = data.map((r, i) => ({
    label: r[xf] == null ? String(i + 1) : String(r[xf]),
    value: num(r[yf]) || 0,
    total: isTotal(r),
  }));
  if (steps.length && !steps.some((s) => s.total)) steps[0].total = true;   // first row is the opening balance

  const bars = [];
  let run = 0, start = null, deltas = 0;
  steps.forEach((s) => {
    if (s.total) {
      bars.push({ label: s.label, value: s.value, from: 0, to: s.value, total: true });
      if (start === null) start = s.value;
      run = s.value;
    } else {
      bars.push({ label: s.label, value: s.value, from: run, to: run + s.value, total: false });
      run += s.value;
      deltas += s.value;
    }
  });

  const last = steps[steps.length - 1];
  if (steps.length && !last.total) {
    bars.push({ label: "Total", value: run, from: 0, to: run, total: true, derived: true });
    meta.derivedEndTotal = true;
  } else if (steps.length > 1 && last.total && start !== null) {
    const expected = start + deltas;
    const residual = last.value - expected;
    meta.bridgeStart = start;
    meta.bridgeEnd = last.value;
    meta.bridgeResidual = residual;
    if (!U.closeTo(last.value, expected, 1e-9)) {
      flag("blocker", "Waterfall does not close",
        `Start ${start} plus contributions ${deltas} gives ${expected}, but the supplied end total is ${last.value} ` +
        `(residual ${residual}). The bridge is missing a contribution or double-counts one.`);
    }
  }

  const vals = [0];
  for (const b of bars) { vals.push(b.from, b.to); }
  const e = extent(vals);

  return {
    ...e,
    cats: bars.map((b) => b.label),
    legend: [
      { label: "total", color: P.ink },
      { label: "increase", color: P.ok },
      { label: "decrease", color: P.err },
    ],
    table: {
      caption: S.title || S.chartId,
      columns: [S.x.label, S.y.label, "role", "running"],
      rows: bars.map((b) => [b.label, String(b.value), b.total ? (b.derived ? "total (derived)" : "total") : (b.value >= 0 ? "increase" : "decrease"), String(b.to)]),
    },
    draw(ctx) {
      const out = [];
      const band = ctx.band;                      // shared with the x axis: one band, one label
      const gap = Math.min(8, band * 0.24);
      const barW = Math.max(1, band - gap);
      const showVals = bars.length <= 12 && barW > 20;
      bars.forEach((b, i) => {
        const x0 = ctx.plotL + band * i + gap / 2;
        const a = ctx.yOf(b.from), c = ctx.yOf(b.to);
        const top = Math.min(a, c), hgt = Math.max(0.8, Math.abs(a - c));
        const color = b.total ? P.ink : (b.value > 0 ? P.ok : b.value < 0 ? P.err : P.prior);
        out.push(rect(x0, top, barW, hgt, color, {
          class: b.to >= b.from ? "cv-a-up" : "cv-a-dn", ...delay(i),
          ...(b.derived ? { opacity: "0.82", stroke: P.ink, "stroke-width": "1", "stroke-dasharray": "3 2" } : {}),
        }));
        if (i < bars.length - 1) {
          const cy = ctx.yOf(b.to);               // the running balance carried into the next step
          out.push(line(x0 + barW, cy, ctx.plotL + band * (i + 1) + gap / 2, cy, P.ink, 1, "3 2", "cv-a-fade"));
        }
        if (showVals) {
          const text = b.total ? ctx.fmtV(b.value) : (b.value > 0 ? "+" : b.value < 0 ? "−" : "") + ctx.fmtV(Math.abs(b.value));
          const up = b.to >= b.from;
          out.push(label(x0 + barW / 2, up ? top - 4 : top + hgt + 9, text, "cv-val", "middle", { fill: color }));
        }
      });
      return out;
    },
  };
}

/* ---- dot -------------------------------------------------------------- */

function prepDot(S, data, series, flag) {
  countGaps(S, data, series, flag);
  const all = [];
  for (const s of series) for (const r of data) all.push(num(r[s.field]));
  const e = extent(all);
  return {
    ...e,
    draw(ctx) {
      const out = [];
      const dumbbell = series.length > 1;
      data.forEach((r, i) => {
        const cx = ctx.linearX ? ctx.xOf(num(r[S.x.field])) : ctx.xOf(i);
        const vs = series.map((s) => ({ s, v: num(r[s.field]) })).filter((d) => d.v != null);
        if (!vs.length) return;
        if (dumbbell && vs.length > 1) {
          const ys = vs.map((d) => ctx.yOf(d.v));
          out.push(line(cx, Math.min(...ys), cx, Math.max(...ys), P.prior, 1.6, null, "cv-a-fade"));
        } else {
          out.push(line(cx, ctx.zeroY, cx, ctx.yOf(vs[0].v), P.grid, 1.4, null, "cv-a-fade"));
        }
        vs.forEach((d, si) => out.push(h("circle", {
          cx: fx(cx), cy: fx(ctx.yOf(d.v)), r: si === 0 ? "3.6" : "3",
          fill: si === 0 ? d.s.color : PAPER, stroke: d.s.color, "stroke-width": "1.6",
          class: "cv-a-fade", ...delay(i),
        })));
      });
      return out;
    },
  };
}

/* ---- heatmap ---------------------------------------------------------- */

function prepHeat(S, data, series, cats, flag) {
  const all = [];
  for (const s of series) for (const r of data) all.push(num(r[s.field]));
  const e = extent(all);
  const diverging = e.min < 0 && e.max > 0;
  const bound = Math.max(Math.abs(e.min), Math.abs(e.max)) || 1;
  const cellColor = (v) => diverging
    ? (v >= 0 ? mix(PAPER, P.accent, v / bound) : mix(PAPER, P.err, -v / bound))
    : mix(PAPER, P.accent, (v - e.min) / ((e.max - e.min) || 1));
  const intensity = (v) => diverging ? Math.abs(v) / bound : (v - e.min) / ((e.max - e.min) || 1);
  const swatches = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const v = diverging ? (t * 2 - 1) * bound : e.min + t * (e.max - e.min);
    swatches.push({ label: i === 0 || i === 4 ? formatter(S.y.format, (e.max - e.min) / 5 || 1)(v) : " ", color: cellColor(v) });
  }
  return {
    ...e,
    legend: swatches,
    draw(ctx) {
      const out = [];
      const cw = ctx.plotW / (cats.length || 1);
      const showVals = cw >= 34;
      const f = formatter(S.y.format, (e.max - e.min) / 5 || 1);
      series.forEach((s, si) => {
        const yy = ctx.plotT + si * HEAT_ROW;
        data.forEach((r, i) => {
          const v = num(r[s.field]);
          const x0 = ctx.plotL + cw * i;
          if (v == null) {
            out.push(rect(x0 + 0.5, yy + 0.5, cw - 1, HEAT_ROW - 1, PAPER, { stroke: P.grid, "stroke-width": "1", "stroke-dasharray": "2 2" }));
            return;
          }
          out.push(rect(x0 + 0.5, yy + 0.5, cw - 1, HEAT_ROW - 1, cellColor(v), {
            stroke: P.grid, "stroke-width": "0.8", class: "cv-a-fade", ...delay(si * 4 + i),
          }));
          if (showVals) out.push(label(x0 + cw / 2, yy + HEAT_ROW / 2 + 3.5, f(v), "cv-val", "middle", { fill: intensity(v) > 0.58 ? PAPER : P.ink }));
        });
      });
      return out;
    },
  };
}

/* ================================================================ public */

/* Deterministic string form — this is what goes into the run bundle. */
function toSvgString(spec, rows) {
  return ser(build(spec, rows).root);
}

function meta(spec, rows) {
  return build(spec, rows).meta;
}

/* render() mounts the svg plus a visually-hidden data table. It returns the
 * SVGElement (per §8); metadata rides along as `svg.vizMeta`. */
function render(mount, spec, rows) {
  const doc = (mount && mount.ownerDocument) || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("viz: render needs a DOM; use toSvgString outside the browser");
  injectCss(doc);
  const built = build(spec, rows);
  const svg = toDom(built.root, doc);

  const fig = doc.createElement("figure");
  fig.className = "cviz-fig";
  fig.appendChild(svg);

  const t = built.table;
  const table = doc.createElement("table");
  table.className = "cviz-sr";
  const cap = doc.createElement("caption");
  cap.textContent = `${t.caption} — data table`;
  table.appendChild(cap);
  const thead = doc.createElement("thead");
  const hr = doc.createElement("tr");
  for (const c of t.columns) {
    const th = doc.createElement("th");
    th.scope = "col";
    th.textContent = String(c);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = doc.createElement("tbody");
  const capped = t.rows.slice(0, 200);
  for (const r of capped) {
    const tr = doc.createElement("tr");
    r.forEach((cell, i) => {
      const td = doc.createElement(i === 0 ? "th" : "td");
      if (i === 0) td.scope = "row";
      td.textContent = String(cell == null ? "" : cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  if (t.rows.length > capped.length) {
    const tr = doc.createElement("tr");
    const td = doc.createElement("td");
    td.colSpan = t.columns.length;
    td.textContent = `${t.rows.length - capped.length} further rows omitted from the text fallback.`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  fig.appendChild(table);

  if (mount && mount.appendChild) mount.appendChild(fig);
  svg.vizMeta = built.meta;
  return svg;
}

/* --------------------------------------------------------------- selftest */

const SAMPLE = {
  line: { kind: "line", rows: [{ p: "2025-01", a: 120, b: 100 }, { p: "2025-02", a: 132, b: 118 }, { p: "2025-03", a: 128, b: 121 }],
    x: { field: "p", label: "Period", type: "time" }, y: { field: "a", label: "Units", zero: true, format: "compact" },
    series: [{ field: "a", label: "current" }, { field: "b", label: "prior" }] },
  area: { kind: "area", rows: [{ p: "2025-01", v: 40 }, { p: "2025-02", v: 52 }, { p: "2025-03", v: 47 }],
    x: { field: "p", label: "Period", type: "time" }, y: { field: "v", label: "On hand", zero: true, format: "n" } },
  bar: { kind: "bar", rows: [{ k: "Alpha", v: 12 }, { k: "Beta", v: 19 }, { k: "Gamma", v: -4 }],
    x: { field: "k", label: "Segment", type: "category" }, y: { field: "v", label: "Delta", zero: true, format: "n" } },
  "grouped-bar": { kind: "grouped-bar", rows: [{ k: "Alpha", c: 12, p: 9 }, { k: "Beta", c: 19, p: 22 }],
    x: { field: "k", label: "Segment", type: "category" }, y: { field: "c", label: "Units", zero: true, format: "n" },
    series: [{ field: "c", label: "current" }, { field: "p", label: "matched prior" }] },
  "stacked-bar": { kind: "stacked-bar", rows: [{ k: "Q1", a: 5, b: 7 }, { k: "Q2", a: 8, b: 3 }],
    x: { field: "k", label: "Quarter", type: "category" }, y: { field: "a", label: "Units", zero: true, format: "n" },
    series: [{ field: "a", label: "current" }, { field: "b", label: "prior" }] },
  waterfall: { kind: "waterfall", rows: [
    { k: "FY24", v: 1000, total: true }, { k: "Price", v: -120 }, { k: "Mix", v: 60 }, { k: "Volume", v: 35 }, { k: "FY25", v: 975, total: true }],
    x: { field: "k", label: "Bridge", type: "category" }, y: { field: "v", label: "Units", zero: true, format: "compact" } },
  dot: { kind: "dot", rows: [{ k: "Alpha", c: 12, p: 9 }, { k: "Beta", c: 19, p: 22 }],
    x: { field: "k", label: "Segment", type: "category" }, y: { field: "c", label: "Rate", zero: true, format: "pct" },
    series: [{ field: "c", label: "current" }, { field: "p", label: "prior" }] },
  heatmap: { kind: "heatmap", rows: [{ k: "Jan", a: 1, b: -2 }, { k: "Feb", a: 4, b: 3 }, { k: "Mar", a: 0, b: 5 }],
    x: { field: "k", label: "Month", type: "category" }, y: { field: "a", label: "Index", zero: true, format: "n" },
    series: [{ field: "a", label: "north" }, { field: "b", label: "south" }] },
};

/* Smoke test: every kind renders into a detached node, and renders the same
 * bytes twice. Returns { kind: 'ok' | 'error: …' }. */
function __selfTest() {
  const out = {};
  const haveDom = typeof document !== "undefined";
  for (const kind of KINDS) {
    const s = SAMPLE[kind];
    try {
      if (!s) throw new Error("no sample");
      const spec = {
        chartId: `selftest-${kind}`, kind, title: `${kind} self test`,
        x: s.x, y: s.y, series: s.series || null,
        sourceNote: "Self test — synthetic rows, not evidence.",
        specHash: `selftest_${kind}`,
      };
      const a = toSvgString(spec, s.rows);
      const b = toSvgString(spec, s.rows);
      if (a !== b) throw new Error("non-deterministic output");
      if (!a.startsWith("<svg") || a.indexOf("</svg>") < 0) throw new Error("malformed svg");
      if (haveDom) {
        const box = document.createElement("div");
        const svg = render(box, spec, s.rows);
        if (!svg || svg.namespaceURI !== SVGNS) throw new Error("no svg element");
        if (!box.querySelector("table.cviz-sr")) throw new Error("no data table fallback");
      }
      out[kind] = "ok";
    } catch (e) {
      out[kind] = `error: ${e && e.message ? e.message : String(e)}`;
    }
  }
  /* the axis rules are part of the contract, so test them too */
  try {
    toSvgString({ chartId: "dual", kind: "line", x: { field: "k", label: "k", type: "category" },
      y: { field: "v", label: "v", zero: true, format: "n" }, y2: { field: "w" }, sourceNote: "x" }, []);
    out.dualAxisRefused = "error: dual axis spec was accepted";
  } catch { out.dualAxisRefused = "ok"; }
  try {
    const m = meta({ chartId: "trunc", kind: "bar", x: { field: "k", label: "k", type: "category" },
      y: { field: "v", label: "v", zero: false, format: "n" }, sourceNote: "x" },
      [{ k: "a", v: 100 }, { k: "b", v: 104 }]);
    out.axisBreakReported = m.axisBreak && m.findings.length ? "ok" : "error: truncation not reported";
  } catch (e) { out.axisBreakReported = `error: ${e.message}`; }
  return out;
}

export const Viz = { render, toSvgString, meta, PALETTE, KINDS, __selfTest };

export default Viz;
