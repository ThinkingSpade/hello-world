/* converge.js — the drawing language for "several things become one".
 *
 * Three places in this application are the same picture: sources on one side, a
 * decision on the other, connectors carrying the first into the second. The
 * decision lens does it for a whole run, the resolution ladder does it for a
 * single contested point, and reconciliation does it for one figure computed
 * twice. They should not each invent their own line.
 *
 * So the vocabulary lives here and nowhere else:
 *
 *   solid connector   the source moves the outcome
 *   dotted connector  the source is context and moves nothing
 *   tone              the state — ok, warn, err, accent — never decoration
 *   shape             a glyph per effect, so the encoding survives greyscale
 *
 * Geometry is measured off live layout on every call rather than assumed,
 * because a card that wrapped to three lines has moved its own endpoint and a
 * drawing that does not notice is worse than no drawing.
 *
 * Self-contained: injects its own scoped CSS, depends on nothing but the DOM.
 *
 * See CONTRACT.md §9e.
 */

export const SVGNS = "http://www.w3.org/2000/svg";

export const REDUCED = typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Shape per effect. No state is ever carried by colour alone, so each of these
 * has to stay distinguishable as a silhouette at 10px. */
export const ICON = {
  octagon: "M4 0h4l4 4v4l-4 4H4L0 8V4z",
  diamond: "M6 0l6 6-6 6-6-6z",
  up:      "M6 0l6 7H8.5v5h-5V7H0z",
  check:   "M4.6 11.4L0 6.8l1.9-1.9 2.7 2.7L10.1.6 12 2.5z",
  bars:    "M0 1h12v2.6H0zM0 5.2h12v2.6H0zM0 9.4h8.4V12H0z",
  split:   "M0 0h3v4.6h6V0h3v12H9V7.4H3V12H0z",
};

export function svgEl(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
  return n;
}

export function icon(kind, cls) {
  const s = svgEl("svg", { viewBox: "0 0 12 12", "aria-hidden": "true", class: cls || "cv-ic" });
  s.appendChild(svgEl("path", { d: ICON[kind] || ICON.bars }));
  return s;
}

/* ---------- geometry ---------- */

/* Anchor points are given as {el, side} or as {x, y} already in container
 * coordinates, so a caller can hang a connector off a laid-out card without
 * knowing where the layout put it. */
export function anchor(spec, box) {
  if (spec == null) return { x: 0, y: 0 };
  if (spec.el) {
    const r = spec.el.getBoundingClientRect();
    const side = spec.side || "right";
    const x = side === "right" ? r.right : side === "left" ? r.left : r.left + r.width / 2;
    const y = side === "top" ? r.top : side === "bottom" ? r.bottom : r.top + r.height / 2;
    return { x: x - box.left, y: y - box.top };
  }
  return { x: spec.x || 0, y: spec.y || 0 };
}

/* Landing points fanned across one side of a circle. Kept deliberately narrow:
 * a wide fan reads as a list pointing at a shape, and the whole purpose of the
 * drawing is convergence. */
export function arc(target, box, n, { spread = 1.25, radiusFrac = 0.46, facing = "left" } = {}) {
  const r0 = target.getBoundingClientRect();
  const cx = r0.left - box.left + r0.width / 2;
  const cy = r0.top - box.top + r0.height / 2;
  const rad = Math.min(r0.width, r0.height) * radiusFrac;
  const base = facing === "left" ? Math.PI : 0;
  const step = n > 1 ? Math.min(spread, 0.28 * n) / (n - 1) : 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    /* Subtract: SVG y grows downward, so the first source — which sits at the
     * top of its stack — has to land above the centre line or every connector
     * crosses every other one. */
    const a = base - (n === 1 ? 0 : (i - (n - 1) / 2) * step);
    pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  return pts;
}

/* ---------- connectors ---------- */

