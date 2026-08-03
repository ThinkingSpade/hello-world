/* council/vector.js — deterministic hybrid retrieval.  Implements CONTRACT.md §3.
 *
 * Nothing here is random, time-seeded, or locale-dependent.  The same spans in
 * the same order always produce the same vectors, the same scores and the same
 * ordering — that is the whole point of the module, because the run manifest
 * records `Vectorizer.VERSION` as the thing that produced the index.
 *
 * The embedding recipe below is normative and is written so a Python port
 * reproduces it byte-for-byte.  Reference implementation, in order:
 *
 *   s      = unicodedata.normalize('NFKC', text.lower())
 *   s      = ' '.join(s.split())
 *   words  = [w for w in regex.split(r'[^\p{L}\p{N}]+', s) if w]
 *   tokens = words                                     # unigrams
 *          + [a + ' ' + b for a, b in zip(words, words[1:])]      # bigrams
 *          + [w[i:i+4] for w in words if len(w) > 5
 *                      for i in range(len(w) - 3)]     # char 4-grams
 *   tf     = Counter(tokens)
 *   idf(t) = log((N + 1) / (df(t) + 1)) + 1
 *   for t, c in tf.items():
 *       h = fnv1a32(t)
 *       v[h % 512] += (-1 if h >> 31 else 1) * (1 + log(c)) * idf(t)
 *   v /= norm(v)                                       # zero vectors stay zero
 *
 * Ambiguities in the contract and the reading taken (chosen for reproducibility
 * — the simplest rule another language can restate without guessing):
 *
 *  - "word" is `[\p{L}\p{N}]+`.  Unicode general categories, not [a-z0-9], so
 *    accented and non-Latin source text survives.  Splitting on the complement
 *    means bigrams may straddle punctuation ("end. start" -> "end start"); that
 *    is deliberate and stated rather than special-cased.
 *  - bigrams join with a single space.  A unigram can never contain a space and
 *    a 4-gram is cut out of a single word, so the three token families share one
 *    namespace without ever colliding across families.  4-grams *can* collide
 *    with 4-letter unigrams ("data" the word vs "data" inside "database"); the
 *    contract prescribes no prefix, so none is invented.
 *  - "tokens longer than 5 characters" is length >= 6, read literally.
 *  - `tf` is the token's count within one span; `df` is the number of spans it
 *    occurs in; both count over the full token stream (unigrams + bigrams +
 *    4-grams), which is also what `IndexEntry.terms` holds.
 *  - BM25 reuses the one idf the contract defines (§3 step 4) instead of the
 *    textbook Okapi idf.  One index, one idf, nothing extra to reproduce — and
 *    it can never go negative the way the Okapi form does for frequent terms.
 *  - BM25 sums over *distinct* query terms (canonical form, no query-tf factor).
 *  - "min-max scaled within the result set" is scaled across the whole candidate
 *    set — scaling across the returned top-k would be circular, since you need
 *    the scores to know the top-k.
 *  - a degenerate candidate set (every bm25 identical) normalises to 0.  It is a
 *    constant, so it cannot change the ordering either way, and 0 never NaNs.
 *
 * Performance: build() is a single tokenising pass that accumulates df, then a
 * vector pass over the per-span tf maps.  Dense vectors live in one contiguous
 * Float32Array and each entry's `vec` is a subarray view of it — 50k spans is
 * one 100 MB allocation instead of 50k small ones.  Vocabulary statistics live
 * in growable typed arrays keyed by an integer term id, so the hot loops do no
 * per-token object allocation and hash each distinct term exactly once.
 */

import { U } from './util.js';

/* ---------------------------------------------------------------- constants */

const LOCAL_VERSION = 'local-hash-tfidf-v1';
const LOCAL_DIM = 512;          // frozen by the recipe; never varies for local
const K1 = 1.2;
const B = 0.75;
const PROGRESS_STEP = 256;      // report progress at a fixed stride, not per span

/* Registered remote embedder, or null for the default local recipe. */
let remote = null;

/* --------------------------------------------------------------- tokenising */

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const WHITESPACE = /\s+/gu;

