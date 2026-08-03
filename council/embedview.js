/* embedview.js — watching the corpus become numbers.
 *
 * The retrieval index is usually the least inspectable part of an application
 * like this: text goes in, "relevant" comes out, and you are asked to take the
 * middle on faith. That is exactly the kind of step this project refuses
 * everywhere else, so it refuses it here too.
 *
 * This renders the real thing. The heatmap is `index.matrix` itself — one row
 * per span, one column per dimension, signed magnitude as colour. The query
 * panel shows the actual tokens the recipe produces, the hash each one lands
 * on, its sign and its IDF weight, and the cosine that results. Nothing is
 * illustrative; every pixel is read from the live index.
 *
 * Canvas rather than SVG here, and deliberately: a 300 × 512 matrix is 150k
 * cells. viz.js stays SVG because charts travel in the run bundle and must be
 * byte-reproducible — this is an inspector, not an artefact.
 */
import { U } from "./util.js";
import { Vectorizer } from "./vector.js";

let host = null, canvas = null, ctx2d = null, tip = null;
let idx = null, rows = 0, dim = 0, rowH = 3;
let queryVec = null, highlight = new Set();

const POS = [37, 71, 201];      // accent — positive weight
const NEG = [179, 55, 44];      // err    — negative weight

/* These vectors are sparse — a span of a dozen words occupies perhaps 30 of 512
 * dimensions — so a linear alpha ramp renders the matrix as nearly blank paper
 * with a few dark specks, which shows the reader nothing. A gamma lift pulls
 * the small weights up into visibility while keeping the large ones distinct,
 * and occupied cells get a floor so "there is a weight here" always reads. */
const GAMMA = 0.4;
const FLOOR = 0.45;