/* links: [{ from, to, tone, solid, label }]
 * Returns false when the container has no width to draw into — a hidden stage,
 * or a viewport too narrow for the layout to still mean anything.
 */
export function wires(svg, container, links, { axis = "x", minWidth = 0, animate = true } = {}) {
  svg.innerHTML = "";
  const box = container.getBoundingClientRect();
  if (!box.width || box.width < minWidth) return false;

  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.setAttribute("width", String(box.width));
  svg.setAttribute("height", String(box.height));

  links.forEach((L, i) => {
    const p1 = anchor(L.from, box);
    const p2 = anchor(L.to, box);
    const solid = L.solid !== false;

    /* Flat exit, flat entry: the connector leaves and arrives along the axis of
     * flow, so the eye reads a stream rather than a wire. */
    let d;
    if (axis === "y") {
      const dy = Math.max(20, (p2.y - p1.y) * 0.5);
      d = `M ${f(p1.x)} ${f(p1.y)} C ${f(p1.x)} ${f(p1.y + dy)}, ${f(p2.x)} ${f(p2.y - dy)}, ${f(p2.x)} ${f(p2.y)}`;
    } else {
      const dx = Math.max(36, (p2.x - p1.x) * 0.48);
      d = `M ${f(p1.x)} ${f(p1.y)} C ${f(p1.x + dx)} ${f(p1.y)}, ${f(p2.x - dx)} ${f(p2.y)}, ${f(p2.x)} ${f(p2.y)}`;
    }

    const path = svgEl("path", { d, class: "cv-wire", fill: "none" });
    path.dataset.tone = L.tone || "";
    path.dataset.weight = solid ? "moves" : "context";
    svg.appendChild(path);

    const dot = svgEl("circle", { cx: f(p2.x), cy: f(p2.y), r: solid ? 4 : 3, class: "cv-node" });
    dot.dataset.tone = L.tone || "";
    dot.dataset.weight = solid ? "moves" : "context";
    svg.appendChild(dot);

    if (L.label) {
      const t = svgEl("text", {
        x: f((p1.x + p2.x) / 2), y: f((p1.y + p2.y) / 2 - 6),
        class: "cv-wlabel", "text-anchor": "middle",
      });
      t.dataset.tone = L.tone || "";
      t.textContent = L.label;
      svg.appendChild(t);
    }

    if (animate && !REDUCED) {
      const delay = (i * 0.07).toFixed(2);
      if (solid) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.style.animation = `cv-draw .85s cubic-bezier(.4,0,.2,1) ${delay}s forwards`;
      } else {
        path.style.strokeDasharray = "2 5";
        path.style.opacity = "0";
        path.style.animation = `cv-fade .5s ease ${(i * 0.07 + 0.25).toFixed(2)}s forwards`;
      }
      dot.style.opacity = "0";
      dot.style.animation = `cv-fade .4s ease ${(i * 0.07 + 0.6).toFixed(2)}s forwards`;
    } else if (!solid) {
      path.style.strokeDasharray = "2 5";
    }
  });
  return true;
}

const f = (v) => Number(v).toFixed(1);

/* ---------- two into one ----------
 *
 * The small, fixed case: exactly two sources merging into one result, drawn at
 * a known size. Reconciliation repeats this once per specification — twenty-one
 * times on the sample case — so it deliberately does not measure layout, does
 * not observe resizes and does not animate per instance. Fixed geometry is the
 * right tool when the geometry really is fixed.
 *
 * `agree: false` splits the fork instead of joining it, because two engines
 * that disagree have not produced a figure and must not be drawn as though
 * they had.
 */