/* Step 1 of the recipe, in the order the contract lists it: lowercase, then
 * NFKC, then collapse whitespace.  (Lowercasing first is what §3 says; doing it
 * after NFKC differs for a handful of compatibility characters, so the order is
 * pinned here rather than left to taste.) */
function normalizeText(text) {
  if (text === null || text === undefined) return '';
  return String(text).toLowerCase().normalize('NFKC').replace(WHITESPACE, ' ').trim();
}

/* Steps 2: emit every token exactly once per occurrence.  Callback style so the
 * hot loop never materialises an intermediate token array. */
function tokenize(text, emit) {
  const words = normalizeText(text).split(WORD_SPLIT);
  let prev = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;                             // split yields empty edges
    emit(w);                                      // unigram
    if (prev) emit(prev + ' ' + w);               // bigram
    prev = w;
    if (w.length > 5) {                           // char 4-grams
      const last = w.length - 4;
      for (let j = 0; j <= last; j++) emit(w.slice(j, j + 4));
    }
  }
}

function termCounts(text) {
  const tf = new Map();
  tokenize(text, (t) => tf.set(t, (tf.get(t) || 0) + 1));
  return tf;
}

/* ------------------------------------------------------------------- typed */

function grow(arr, need, Ctor) {
  if (need <= arr.length) return arr;
  let cap = arr.length || 1024;
  while (cap < need) cap *= 2;
  const next = new Ctor(cap);
  next.set(arr);
  return next;
}

/* Divide rather than multiply by the reciprocal so the rounding matches the
 * naive `v / norm` a reference implementation would write. */