function colour(v, scale) {
  if (v === 0) return null;                        // genuinely empty stays white
  const t = Math.min(1, Math.abs(v) * scale);
  if (t < 1e-4) return null;
  const lifted = Math.pow(t, GAMMA);
  const c = v >= 0 ? POS : NEG;
  const a = FLOOR + (1 - FLOOR) * lifted;
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

export const EmbedView = {
  mount(el) {
    host = el;
    host.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.className = "c-embed-canvas";
    host.appendChild(canvas);
    ctx2d = canvas.getContext("2d");
    tip = document.createElement("div");
    tip.className = "c-embed-tip";
    tip.hidden = true;
    host.appendChild(tip);

    canvas.addEventListener("mousemove", (e) => {
      if (!idx) return;
      const r = canvas.getBoundingClientRect();
      const row = Math.floor(((e.clientY - r.top) / r.height) * rows);
      const col = Math.floor(((e.clientX - r.left) / r.width) * dim);
      if (row < 0 || row >= rows || col < 0 || col >= dim) { tip.hidden = true; return; }
      const entry = idx.entries[row];
      const span = idx.spanById.get(entry.spanId);
      const v = idx.matrix[row * dim + col];
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - 300, e.clientX - r.left + 12)}px`;
      tip.style.top = `${e.clientY - r.top + 12}px`;
      tip.textContent =
        `dim ${col} = ${v.toFixed(4)}  ·  span ${row + 1}/${rows}\n` +
        (span ? span.text.replace(/\s+/g, " ").slice(0, 150) : entry.spanId);
    });
    canvas.addEventListener("mouseleave", () => { tip.hidden = true; });
  },

  /* Draw the whole index. `upTo` limits how many rows are painted, which is
   * what makes the build animation possible — the same draw call, called
   * repeatedly with a growing bound. */
  render(index, upTo = Infinity) {
    if (!index || !canvas) return;
    idx = index;
    rows = index.entries.length;
    dim = index.dim;
    if (!rows || !dim) return;

    rowH = Math.max(3, Math.min(8, Math.floor(420 / rows)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = dim, h = rows * rowH;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);

    // One scale for the whole matrix so rows stay comparable to each other.
    let peak = 0;
    const m = index.matrix;
    for (let i = 0; i < m.length; i++) { const a = Math.abs(m[i]); if (a > peak) peak = a; }
    const scale = peak > 0 ? 1 / peak : 0;

    const last = Math.min(rows, upTo);
    for (let r = 0; r < last; r++) {
      const base = r * dim;
      for (let c = 0; c < dim; c++) {
        const col = colour(m[base + c], scale);
        if (!col) continue;
        ctx2d.fillStyle = col;
        ctx2d.fillRect(c, r * rowH, 1, rowH);
      }
    }

    // Rows matching the current query get a marker in the gutter.
    if (highlight.size) {
      ctx2d.fillStyle = "#1d7a4d";
      for (const r of highlight) ctx2d.fillRect(0, r * rowH, 3, Math.max(2, rowH - 1));
    }
    return { rows, dim, peak };
  },

  /* Paint the matrix a chunk at a time so the corpus is visibly turning into
   * numbers rather than appearing already numeric. */
  async stream(index, { chunk = 12, frame = 26, onStep } = {}) {
    if (!index || !index.entries.length) return;
    for (let upTo = chunk; upTo <= index.entries.length + chunk; upTo += chunk) {
      EmbedView.render(index, upTo);
      if (onStep) onStep(Math.min(upTo, index.entries.length), index.entries.length);
      await new Promise((r) => setTimeout(r, frame));
    }
    EmbedView.render(index);
  },

  setHighlight(spanIds) {
    highlight = new Set();
    if (!idx) return;
    for (const id of spanIds || []) {
      const i = idx.entries.findIndex((e) => e.spanId === id);
      if (i >= 0) highlight.add(i);
    }
    EmbedView.render(idx);
  },

  /* Take a question apart the way the recipe does, so the arithmetic is
   * visible: which tokens it produced, where each one hashes to, whether it
   * lands positive or negative, and how rare it is in this corpus. */
  explain(index, text) {
    if (!index || !text.trim()) return null;
    const norm = Vectorizer.normalize(text);
    const toks = Vectorizer.tokens(text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);

    /* Classify by re-deriving what the recipe did, rather than guessing from
     * shape. A four-letter token can be a word ("does") or a character 4-gram
     * ("adop"), and only the source text can tell you which — so ask it. */
    const words = new Set(norm.split(/[^a-z0-9]+/i).filter(Boolean));

    const terms = [];
    for (const [t, n] of tf) {
      const h = U.fnv1a32(t) >>> 0;
      const idf = index.idf(t);
      terms.push({
        term: t,
        kind: t.includes(" ") ? "bigram" : words.has(t) ? "word" : "char 4-gram",
        tf: n,
        dim: h % index.dim,
        sign: (h >>> 31) ? -1 : 1,
        df: index.dfOf(t),
        idf,
        weight: (1 + Math.log(n)) * idf,
      });
    }
    // Heaviest first: what actually drives the match, not alphabetical order.
    terms.sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1));

    queryVec = Vectorizer.embed(text, index);
    let nonZero = 0;
    for (let i = 0; i < queryVec.length; i++) if (queryVec[i] !== 0) nonZero++;

    return {
      normalized: norm,
      terms,
      tokenCount: toks.length,
      uniqueTerms: tf.size,
      unseen: terms.filter((t) => t.df === 0).length,
      vec: queryVec,
      nonZero,
      dim: index.dim,
    };
  },

  /* The query vector as a single strip, on the same colour scale and the same
   * horizontal axis as the matrix beneath it, so a reader can line up a bright
   * column in the query with the bright column in a matching span. */
  renderQueryStrip(el, vec) {
    if (!el || !vec) return;
    el.innerHTML = "";
    const c = document.createElement("canvas");
    c.className = "c-embed-canvas";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = 16;
    c.width = vec.length * dpr;
    c.height = h * dpr;
    c.style.height = `${h}px`;
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let peak = 0;
    for (const v of vec) { const a = Math.abs(v); if (a > peak) peak = a; }
    const scale = peak > 0 ? 1 / peak : 0;
    for (let i = 0; i < vec.length; i++) {
      const col = colour(vec[i], scale);
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(i, 0, 1, h);
    }
    el.appendChild(c);
  },
};

export default EmbedView;
