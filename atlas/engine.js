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

  // ---- typed query planning + evidence ----------------------------------
  const sourceCache = new Map();
  const MONTHS = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };

  const flatText = (text) => text.replace(/\s+/g, " ").trim();
  const cleanMarkdown = (text) => flatText(text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`#>]/g, "")
    .replace(/^\s*[-+]\s+/gm, ""));

  function fuzzyWordHit(word, haystack) {
    if (haystack.has(word)) return true;
    if (word.length < 5) return false;
    for (const candidate of haystack)
      if (candidate.length >= 5 && word.slice(0, 5) === candidate.slice(0, 5)) return true;
    return false;
  }

  function overlapCount(questionWords, text) {
    const target = contentWords(text);
    let hits = 0;
    for (const word of questionWords) if (fuzzyWordHit(word, target)) hits++;
    return hits;
  }

  const docById = (data, id) => data.doclist.find((doc) => doc.id === id);
  const docWords = (doc) => contentWords([
    doc.title, doc.service, ...(doc.tags || []), doc.source,
  ].join(" "));

  function docScores(data, question, type, results = []) {
    const qWords = contentWords(question);
    const retrieved = new Map();
    for (const [point, score] of results)
      retrieved.set(point.doc_id, Math.max(retrieved.get(point.doc_id) || 0, score));
    return data.doclist
      .filter((doc) => !type || doc.type === type)
      .map((doc) => {
        const words = docWords(doc);
        let lexical = 0;
        for (const word of qWords) if (fuzzyWordHit(word, words)) lexical++;
        if (question.toLowerCase().includes(doc.title.toLowerCase())) lexical += 4;
        return { doc, score: lexical + 4 * (retrieved.get(doc.id) || 0) };
      })
      .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));
  }

  async function loadSource(doc) {
    const key = `${current ? current.slug : "default"}:${doc.id}`;
    if (!sourceCache.has(key)) {
      let pending;
      pending = fetch(window.ATLAS_FILES_BASE + doc.source)
        .then((response) => {
          if (!response.ok) throw new Error(`source ${response.status}: ${doc.source}`);
          return response.text();
        })
        .catch((error) => {
          if (sourceCache.get(key) === pending) sourceCache.delete(key);
          throw error;
        });
      sourceCache.set(key, pending);
    }
    return sourceCache.get(key);
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") {
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else if (char !== "\r") field += char;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const headers = rows[0] || [];
    return {
      headers,
      rows: rows.slice(1).map((cells, index) => ({
        cells,
        rowNumber: index + 2,
        values: Object.fromEntries(headers.map((header, column) => [header, cells[column] || ""])),
      })),
    };
  }

  function explicitSnapshotIntent(question) {
    return /\b(live|current|currently|right now|system state|status now|open alerts?)\b/i.test(question);
  }

  function matchingSnapshot(question, data) {
    if (!explicitSnapshotIntent(question) || !data.state) return null;
    const ignored = new Set(["live", "current", "currently", "right", "now", "system", "state", "status", "any"]);
    const words = new Set([...contentWords(question)].filter((word) => !ignored.has(word)));
    const all = [];
    let header = "";
    for (const line of data.state.split("\n")) {
      if (line && !/^\s/.test(line)) { header = line; continue; }
      if (line.trim()) all.push({ header, line });
    }
    const scored = all.map((entry) => ({
      ...entry,
      score: [...words].filter((word) => word.length >= 4 && fuzzyWordHit(word, contentWords(`${entry.header} ${entry.line}`))).length,
    }));
    const bestScore = Math.max(0, ...scored.map((entry) => entry.score));
    const matches = scored.filter((entry) => entry.score === bestScore && bestScore > 0);
    if (!matches.length) return null;
    const lines = [];
    let lastHeader = "";
    for (const match of matches.slice(0, 7)) {
      if (match.header !== lastHeader) { lines.push(match.header); lastHeader = match.header; }
      lines.push(match.line);
    }
    const date = data.doclist.map((doc) => doc.updated || "").sort().at(-1) || "unknown";
    return { date, lines };
  }

  function classifyIntent(question) {
    if (/\b(how do|how should|how to|what do (?:we|i)|steps?|procedure|runbook|fail over|check first)\b/i.test(question))
      return "procedure";
    const structured = /\b(how many|count|average|total|sum)\b/i.test(question) ||
      /\b(which|what)\b.*\b(below|under|above|over)\b/i.test(question) ||
      /\bon[ -]?call\b.*\b(week|month|20\d\d)/i.test(question) ||
      /\bwhat was (?:our )?[\w -]+ cost in\b/i.test(question) ||
      /\bhow much (?:does|is|for)\b.*\b(cost|rate)\b/i.test(question);
    if (structured) return "aggregate";
    return "lookup";
  }

  function nearestDocuments(data, question, results, type) {
    return docScores(data, question, type, results).slice(0, 3).map(({ doc }) => ({
      doc_id: doc.id, doc_title: doc.title, doc_type: doc.type, updated: doc.updated,
      format: doc.format, source: doc.source,
    }));
  }

  function ambiguousQuestion(question, scoredDocs) {
    const generic = new Set(["document", "runbook", "incident", "procedure", "say", "says", "mean"]);
    const meaningful = [...contentWords(question)].filter((word) => !generic.has(word));
    if (scoredDocs.length < 2) return false;
    if (meaningful.length <= 1) return true;
    return scoredDocs[0].score < 1.15 && scoredDocs[0].score - scoredDocs[1].score < 0.08;
  }

  function sectionFromMarkdown(markdown, heading) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im"));
    return match ? match[1].trim() : "";
  }

  function parseProcedureSteps(markdown) {
    const section = sectionFromMarkdown(markdown, "Steps");
    if (!section) return [];
    const starts = [...section.matchAll(/^\d+\.\s+/gm)];
    return starts.map((match, index) => {
      const raw = section.slice(match.index, starts[index + 1] ? starts[index + 1].index : section.length).trim();
      const body = raw.replace(/^\d+\.\s+/, "");
      const fence = body.match(/```[^\n]*\n([\s\S]*?)```/);
      const prose = cleanMarkdown(body.replace(/```[\s\S]*?```/g, " "));
      const lead = flatText(body.split("\n")[0]).replace(/[*_`]/g, "");
      return { text: prose, command: fence ? fence[1].trim() : "", evidence: lead };
    }).filter((step) => step.text);
  }

  function citationBase(doc, point) {
    const page = /page\s+(\d+)/i.exec(point ? point.section : "");
    return {
      doc_id: doc.id,
      doc_title: doc.title,
      doc_type: doc.type,
      source: doc.source,
      document_version: doc.updated || "unknown",
      section: point ? point.section : "",
      chunk_id: point ? point.id : "",
      format: doc.format,
      media: point ? point.media_path || "" : "",
      anchor: page ? { type: "page", page: Number(page[1]) } : null,
    };
  }

  async function executeProcedure(data, question, results) {
    const scored = docScores(data, question, "runbook", results);
    if (!scored.length || scored[0].score < 1) return null;
    if (ambiguousQuestion(question, scored)) return { ambiguous: nearestDocuments(data, question, results, "runbook") };
    const doc = scored[0].doc;
    const markdown = await loadSource(doc);
    const steps = parseProcedureSteps(markdown);
    if (!steps.length) throw new Error(`no ordered Steps section in ${doc.source}`);
    const point = results.find(([candidate]) => candidate.doc_id === doc.id)?.[0] ||
      data.points.find((candidate) => candidate.doc_id === doc.id && /^Steps$/i.test(candidate.section));
    const citation = citationBase(doc, point);
    citation.section = "Steps";
    citation.excerpts = steps.map((step) => step.evidence);
    citation.excerpt = citation.excerpts.join("\n");
    citation.anchor = { type: "text", heading: "Steps", excerpt: steps[0].evidence };
    return {
      answer: `${doc.title}: ${steps.length} ordered steps.`,
      answer_blocks: [
        { type: "text", text: `${doc.title}: ${steps.length} ordered steps.` },
        { type: "ol", items: steps.map(({ text, command }) => ({ text, command })) },
      ],
      citations: [citation],
      plan: {
        intent: "PROCEDURE", source: doc.title,
        operation: "EXTRACT ordered items FROM section = Steps",
        freshness: doc.updated || "unknown",
      },
    };
  }

  function datePredicate(question, headers) {
    const dateColumn = headers.find((header) => header === "month") ||
      headers.find((header) => header === "week_start") ||
      headers.find((header) => /(^|_)date$/.test(header));
    if (!dateColumn) return null;
    const iso = question.match(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/);
    if (iso) return { column: dateColumn, op: "starts with", value: iso[0] };
    const month = question.toLowerCase().match(new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\s+((?:19|20)\\d{2})\\b`));
    if (month) return { column: dateColumn, op: "starts with", value: `${month[2]}-${MONTHS[month[1]]}` };
    const year = question.match(/\b((?:19|20)\d{2})\b/);
    return year ? { column: dateColumn, op: "starts with", value: year[1] } : null;
  }

  function structuredPredicates(question, csv) {
    const predicates = [];
    const date = datePredicate(question, csv.headers);
    if (date) predicates.push(date);
    const lower = question.toLowerCase();
    if (/\b(on time|on-time)\b/.test(lower) && csv.headers.includes("on_time"))
      predicates.push({ column: "on_time", op: "=", value: "yes" });
    let outcome = null;
    if (/\b(rolled back|rollback)\b/.test(lower)) outcome = "rolled_back";
    else if (/\b(fail|failed|failure|failures|unsuccessful)\b/.test(lower)) outcome = "failed";
    else if (/\b(succeed|succeeded|success|successful|passed)\b/.test(lower)) outcome = "succeeded";
    if (outcome) {
      if (outcome === "rolled_back" && csv.headers.includes("rolled_back")) {
        const value = csv.rows.map((row) => row.values.rolled_back)
          .find((candidate) => /^(yes|true|1)$/i.test(candidate));
        if (value) predicates.push({ column: "rolled_back", op: "=", value });
      } else {
        const aliases = outcome === "failed"
          ? ["fail", "failed", "failure", "unsuccessful"]
          : outcome === "succeeded"
            ? ["pass", "passed", "success", "succeeded", "successful", "ok"]
            : ["rolled back", "rollback"];
        const columns = csv.headers.filter((header) =>
          /(^|_)(status|result|outcome|resolution)(_|$)/.test(header)
        ).sort((a, b) => overlapCount(contentWords(question), b) - overlapCount(contentWords(question), a));
        for (const column of columns) {
          const value = [...new Set(csv.rows.map((row) => row.values[column]))].find((candidate) => {
            const normalized = candidate.toLowerCase().replace(/[-_]+/g, " ");
            const words = new Set(tokens(normalized));
            return aliases.some((alias) => alias.includes(" ") ? normalized.includes(alias) : words.has(alias));
          });
          if (value) { predicates.push({ column, op: "=", value }); break; }
        }
      }
    }
    const compare = lower.match(/\b(below|under|less than|above|over|greater than)\s+(?:the\s+)?(\d+(?:\.\d+)?)\s*%?/);
    if (compare) {
      const qWords = contentWords(question);
      const numeric = csv.headers.filter((header) =>
        csv.rows.some((row) => row.values[header] !== "" && Number.isFinite(Number(row.values[header])))
      ).sort((a, b) => overlapCount(qWords, b) - overlapCount(qWords, a));
      if (numeric[0]) predicates.push({
        column: numeric[0],
        op: /below|under|less/.test(compare[1]) ? "<" : ">",
        value: Number(compare[2]),
      });
    }
    for (const column of ["line_item", "service", "mode", "status"]) {
      if (!csv.headers.includes(column)) continue;
      const value = [...new Set(csv.rows.map((row) => row.values[column]))].find((candidate) => {
        const words = [...contentWords(candidate)];
        return words.length && words.every((word) => fuzzyWordHit(word, contentWords(question)));
      });
      if (value) predicates.push({ column, op: "=", value });
    }
    return predicates.filter((predicate, index, all) =>
      all.findIndex((other) => other.column === predicate.column && other.op === predicate.op) === index
    );
  }

  function applyPredicates(rows, predicates) {
    return rows.filter((row) => predicates.every((predicate) => {
      const value = row.values[predicate.column] || "";
      if (predicate.op === "starts with") return value.startsWith(String(predicate.value));
      if (predicate.op === "<") return Number(value) < predicate.value;
      if (predicate.op === ">") return Number(value) > predicate.value;
      return value.toLowerCase() === String(predicate.value).toLowerCase();
    }));
  }

  function selectLookupRows(question, rows, operation) {
    if (operation !== "LOOKUP" || rows.length <= 1) return rows;
    const qWords = contentWords(question);
    const scored = rows.map((row) => ({ row, score: overlapCount(qWords, Object.values(row.values).join(" ")) }));
    scored.sort((a, b) => b.score - a.score || a.row.rowNumber - b.row.rowNumber);
    if (!scored.length || scored[0].score < 1) return [];
    return scored.filter((item) => item.score === scored[0].score).slice(0, 8).map((item) => item.row);
  }

  function structuredOperation(question) {
    if (/\b(how many|count)\b/i.test(question)) return "COUNT";
    if (/\b(average|avg|mean)\b/i.test(question)) return "AVG";
    if (/\b(total|sum)\b/i.test(question)) return "SUM";
    if (/\b(below|under|less than|above|over|greater than|which)\b/i.test(question)) return "FILTER";
    return "LOOKUP";
  }

  function numericValue(value) {
    const number = Number(String(value).replace(/[$,%]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function aggregateColumn(csv, question) {
    const qWords = contentWords(question);
    return csv.headers
      .filter((header) => csv.rows.some((row) => numericValue(row.values[header]) !== null))
      .map((header, index) => ({ header, index, score: overlapCount(qWords, header) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.header || null;
  }

  function displayColumns(headers, question) {
    const qWords = contentWords(question);
    const selected = headers.filter((header) => overlapCount(qWords, header) > 0);
    for (const header of headers) {
      if (/(_id|^date$|_date$|month|week_start|name|supplier|primary|secondary|line_item|result|status|cost|rate|unit|lane|on_time|risk_flag)$/.test(header) && !selected.includes(header))
        selected.push(header);
    }
    return (selected.length ? selected : headers).slice(0, 7);
  }

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `$${number.toLocaleString("en-US")}` : value;
  }

  function structuredSummary(question, doc, operation, rows, predicates, aggregate) {
    const first = rows[0] ? rows[0].values : {};
    if (operation === "COUNT") {
      const subject = question.replace(/^.*?how many\s+/i, "").replace(/[?.!]\s*$/, "");
      return `${rows.length.toLocaleString("en-US")} ${subject}.`;
    }
    if (aggregate) {
      const label = aggregate.column.replace(/_/g, " ");
      const formatted = /(?:^|_)(cost|rate|value)(?:_|$)|usd/.test(aggregate.column)
        ? `$${aggregate.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : aggregate.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
      return `${operation === "SUM" ? "Total" : "Average"} ${label}: ${formatted} across ${rows.length.toLocaleString("en-US")} contributing rows.`;
    }
    const compare = question.match(/\b(below|under|above|over)\b.*?(\d+(?:\.\d+)?)\s*%?/i);
    if (compare) {
      const subject = question.match(/\bwhich\s+([a-z-]+)/i)?.[1] || "rows";
      return `${rows.length.toLocaleString("en-US")} ${subject} match ${compare[1].toLowerCase()} ${compare[2]}%.`;
    }
    if (first.rate_usd) return `${first.lane}: ${money(first.rate_usd)} ${first.unit} via ${first.carrier}; ${first.transit_days} days; valid through ${first.valid_thru}.`;
    if (first.cost_usd) return `${first.month} ${first.line_item} cost: ${money(first.cost_usd)} (${first.usage}).`;
    if (first.week_start) {
      const period = predicates.find((predicate) => predicate.column === "week_start")?.value || "the requested period";
      return `${rows.length} on-call rotations match ${period}.`;
    }
    return `${rows.length.toLocaleString("en-US")} matching ${rows.length === 1 ? "row" : "rows"} in ${doc.title}.`;
  }

  async function executeStructured(data, question, results) {
    const scored = docScores(data, question, "dataset", results);
    if (!scored.length || scored[0].score < 1) return null;
    if (ambiguousQuestion(question, scored)) return { ambiguous: nearestDocuments(data, question, results, "dataset") };
    const doc = scored[0].doc;
    const raw = await loadSource(doc);
    const csv = parseCSVRows(raw);
    if (!csv.headers.length) throw new Error(`empty CSV: ${doc.source}`);
    const predicates = structuredPredicates(question, csv);
    const operation = structuredOperation(question);
    let matching = applyPredicates(csv.rows, predicates);
    matching = selectLookupRows(question, matching, operation);
    if (!matching.length) return { empty: doc, predicates };
    let aggregate = null;
    if (operation === "SUM" || operation === "AVG") {
      const column = aggregateColumn(csv, question);
      if (!column) return null;
      matching = matching.filter((row) => numericValue(row.values[column]) !== null);
      if (!matching.length) return { empty: doc, predicates };
      const total = matching.reduce((sum, row) => sum + numericValue(row.values[column]), 0);
      aggregate = { column, value: operation === "AVG" ? total / matching.length : total };
    }
    const columns = displayColumns(csv.headers, question);
    if (aggregate && !columns.includes(aggregate.column)) columns.unshift(aggregate.column);
    const shown = matching.slice(0, 12);
    const summary = structuredSummary(question, doc, operation, matching, predicates, aggregate);
    const scanStart = 2, scanEnd = csv.rows.length + 1;
    const excerptRows = shown.slice(0, 8);
    const citation = citationBase(doc, data.points.find((point) => point.doc_id === doc.id));
    const rowNumbers = matching.map((row) => row.rowNumber);
    const consecutive = rowNumbers.every((number, index) => !index || number === rowNumbers[index - 1] + 1);
    citation.section = matching.length <= 12
      ? matching.length === 1
        ? `CSV row ${rowNumbers[0]}`
        : consecutive
          ? `CSV rows ${rowNumbers[0]}-${rowNumbers.at(-1)}`
          : `CSV rows ${rowNumbers.join(", ")}`
      : `CSV scan rows ${scanStart}-${scanEnd} - ${matching.length.toLocaleString("en-US")} matched`;
    citation.excerpt = [columns.join(","), ...excerptRows.map((row) => columns.map((column) => row.values[column]).join(","))].join("\n");
    citation.anchor = { type: "csv", row_numbers: shown.map((row) => row.rowNumber) };
    return {
      answer: summary,
      answer_blocks: [
        { type: "text", text: summary },
        {
          type: "table", columns,
          rows: shown.map((row) => columns.map((column) => row.values[column])),
          caption: `${shown.length.toLocaleString("en-US")} of ${matching.length.toLocaleString("en-US")} ${aggregate ? "contributing" : "matching"} rows`,
        },
      ],
      citations: [citation],
      plan: {
        intent: operation, source: doc.title,
        filters: predicates.map((predicate) => `${predicate.column} ${predicate.op} ${predicate.value}`),
        operation: operation === "COUNT"
          ? `COUNT(${matching.length.toLocaleString("en-US")} matching rows)`
          : aggregate
            ? `${operation}(${aggregate.column}) over ${matching.length.toLocaleString("en-US")} matching rows`
            : `${operation}(${matching.length.toLocaleString("en-US")} rows)`,
        freshness: doc.updated || "unknown",
      },
    };
  }

  function sentenceUnits(text) {
    const units = [];
    let inFence = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("```")) { inFence = !inFence; continue; }
      if (inFence || !line || /^#+\s/.test(line)) continue;
      if (/^(?:[-*]|\d+\.)\s/.test(line) || line.startsWith("**")) units.push(line);
      else for (const sentence of line.split(/(?<=[.!?])\s+/)) if (sentence.trim()) units.push(sentence.trim());
    }
    return units;
  }

  function coherentLookupExcerpt(point, question) {
    const units = sentenceUnits(point.text);
    if (!units.length) return cleanMarkdown(point.text);
    const qWords = contentWords(question);
    const ranked = units.map((unit, index) => ({ unit, index, score: overlapCount(qWords, unit) }))
      .sort((a, b) => b.score - a.score || a.unit.length - b.unit.length);
    const best = ranked[0];
    const start = Math.max(0, best.index - 1), end = Math.min(units.length, best.index + 2);
    return units.slice(start, end).join("\n");
  }

  function executeLookup(data, question, results) {
    const retrieved = new Map(results.map(([point, score]) => [point.id, score]));
    const qWords = contentWords(question);
    const monthWords = new Set(Object.keys(MONTHS));
    const unsupported = [...qWords].filter((word) => !monthWords.has(word) &&
      !data.points.some((point) => fuzzyWordHit(word, point._words)));
    if (unsupported.length) return null;
    const rankedPoints = data.points.map((point) => ({
      point,
      score: 2 * overlapCount(qWords, point.text) +
        overlapCount(qWords, `${point.title} ${point.section}`) +
        2 * (retrieved.get(point.id) || 0) +
        (/\bcost\b/i.test(question) ? Math.min(8, (point.text.match(/\$[\d,]+/g) || []).length * 2) : 0) +
        (/\bwho approved\b/i.test(question) && /\bapproved?\b/i.test(point.text) ? 4 : 0),
    })).sort((a, b) => b.score - a.score);
    if (!rankedPoints.length || rankedPoints[0].score < 1) return null;
    const { point, score } = rankedPoints[0];
    const distinctDocs = [];
    for (const entry of rankedPoints)
      if (!distinctDocs.some((candidate) => candidate.point.doc_id === entry.point.doc_id)) distinctDocs.push(entry);
    const ambiguityScores = distinctDocs.slice(0, 5).map((entry) => ({ doc: docById(data, entry.point.doc_id), score: entry.score }));
    if (ambiguousQuestion(question, ambiguityScores)) return { ambiguous: nearestDocuments(data, question, results) };
    const doc = docById(data, point.doc_id);
    const excerpt = coherentLookupExcerpt(point, question);
    if (!doc || !excerpt) return null;
    const citation = citationBase(doc, point);
    citation.excerpt = excerpt;
    if (!citation.anchor) citation.anchor = { type: "text", heading: point.section, excerpt: excerpt.split("\n")[0] };
    return {
      answer: cleanMarkdown(excerpt),
      answer_blocks: [{ type: "text", text: cleanMarkdown(excerpt) }],
      citations: [citation],
      plan: {
        intent: "LOOKUP", source: doc.title,
        operation: `BEST sentence + adjacent context FROM ${point.section}`,
        freshness: doc.updated || "unknown",
      },
      score,
    };
  }

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
          store: "in-browser", llm: "typed-js",
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
      const intent = classifyIntent(question);
      const snapshot = intent === "procedure" ? null : matchingSnapshot(question, d);
      let executed = null;
      let answerState = "answered";
      let sourceScope = "corpus";
      let warnings = [];

      if (snapshot && intent === "lookup") {
        executed = {
          answer: `SNAPSHOT ${snapshot.date}\n${snapshot.lines.join("\n")}`,
          answer_blocks: [{ type: "snapshot", date: snapshot.date, lines: snapshot.lines }],
          citations: [],
          plan: {
            intent: "SNAPSHOT", source: "packaged system state",
            operation: "FILTER snapshot lines by explicit current-state terms",
            freshness: snapshot.date,
          },
        };
        sourceScope = "snapshot";
        warnings.push("Uncited snapshot state - not backed by a corpus document or connector.");
      } else if (intent === "aggregate") {
        executed = await executeStructured(d, question, results);
      } else if (intent === "procedure") {
        executed = await executeProcedure(d, question, results);
      } else {
        executed = executeLookup(d, question, results);
      }

      if (executed && executed.ambiguous) {
        answerState = "ambiguous";
        const names = executed.ambiguous.map((doc) => doc.doc_title);
        executed = {
          answer: `Which document do you mean? ${names.join("; ")}.`,
          answer_blocks: [
            { type: "text", text: "Which document do you mean?" },
            { type: "documents", documents: executed.ambiguous },
          ],
          citations: [], plan: { intent: intent.toUpperCase(), operation: "CLARIFY document scope" },
        };
      } else if (!executed || executed.empty) {
        answerState = "not_in_corpus";
        const nearest = nearestDocuments(d, question, results, intent === "procedure" ? "runbook" : intent === "aggregate" ? "dataset" : null);
        const emptySource = executed && executed.empty ? ` No matching rows in ${executed.empty.title}.` : "";
        const nearestText = nearest.length ? ` Nearest documents: ${nearest.map((doc) => doc.doc_title).join("; ")}.` : "";
        executed = {
          answer: `Not in corpus.${emptySource}${nearestText}`,
          answer_blocks: [
            { type: "text", text: `Not in corpus.${emptySource}` },
            { type: "documents", label: "Nearest documents", documents: nearest },
          ],
          citations: [], plan: { intent: intent.toUpperCase(), operation: "NO supported answer" },
        };
      } else if (snapshot && sourceScope !== "snapshot") {
        executed.answer_blocks.push({ type: "snapshot", date: snapshot.date, lines: snapshot.lines });
        executed.answer += `\n\nSNAPSHOT ${snapshot.date}\n${snapshot.lines.join("\n")}`;
        sourceScope = "mixed";
        warnings.push("Uncited snapshot state - not backed by a corpus document or connector.");
      }

      const citations = (executed.citations || []).map((citation, index) => ({ ...citation, n: index + 1 }));
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
        answer: executed.answer,
        answer_blocks: executed.answer_blocks,
        answer_state: answerState,
        source_scope: sourceScope,
        intent,
        plan: executed.plan,
        warnings,
        citations,
        mode: { store: "in-browser", llm: "typed-js", cache: "none", embedder: "hashing-js" },
        cached: false,
        latency_ms: Math.max(1, Math.round(performance.now() - t0)),
        retrieved: results.length,
        query_xy,
      };
    },
  };
})();