function l2(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  if (!(sum > 0)) return vec;                     // zero stays zero, never NaN
  const norm = Math.sqrt(sum);
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/* Sync-or-async without forking the code path.  Local build/search stay fully
 * synchronous (the contract's signatures); a registered remote embedder makes
 * them return a promise, and `await` on a plain value is a no-op, so callers can
 * always write `await Vectorizer.build(spans)`. */
const isThenable = (v) => !!v && typeof v.then === 'function';
const then = (v, fn) => (isThenable(v) ? v.then(fn) : fn(v));

/* Run body(i) for i in [from, to).  With chunk = 0 this is a plain loop and the
 * caller stays synchronous.  With chunk > 0 it hands the thread back every
 * `chunk` iterations (setTimeout, not a microtask, so the browser actually gets
 * to paint) and returns a promise.  Yielding changes only *when* the work runs,
 * never the order or the result. */
function slices(from, to, chunk, body) {
  if (!chunk) {
    for (let i = from; i < to; i++) body(i);
    return undefined;
  }
  let i = from;
  const step = () => {
    const end = Math.min(to, i + chunk);
    for (; i < end; i++) body(i);
    if (i >= to) return undefined;
    return new Promise((resolve) => setTimeout(resolve, 0)).then(step);
  };
  return step();
}

/* Accepts an Index, an idf function, a Map, a plain object, or nothing.
 * Pass an Index (or `index.idf`) for correct unseen-term handling — it is the
 * only form that knows N. */
function idfLookup(idf) {
  if (idf === null || idf === undefined) return () => 1;
  if (typeof idf === 'function') return idf;
  if (typeof idf.idf === 'function') return (t) => idf.idf(t);
  if (idf instanceof Map) return (t) => { const v = idf.get(t); return v === undefined ? 1 : v; };
  if (typeof idf === 'object') return (t) => (Object.prototype.hasOwnProperty.call(idf, t) ? idf[t] : 1);
  return () => 1;
}

function progressFn(opts) {
  if (typeof opts === 'function') return opts;
  if (opts && typeof opts.onProgress === 'function') return opts.onProgress;
  return null;
}

function yieldEvery(opts) {
  const v = opts && typeof opts === 'object' ? opts.yieldEvery : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/* ------------------------------------------------------------------- build */

/* Pass 1.  Tokenises every span once, records tf per span, and accumulates df in
 * the same pass.  Everything lexical (BM25) comes out of here and stays local
 * and deterministic even when a remote dense embedder is registered.
 *
 * The hot loop does exactly one string-keyed lookup per token — into the global
 * vocabulary, which also caches that term's hash bucket and sign.  Term
 * frequencies accumulate in a dense Int32Array keyed by term id with a
 * first-touch list, so the only per-span Map writes are one per *distinct*
 * term.  `terms` still ends up in first-occurrence order, which is what fixes
 * the float accumulation order of the vector pass. */
function lexicalPass(list, tick, chunk) {
  const n = list.length;
  const entries = new Array(n);
  const byId = new Map();
  const spanById = new Map();
  const lengths = new Float64Array(n);
  const fileIds = new Set();

  const vocab = new Map();                        // term -> integer term id
  const termById = [];                            // integer term id -> term
  let vocabN = 0;
  let dfArr = new Int32Array(0);
  let dimArr = new Int32Array(0);                 // h % LOCAL_DIM, per term id
  let signArr = new Int8Array(0);                 // (h >>> 31) ? -1 : +1
  let tfBuf = new Int32Array(0);                  // per-span tf, zeroed after each span
  let touched = new Int32Array(1024);             // term ids seen in this span, in order
  let totalTokens = 0;
  let dl = 0;
  let nt = 0;

  const emit = (t) => {
    let id = vocab.get(t);
    if (id === undefined) {
      id = vocabN++;
      vocab.set(t, id);
      termById.push(t);
      dfArr = grow(dfArr, vocabN, Int32Array);
      dimArr = grow(dimArr, vocabN, Int32Array);
      signArr = grow(signArr, vocabN, Int8Array);
      tfBuf = grow(tfBuf, vocabN, Int32Array);
      const h = U.fnv1a32(t) >>> 0;               // hash each distinct term once
      dimArr[id] = h % LOCAL_DIM;
      signArr[id] = (h >>> 31) ? -1 : 1;
    }
    if (tfBuf[id]++ === 0) {
      touched = grow(touched, nt + 1, Int32Array);
      touched[nt++] = id;
    }
    dl++;
  };

  const body = (i) => {
    const span = list[i] || {};
    dl = 0;
    nt = 0;
    tokenize(span.text, emit);

    const terms = new Map();
    for (let j = 0; j < nt; j++) {
      const id = touched[j];
      terms.set(termById[id], tfBuf[id]);
      dfArr[id] += 1;                             // once per span: document frequency
      tfBuf[id] = 0;                              // reset only what this span touched
    }

    lengths[i] = dl;
    totalTokens += dl;

    // Span ids are supplied by ingest.js and are already deterministic; the
    // positional fallback keeps this module usable on bare {text} objects.
    const spanId = span.spanId === null || span.spanId === undefined ? String(i) : String(span.spanId);
    const fileId = span.fileId === null || span.fileId === undefined ? '' : String(span.fileId);
    if (fileId) fileIds.add(fileId);

    const entry = { spanId, fileId, vec: null, terms };
    entries[i] = entry;
    byId.set(spanId, entry);
    spanById.set(spanId, span);
    tick(i + 1);
  };

  return then(slices(0, n, chunk, body), () => {
    const idfArr = new Float64Array(vocabN);
    for (let id = 0; id < vocabN; id++) idfArr[id] = Math.log((n + 1) / (dfArr[id] + 1)) + 1;
    const unseenIdf = Math.log(n + 1) + 1;        // df = 0
    const avgdl = n > 0 ? totalTokens / n : 0;
    return {
      n, entries, byId, spanById, lengths, fileIds,
      vocab, vocabN, dfArr, dimArr, signArr, idfArr, unseenIdf,
      avgdl: avgdl > 0 ? avgdl : 1,               // guards the BM25 dl/avgdl term
      avgdlRaw: avgdl,
    };
  });
}

/* Pass 2, local: signed hashing into one contiguous matrix. */
function localVectors(state, tick, chunk) {
  const { n, entries, vocab, dimArr, signArr, idfArr } = state;
  const matrix = new Float32Array(n * LOCAL_DIM);
  const body = (i) => {
    const off = i * LOCAL_DIM;
    const vec = matrix.subarray(off, off + LOCAL_DIM);
    entries[i].terms.forEach((tf, t) => {         // forEach: no [k,v] pair allocation
      const id = vocab.get(t);
      vec[dimArr[id]] += signArr[id] * (1 + Math.log(tf)) * idfArr[id];
    });
    l2(vec);
    entries[i].vec = vec;
    tick(n + i + 1);
  };
  return then(slices(0, n, chunk, body), () => matrix);
}

/* Pass 2, remote.  Batched and sequential so the request order — and therefore
 * anything the provider does with it — is reproducible.  Remote vectors are not
 * covered by this module's determinism guarantee, which is exactly why
 * registering an embedder changes VERSION. */
function remoteVectors(list, rem, state, tick) {
  const n = state.n;
  const dim = rem.dim;
  const matrix = new Float32Array(n * dim);
  let i = 0;
  const step = () => {
    if (i >= n) return matrix;
    const end = Math.min(n, i + rem.batch);
    const texts = new Array(end - i);
    for (let j = i; j < end; j++) {
      const t = list[j] && list[j].text;
      texts[j - i] = t === null || t === undefined ? '' : String(t);
    }
    return Promise.resolve(rem.embed(texts)).then((vecs) => {
      if (!vecs || vecs.length !== texts.length) {
        throw new Error(`remote embedder "${rem.id}" returned ${vecs ? vecs.length : 0} vectors for ${texts.length} texts`);
      }
      for (let j = i; j < end; j++) {
        const v = vecs[j - i];
        const off = j * dim;
        if (v) {
          const lim = Math.min(dim, v.length);
          for (let d = 0; d < lim; d++) matrix[off + d] = v[d];
        }
        l2(matrix.subarray(off, off + dim));      // cosine needs unit vectors
      }
      i = end;
      tick(n + i);
      return step();
    });
  };
  return then(step(), () => {
    for (let j = 0; j < n; j++) state.entries[j].vec = matrix.subarray(j * dim, (j + 1) * dim);
    return matrix;
  });
}

function assemble(state, matrix, dim, version, rem) {
  const { vocab, vocabN, dfArr, idfArr, unseenIdf } = state;
  return {
    version,                                      // recorded in the run manifest
    embedder: rem ? rem.id : 'local',
    remote: rem,                                  // frozen at build time
    dim,
    entries: state.entries,                       // input order
    byId: state.byId,
    spanById: state.spanById,
    matrix,                                       // n * dim, row-major
    lengths: state.lengths,                       // BM25 document lengths
    avgdl: state.avgdl,
    avgdlRaw: state.avgdlRaw,
    vocab,
    vocabSize: vocabN,
    df: dfArr.subarray(0, vocabN),
    idfArr,
    files: state.fileIds.size,
    dfOf(term) { const id = vocab.get(term); return id === undefined ? 0 : dfArr[id]; },
    idf(term) { const id = vocab.get(term); return id === undefined ? unseenIdf : idfArr[id]; },
  };
}

/* ------------------------------------------------------------------ search */

function queryVector(index, query) {
  if (index.remote) {
    const text = query === null || query === undefined ? '' : String(query);
    return Promise.resolve(index.remote.embed([text])).then((vecs) => {
      const v = vecs && vecs[0];
      const out = new Float32Array(index.dim);
      if (v) { const lim = Math.min(index.dim, v.length); for (let d = 0; d < lim; d++) out[d] = v[d]; }
      return l2(out);
    });
  }
  return Vectorizer.embed(query, index);
}

function rank(index, query, qvec, k, alpha) {
  const entries = index.entries;
  const n = entries.length;
  if (!n) return [];

  const dim = index.dim;
  const mat = index.matrix;
  const lengths = index.lengths;
  const avgdl = index.avgdl;

  // Distinct query terms and their idf, flattened — no per-token objects.
  // Terms absent from the corpus vocabulary are dropped: they can never match a
  // span, so keeping them only buys a guaranteed-miss lookup per span.  The
  // dense side still sees them, through the query vector.
  const qtf = termCounts(query);
  const qTerms = new Array(qtf.size);
  const qIdf = new Float64Array(qtf.size);
  let qn = 0;
  qtf.forEach((_count, t) => {
    if (!index.vocab.has(t)) return;
    qTerms[qn] = t;
    qIdf[qn] = index.idf(t);
    qn++;
  });

  const dense = new Float64Array(n);
  const lex = new Float64Array(n);
  const cand = new Int32Array(n);
  let nc = 0;
  let lexMin = Infinity;
  let lexMax = -Infinity;

  for (let i = 0; i < n; i++) {
    let dot = 0;
    if (qvec) {
      const off = i * dim;
      for (let d = 0; d < dim; d++) dot += qvec[d] * mat[off + d];   // both unit -> cosine
    }
    let bm = 0;
    if (qn) {
      const terms = entries[i].terms;
      const denomBase = K1 * (1 - B + B * (lengths[i] / avgdl));
      for (let j = 0; j < qn; j++) {
        const tf = terms.get(qTerms[j]);
        if (tf === undefined) continue;
        bm += qIdf[j] * (tf * (K1 + 1)) / (tf + denomBase);
      }
    }
    dense[i] = dot;
    lex[i] = bm;
    if (bm > 0 || dot > 0) {                      // candidate set
      cand[nc++] = i;
      if (bm < lexMin) lexMin = bm;
      if (bm > lexMax) lexMax = bm;
    }
  }
  if (!nc) return [];

  const spread = lexMax - lexMin;
  const scale = spread > 0 ? 1 / spread : 0;      // degenerate set -> 0, ranking-neutral
  const score = new Float64Array(n);
  const norm = new Float64Array(n);
  for (let c = 0; c < nc; c++) {
    const i = cand[c];
    norm[i] = (lex[i] - lexMin) * scale;
    score[i] = alpha * dense[i] + (1 - alpha) * norm[i];
  }

  // Score descending, then spanId ascending.  Code-unit comparison, never
  // localeCompare — collation is locale-dependent and would break replay.
  const order = cand.subarray(0, nc);
  order.sort((x, y) => {
    const d = score[y] - score[x];
    if (d) return d;
    const ax = entries[x].spanId;
    const ay = entries[y].spanId;
    if (ax < ay) return -1;
    if (ax > ay) return 1;
    return x - y;
  });

  const limit = Math.min(nc, k);
  const hits = new Array(limit);
  for (let c = 0; c < limit; c++) {
    const i = order[c];
    const entry = entries[i];
    hits[c] = {
      spanId: entry.spanId,
      score: score[i],
      dense: dense[i],
      lexical: lex[i],                            // raw BM25
      lexicalNorm: norm[i],                       // the min-max value used in `score`
      span: index.spanById.get(entry.spanId) || null,
    };
  }
  return hits;
}

/* --------------------------------------------------------------------- API */

/* Not frozen: registerRemoteEmbedder must be able to rewrite VERSION and DIM so
 * the run manifest records which embedder produced the index. */
export const Vectorizer = {
  DIM: LOCAL_DIM,                 // dimension of the *active* dense space
  LOCAL_DIM,                      // dimension of the frozen local recipe
  VERSION: LOCAL_VERSION,
  K1,
  B,

  /* build(spans, onProgress | { onProgress, yieldEvery }) -> Index
   *
   * onProgress(done, total) is optional; total is spans.length * 2 (one
   * tokenising/df pass, one vector pass) and it fires on a fixed stride.
   *
   * Returns an Index *synchronously* by default, matching the contract's
   * `build(spans): Index`.  It returns a Promise<Index> instead when a remote
   * embedder is registered, or when `yieldEvery: n` asks it to hand the thread
   * back every n spans — which is how a 50k-span corpus builds without freezing
   * the page.  `await Vectorizer.build(...)` is correct in every case. */
  build(spans, onProgress) {
    const list = Array.isArray(spans) ? spans : Array.from(spans || []);
    const rem = remote;
    const version = this.VERSION;
    const dim = rem ? rem.dim : LOCAL_DIM;
    const report = progressFn(onProgress);
    const chunk = yieldEvery(onProgress);
    const total = list.length * 2;
    const tick = report
      ? (done) => { if (done % PROGRESS_STEP === 0 || done === total) report(done, total); }
      : () => {};
    if (report) report(0, total);

    return then(lexicalPass(list, tick, chunk), (state) => {
      if (!list.length) return assemble(state, new Float32Array(0), dim, version, rem);
      if (!rem) return then(localVectors(state, tick, chunk), (m) => assemble(state, m, dim, version, rem));
      return then(remoteVectors(list, rem, state, tick), (m) => assemble(state, m, dim, version, rem));
    });
  },

  /* embed(text, idf) -> Vec
   *
   * Always the local recipe, always LOCAL_DIM: this is the reproducibility
   * reference a Python port is checked against, so a registered remote embedder
   * deliberately does not change it.  `idf` may be an Index, a function, a Map,
   * a plain object, or omitted (all idf = 1). */
  embed(text, idf) {
    const lookup = idfLookup(idf);
    const vec = new Float32Array(LOCAL_DIM);
    termCounts(text).forEach((tf, t) => {
      const h = U.fnv1a32(t) >>> 0;
      const w = (1 + Math.log(tf)) * lookup(t);
      vec[h % LOCAL_DIM] += ((h >>> 31) ? -1 : 1) * w;
    });
    return l2(vec);
  },

  /* search(index, query, { k = 8, alpha = 0.6 }) -> Hit[]
   * score = alpha * cosine + (1 - alpha) * bm25norm.  Synchronous for a locally
   * built index, a promise for a remotely built one. */
  search(index, query, options) {
    if (!index || !index.entries) throw new TypeError('Vectorizer.search: build(spans) first');
    const opts = options || {};
    const rawK = opts.k === undefined ? 8 : opts.k;
    const k = Number.isFinite(rawK) ? Math.max(0, Math.floor(rawK)) : index.entries.length;
    const rawA = opts.alpha === undefined ? 0.6 : opts.alpha;
    const alpha = Number.isFinite(rawA) ? Math.min(1, Math.max(0, rawA)) : 0.6;
    if (k === 0) return index.remote ? Promise.resolve([]) : [];
    return then(queryVector(index, query), (qvec) => rank(index, query, qvec, k, alpha));
  },

  stats(index) {
    if (!index || !index.entries) return { spans: 0, files: 0, vocab: 0, dim: this.DIM, version: this.VERSION };
    return {
      spans: index.entries.length,
      files: index.files,
      vocab: index.vocabSize,
      dim: index.dim,
      version: index.version,
    };
  },

  /* registerRemoteEmbedder({ id, embed, dim?, batch? }) -> new VERSION
   *
   *   id     non-empty string, identifies the embedder in the run manifest
   *   embed  async (texts: string[]) => (Float32Array|number[])[] , one per text
   *   dim    vector length the embedder returns (default 512)
   *   batch  texts per call (default 64)
   *
   * Registering MUST change VERSION so a bundle can never claim a remote index
   * was the local one.  Pass null to go back to local.  Local is the default and
   * makes no network calls. */
  registerRemoteEmbedder(embedder) {
    if (!embedder) {
      remote = null;
      this.DIM = LOCAL_DIM;
      this.VERSION = LOCAL_VERSION;
      return this.VERSION;
    }
    const { id, embed, dim = LOCAL_DIM, batch = 64 } = embedder;
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('registerRemoteEmbedder: { id } must be a non-empty string');
    if (typeof embed !== 'function') throw new TypeError('registerRemoteEmbedder: { embed } must be a function');
    const d = Math.floor(dim);
    if (!Number.isFinite(d) || d < 1) throw new RangeError('registerRemoteEmbedder: { dim } must be a positive integer');
    remote = { id: id.trim(), embed, dim: d, batch: Math.max(1, Math.floor(batch) || 1) };
    this.DIM = d;
    this.VERSION = `remote-${remote.id}`;
    return this.VERSION;
  },

  /* Deterministic identity for an index, for the run manifest. */
  async digest(index) {
    const ids = index.entries.map((e) => e.spanId).join('\n');
    return U.stableId('vindex', index.version, String(index.dim), String(index.entries.length), ids);
  },

  /* Parity helpers — exposed so verify/ can check the JS and Python tokenisers
   * agree.  Not part of the retrieval path. */
  tokens(text) { const out = []; tokenize(text, (t) => out.push(t)); return out; },
  normalize(text) { return normalizeText(text); },
};
