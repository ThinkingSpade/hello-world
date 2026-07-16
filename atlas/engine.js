/* Atlas static engine — the demo-mode pipeline ported to the browser.
 *
 * This file makes the exported site (python -m atlas export) fully
 * self-contained: the same hashing embedder, hybrid ranking, relevance
 * floor, and extractive answerer as atlas/{embeddings,pipeline,llm}.py run
 * on precomputed real chunk embeddings shipped in atlas-data.json.
 * Parity matters: fnv1a32/features here must match atlas/embeddings.py.
 */
(() => {
  "use strict";

  const enc = new TextEncoder();

  function fnv1a32(s) {
    let h = 0x811c9dc5;
    for (const b of enc.encode(s)) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  const tokens = (t) => t.toLowerCase().match(/[a-z0-9]+/g) || [];

  const STOP = new Set(
    ("a an and are as at be by do does for from how i in is it of on or our " +
      "the this to we what when where which who why with you your").split(" ")
  );
  const contentWords = (t) =>
    new Set(tokens(t).filter((w) => !STOP.has(w) && w.length > 1));

  function embed(text, dim) {
    const v = new Float32Array(dim);
    const toks = tokens(text);
    const add = (feat, w) => {
      const h = fnv1a32(feat);
      const sign = (h >>> 1) & 1 ? 1 : -1;
      v[h % dim] += sign * w;
    };
    for (const t of toks) add(t, 1.0);
    for (let i = 0; i + 1 < toks.length; i++) add(toks[i] + "_" + toks[i + 1], 0.8);
    for (const t of toks)
      if (t.length > 3)
        for (let i = 0; i <= t.length - 3; i++) add(t.slice(i, i + 3), 0.3);
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
    return v;
  }

  // ---- retrieval (port of AtlasEngine.retrieve) --------------------------
  const VECTOR_W = 0.7, KEYWORD_W = 0.3, TITLE_W = 0.15;
  const TOP_K = 5, PER_DOC_CAP = 2, DEFAULT_MIN_SCORE = 0.28;  // sync: atlas/config.py

  const searchable = (p) => `${p.title} — ${p.section}\n${p.text}`;

  function fuzzyOverlap(qWords, tWords) {
    if (!qWords.size) return 0;
    let hits = 0;
    for (const q of qWords) {
      let hit = tWords.has(q);
      if (!hit && q.length >= 5)
        for (const t of tWords)
          if (t.length >= 5 && q.slice(0, 5) === t.slice(0, 5)) { hit = true; break; }
      if (hit) hits++;
    }
    return hits / qWords.size;
  }

  function retrieve(data, question, qv) {
    const qWords = contentWords(question);
    // IDF-weighted overlap: rare corpus words dominate, common ones barely count
    const idf = (w) => Math.log(1 + data.points.length / (1 + (data._df.get(w) || 0)));
    let qIdfTotal = 0;
    for (const w of qWords) qIdfTotal += idf(w);
    qIdfTotal = qIdfTotal || 1;
    const scored = [];
    for (const p of data.points) {
      let cos = 0;
      for (let i = 0; i < qv.length; i++) cos += qv[i] * p._vec[i];
      let matchedIdf = 0, matchedN = 0;
      for (const w of qWords) {
        if (p._words.has(w)) { matchedIdf += idf(w); matchedN++; continue; }
        if (w.length >= 5) {
          for (const t of p._words)
            if (t.length >= 5 && w.slice(0, 5) === t.slice(0, 5)) {
              matchedIdf += 0.7 * idf(w); matchedN++; break;
            }
        }
      }
      const overlap = matchedIdf / qIdfTotal;
      const title = fuzzyOverlap(qWords, p._titleWords);
      scored.push([p, VECTOR_W * cos + KEYWORD_W * Math.min(overlap, 1) + TITLE_W * title]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const picked = [], perDoc = {};
    const minScore = data.min_score || DEFAULT_MIN_SCORE;
    for (const [p, s] of scored) {
      if (s < minScore) break;
      if ((perDoc[p.doc_id] || 0) >= PER_DOC_CAP) continue;
      picked.push([p, s]);
      perDoc[p.doc_id] = (perDoc[p.doc_id] || 0) + 1;
      if (picked.length >= TOP_K) break;
    }
    return picked;
  }

  // ---- extractive answering (port of ExtractiveLLM) ----------------------
  function sentences(text) {
    const parts = [];
    for (const block of text.split(/(```[\s\S]*?```)/)) {
      if (block.startsWith("```")) { parts.push(block.trim()); continue; }
      for (let line of block.split("\n")) {
        line = line.trim().replace(/^#+/, "").trim();
        if (!line) continue;
        if (line.startsWith("**")) { parts.push(line); continue; }  // transcript line: keep speaker
        for (const s of line.split(/(?<=[.!?])\s+/)) if (s.trim()) parts.push(s.trim());
      }
    }
    return parts;
  }

  function matchingStateLines(qWords, state) {
    if (!state || !qWords.size) return [];
    const liveIntent = /\b(live|current|currently|right now|system state|status)\b/i;
    const stateWords = new Set(
      [...qWords].filter((w) => !/^(?:19|20)\d{2}$/.test(w))
    );
    const hasEntity = [...stateWords].some((w) =>
      w.length >= 3 && state.toLowerCase().includes(w)
    );
    if (!liveIntent.test([...qWords].join(" ")) && !hasEntity) return [];
    const picked = [];
    let header = "", lastHeader = "";
    for (const line of state.split("\n")) {
      if (line && !line.startsWith(" ")) { header = line; continue; }
      const low = line.toLowerCase(), hlow = header.toLowerCase();
      const hit =
        (!hasEntity && liveIntent.test([...qWords].join(" "))) ||
        [...stateWords].some((w) => w.length >= 3 && low.includes(w)) ||
        [...stateWords].some((w) => w.length >= 4 && hlow.includes(w));
      if (hit) {
        if (header && header !== lastHeader) { picked.push(header); lastHeader = header; }
        picked.push(line);
      }
      if (picked.length >= 8) break;
    }
    return picked;
  }

  function generate(question, sources, state) {
    const qWords = contentWords(question);
    const stateLines = matchingStateLines(qWords, state);
    if (!sources.length) {
      if (stateLines.length)
        return "Nothing in the corpus matches that, but the live system state does:\n" +
          stateLines.join("\n");
      return (
        "I couldn't find anything relevant in the corpus for that. " +
        "Try rephrasing, or check that the corpus is ingested (/api/health)."
      );
    }
    const lines = [];
    for (const [n, p] of sources) {
      const scoredSents = sentences(p.text)
        .filter((s) => !s.startsWith("```"))
        .map((s) => {
          const overlap = [...qWords].filter((w) => contentWords(s).has(w)).length;
          return [overlap, s.length, s];
        })
        .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const picks = scoredSents.slice(0, 2).map((t) => t[2]).filter(Boolean);
      if (picks.length) lines.push(`• ${picks.join(" ")} [${n}]`);
    }
    const titles = [...new Set(sources.map(([, p]) => p.title))].join(", ");
    let answer = `From ${titles}:\n\n` + lines.join("\n\n");
    if (stateLines.length) answer += "\n\nLive system state:\n" + stateLines.join("\n");
    return answer;
  }

  const snippet = (text, limit = 220) => {
    const flat = text.split(/\s+/).join(" ");
    return flat.length <= limit ? flat : flat.slice(0, limit - 1).trimEnd() + "…";
  };

  // ---- data loading + the api implementation ----------------------------
  // atlas-manifest.json lists the exported datasets; the first is default.
  let manifest = null;
  let manifestPromise = null;
  let current = null;      // active dataset entry
  let dataPromise = null;
  let dataEntry = null;

  async function loadManifest() {
    if (manifest) return manifest;
    if (!manifestPromise)
      manifestPromise = fetch("atlas-manifest.json")
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.json();
        })
        .then((m) => {
          manifest = m.datasets;
          if (!current) current = manifest[0];
          window.ATLAS_FILES_BASE = current.files;
          return manifest;
        })
        .catch((err) => {
          manifestPromise = null;
          throw err;
        });
    return manifestPromise;
  }

  async function loadData() {
    await loadManifest();
    const entry = current;
    if (!dataPromise || dataEntry !== entry) {
      dataEntry = entry;
      let pending;
      pending = fetch(entry.data)
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.json();
        })
        .then((d) => {
          for (const p of d.points) {
            const vec = new Float32Array(d.dims);
            let norm = 0;
            for (let i = 0; i < d.dims; i++) {
              vec[i] = p.vq[i] * p.vs;
              norm += vec[i] * vec[i];
            }
            norm = Math.sqrt(norm) || 1;
            for (let i = 0; i < d.dims; i++) vec[i] /= norm;
            p._vec = vec;
            p._words = contentWords(searchable(p));
            p._titleWords = contentWords(p.title);
            delete p.vq;
          }
          d._df = new Map();
          for (const p of d.points)
            for (const w of p._words) d._df.set(w, (d._df.get(w) || 0) + 1);
          return d;
        })
        .catch((err) => {
          if (dataPromise === pending) {
            dataPromise = null;
            dataEntry = null;
          }
          throw err;
        });
      dataPromise = pending;
    }
    const loaded = await dataPromise;
    if (entry !== current) throw new Error("Dataset changed while loading");
    return loaded;
  }

  window.ATLAS_FILES_BASE = "corpus-files/";
  window.AtlasStaticApi = {
    datasets: async () => {
      await loadManifest();
      return { list: manifest, current: current.slug };
    },
    setDataset: async (slug) => {
      await loadManifest();
      const entry = manifest.find((m) => m.slug === slug);
      if (!entry || entry === current) return false;
      current = entry;
      window.ATLAS_FILES_BASE = entry.files;
      dataPromise = null;  // next loadData() fetches the new dataset
      dataEntry = null;
      return true;
    },
    health: async () => {
      const d = await loadData();
      return {
        status: "ok",
        version: "static",
        components: {
          store: "in-browser", llm: "extractive-js",
          cache: "none", embedder: "hashing-js",
        },
        docs: d.docs,
        chunks: d.count,
      };
    },
    docs: async () => {
      const d = await loadData();
      return { docs: d.doclist, count: d.doclist.length };
    },
    map: async () => {
      const d = await loadData();
      return d;
    },
    ask: async (question) => {
      const t0 = performance.now();
      const d = await loadData();
      const qv = embed(question, d.dims);
      const results = retrieve(d, question, qv);
      const sources = results.map(([p], i) => [i + 1, p]);
      const answer = generate(question, sources, d.state);
      const citations = results.map(([p, s], i) => ({
        n: i + 1,
        doc_id: p.doc_id,
        doc_title: p.title,
        doc_type: p.type,
        section: p.section,
        snippet: snippet(p.text),
        score: Math.round(s * 10000) / 10000,
        chunk_id: p.id,
        format: p.format,
        media: p.media_path || "",
      }));
      // project the query into the same PCA basis as the map
      let query_xy = null;
      if (d.mean && d.comps) {
        const c0 = d.comps[0], c1 = d.comps[1];
        let x = 0, y = 0;
        for (let i = 0; i < d.dims; i++) {
          const v = qv[i] - d.mean[i];
          x += c0[i] * v; y += c1[i] * v;
        }
        query_xy = [x, y];
      }
      return {
        question,
        answer,
        citations,
        mode: { store: "in-browser", llm: "extractive-js", cache: "none", embedder: "hashing-js" },
        cached: false,
        latency_ms: Math.max(1, Math.round(performance.now() - t0)),
        retrieved: results.length,
        query_xy,
      };
    },
  };
})();