export function merge({ height = 56, width = 54, tone = "", agree = true } = {}) {
  const svg = svgEl("svg", {
    class: "cv-merge", viewBox: `0 0 ${width} ${height}`,
    width, height, "aria-hidden": "true",
  });
  svg.dataset.tone = tone;

  const yTop = height * 0.22, yBot = height * 0.78, yMid = height / 2;
  const xEnd = width - 7;
  const dx = width * 0.45;
  const end = agree ? yMid : null;

  for (const [y0, y1] of agree
    ? [[yTop, yMid], [yBot, yMid]]
    : [[yTop, yTop], [yBot, yBot]]) {
    svg.appendChild(svgEl("path", {
      class: "cv-mline", fill: "none",
      d: `M 0 ${f(y0)} C ${f(dx)} ${f(y0)}, ${f(xEnd - dx)} ${f(y1)}, ${f(xEnd)} ${f(y1)}`,
    }));
  }

  if (agree) {
    svg.appendChild(svgEl("circle", { class: "cv-mnode", cx: f(xEnd), cy: f(end), r: 3.5 }));
  } else {
    /* An explicit break, not merely an absence of a join. */
    const g = svgEl("g", { class: "cv-mbreak" });
    g.appendChild(svgEl("path", { d: `M ${f(xEnd - 4)} ${f(yMid - 4)} L ${f(xEnd + 4)} ${f(yMid + 4)}` }));
    g.appendChild(svgEl("path", { d: `M ${f(xEnd + 4)} ${f(yMid - 4)} L ${f(xEnd - 4)} ${f(yMid + 4)}` }));
    svg.appendChild(g);
  }
  return svg;
}

/* ---------- CSS ---------- */

export function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("cv-css")) return;
  const s = document.createElement("style");
  s.id = "cv-css";
  s.textContent = `
/* Tone is inherited through --t so a subtree can be recoloured by state
   without any rule knowing which state it is.

   Each rule has to match the toned element itself as well as its descendants:
   a small view like the reconciliation merge carries the cv class and the
   data-tone attribute on the same node, and a descendant-only selector
   silently leaves it on the default accent — which reads as "no state" for
   something that has one. */
.cv { --t: var(--pi-accent); }
.cv[data-tone="err"],    .cv [data-tone="err"]    { --t: var(--pi-err); }
.cv[data-tone="warn"],   .cv [data-tone="warn"]   { --t: var(--pi-warn); }
.cv[data-tone="ok"],     .cv [data-tone="ok"]     { --t: var(--pi-ok); }
.cv[data-tone="accent"], .cv [data-tone="accent"] { --t: var(--pi-accent); }
.cv[data-tone="idle"],   .cv [data-tone="idle"]   { --t: var(--pi-muted); }
.cv[data-tone=""],       .cv [data-tone=""]       { --t: var(--pi-muted); }

.cv-wires { position:absolute; inset:0; pointer-events:none; z-index:0; overflow:visible; }
.cv-wire  { stroke:var(--t); stroke-width:1.5; }
.cv-wire[data-weight="context"] { stroke:var(--pi-muted); stroke-opacity:.5; stroke-width:1.25; }
.cv-node  { fill:var(--t); }
.cv-node[data-weight="context"] { fill:var(--pi-muted); fill-opacity:.5; }
.cv-wlabel {
  fill:var(--pi-muted); font-family:var(--pi-font-code); font-size:11px;
}
.cv-ic { width:10px; height:10px; flex:none; fill:currentColor; }

.cv-merge { flex:none; overflow:visible; }
.cv-mline { stroke:var(--t); stroke-width:1.5; }
.cv-mnode { fill:var(--t); }
.cv-mbreak path { stroke:var(--t); stroke-width:2; stroke-linecap:round; }

@keyframes cv-draw { to { stroke-dashoffset:0; } }
@keyframes cv-fade { to { opacity:1; } }

@media (prefers-reduced-motion: reduce) {
  .cv-wire, .cv-node { animation:none !important; opacity:1 !important; stroke-dashoffset:0 !important; }
}
`;
  document.head.appendChild(s);
}

export const Converge = { icon, wires, arc, anchor, merge, svgEl, injectCSS, ICON, SVGNS, REDUCED };
export default Converge;
