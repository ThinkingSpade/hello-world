/* Browser-only dataset onboarding for Abacus. Pure helpers are also exported
 * through CommonJS so the parser/profiler assertions can run without a DOM. */
"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AbacusOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_BYTES = 25 * 1024 * 1024;
  const MAX_ROWS = 300000;
  const DATE_THRESHOLD = 0.8;
  const EMPTY = (value) => value === null || value === undefined || String(value).trim() === "";
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function assert(condition, message) {
    if (!condition) throw new Error("onboarding assertion failed: " + message);
  }

  function quoteIdent(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
  }

  function slug(value) {
    let out = String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!out) out = "column";
    if (/^\d/.test(out)) out = "col_" + out;
    return out;
  }

  function uniqueKey(wanted, used) {
    const base = slug(wanted);
    let key = base, n = 2;
    while (used.has(key)) key = `${base}_${n++}`;
    used.add(key);
    return key;
  }

  function validDate(year, month, day) {
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(0);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCFullYear(year, month - 1, day);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
      return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseDateValue(value, format) {
    const text = String(value ?? "").trim();
    let match;
    if (format === "iso") {
      match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(text);
      return match ? validDate(+match[1], +match[2], +match[3]) : null;
    }
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s].*)?$/.exec(text);
    if (!match) return null;
    return format === "eu"
      ? validDate(+match[3], +match[2], +match[1])
      : validDate(+match[3], +match[1], +match[2]);
  }

  function detectDate(values) {
    const present = values.filter((value) => !EMPTY(value));
    if (!present.length) return { rate: 0, format: null, min: null, max: null };
    let best = { rate: 0, format: null, parsed: [] };
    for (const format of ["iso", "us", "eu"]) {
      const parsed = present.map((value) => parseDateValue(value, format)).filter(Boolean);
      const rate = parsed.length / present.length;
      if (rate > best.rate) best = { rate, format, parsed };
    }
    best.parsed.sort();
    return { rate: best.rate, format: best.format,
      min: best.parsed[0] || null, max: best.parsed[best.parsed.length - 1] || null };
  }

  class CsvParser {
    constructor(maxRows = MAX_ROWS) {
      this.maxRows = maxRows;
      this.rows = [];
      this.row = [];
      this.field = "";
      this.quoted = false;
      this.afterQuote = false;
      this.rowErrors = [];
      this.pending = "";
      this.line = 1;
      this.rowStartLine = 1;
      this.character = 0;
      this.finished = false;
    }

    error(message) {
      if (!this.rowErrors.includes(message)) this.rowErrors.push(message);
    }

    finishField() {
      this.row.push(this.field);
      this.field = "";
      this.afterQuote = false;
    }

    finishRow() {
      this.finishField();
      if (this.row.some((value) => value.trim() !== "") || this.rowErrors.length) {
        this.rows.push({ values: this.row, line: this.rowStartLine, errors: this.rowErrors });
        if (this.rows.length - 1 > this.maxRows)
          throw new Error(`table exceeds the ${this.maxRows.toLocaleString("en-US")}-row cap`);
      }
      this.row = [];
      this.rowErrors = [];
      this.rowStartLine = this.line + 1;
    }

    push(chunk, final = false) {
      if (this.finished) throw new Error("CSV parser already finished");
      const text = this.pending + String(chunk);
      this.pending = "";
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (!final && i === text.length - 1 && (char === "\r" || (this.quoted && char === '"'))) {
          this.pending = char;
          break;
        }
        this.character++;
        if (this.quoted) {
          if (char === '"' && text[i + 1] === '"') {
            this.field += '"';
            i++; this.character++;
          } else if (char === '"') {
            this.quoted = false;
            this.afterQuote = true;
          } else {
            this.field += char;
            if (char === "\n") this.line++;
            else if (char === "\r" && text[i + 1] !== "\n") this.line++;
          }
        } else if (this.afterQuote) {
          if (char === ",") this.finishField();
          else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") { i++; this.character++; }
            this.finishRow(); this.line++; this.rowStartLine = this.line;
          } else {
            this.error(`unexpected character after closing quote near character ${this.character}`);
            this.field += char;
          }
        } else if (char === '"') {
          if (this.field) {
            this.error(`unexpected quote near character ${this.character}`);
            this.field += char;
          } else this.quoted = true;
        } else if (char === ",") this.finishField();
        else if (char === "\n" || char === "\r") {
          if (char === "\r" && text[i + 1] === "\n") { i++; this.character++; }
          this.finishRow(); this.line++; this.rowStartLine = this.line;
        } else this.field += char;
      }
      if (final) {
        if (this.quoted) {
          this.error("unterminated quoted field");
          this.quoted = false;
        }
        if (this.pending) {
          this.field += this.pending;
          this.pending = "";
        }
        this.finishRow();
        this.finished = true;
      }
      return Math.max(0, this.rows.length - 1);
    }
  }

  function finalizeCsv(parser) {
    if (!parser.finished) parser.push("", true);
    if (!parser.rows.length) throw new Error("empty file");
    const headerRow = parser.rows[0];
    if (headerRow.errors.length)
      throw new Error(`CSV row 1: ${headerRow.errors.join("; ")}`);
    headerRow.values[0] = (headerRow.values[0] || "").replace(/^\uFEFF/, "");
    const used = new Set();
    const headers = headerRow.values.map((value, index) => {
      const base = String(value).trim() || `column_${index + 1}`;
      let name = base, n = 2;
      while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
      used.add(name.toLowerCase());
      return name;
    });
    const rows = [];
    const errors = [];
    for (let index = 1; index < parser.rows.length; index++) {
      const source = parser.rows[index];
      const rowNumber = index + 1;
      for (const message of source.errors) errors.push({ row: rowNumber, line: source.line, message });
      if (source.values.length !== headers.length)
        errors.push({ row: rowNumber, line: source.line,
          message: `expected ${headers.length} fields; found ${source.values.length}` });
      rows.push(headers.map((_, column) => source.values[column] ?? ""));
    }
    if (!rows.length) throw new Error("empty file. Only a header was found");
    if (rows.length > MAX_ROWS)
      throw new Error(`table exceeds the ${MAX_ROWS.toLocaleString("en-US")}-row cap`);
    return { headers, rows, errors };
  }

  function parseCsvText(text) {
    const parser = new CsvParser();
    parser.push(text, true);
    return finalizeCsv(parser);
  }

  async function parseCsvFile(file, onProgress = () => {}) {
    if (!file || !file.size) throw new Error("empty file");
    if (file.size > MAX_BYTES) throw new Error("file exceeds the 25 MB cap");
    const parser = new CsvParser();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    try {
      if (file.stream) {
        const reader = file.stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          parser.push(decoder.decode(value, { stream: true }));
          onProgress({ bytes, total: file.size, rows: Math.max(0, parser.rows.length - 1) });
          await tick();
        }
        parser.push(decoder.decode(), true);
      } else {
        const buffer = await file.arrayBuffer();
        bytes = buffer.byteLength;
        parser.push(decoder.decode(buffer), true);
      }
    } catch (error) {
      if (error instanceof TypeError) throw new Error("file is not valid UTF-8 CSV");
      throw error;
    }
    onProgress({ bytes: file.size, total: file.size, rows: Math.max(0, parser.rows.length - 1) });
    return finalizeCsv(parser);
  }

  function basicColumnProfile(name, values, exact = {}) {
    const present = values.filter((value) => !EMPTY(value));
    const numeric = present.map((value) => String(value).trim());
    const allInteger = present.length > 0 && numeric.every((value) => /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value)));
    const allReal = present.length > 0 && numeric.every((value) => value !== "" && Number.isFinite(Number(value)));
    const date = exact.date || detectDate(present);
    let type = exact.type || (allInteger ? "INTEGER" : allReal ? "REAL"
      : date.rate >= DATE_THRESHOLD ? "DATE" : "TEXT");
    if (type === "TEXT" && date.rate >= DATE_THRESHOLD) type = "DATE";
    const distinctSet = exact.distinctValues ? new Set(exact.distinctValues)
      : new Set(present.map((value) => typeof value === "string" ? value.trim() : value));
    const distinct = exact.distinct ?? distinctSet.size;
    let min = exact.min ?? null, max = exact.max ?? null;
    if (type === "DATE" && date.min) { min = date.min; max = date.max; }
    if (min === null && present.length) {
      const comparable = type === "INTEGER" || type === "REAL" ? present.map(Number)
        : type === "DATE" ? present.map((value) => parseDateValue(value, date.format)).filter(Boolean)
        : present.map(String);
      if (comparable.length) { min = comparable.reduce((a, b) => a < b ? a : b); max = comparable.reduce((a, b) => a > b ? a : b); }
    }
    const samples = [];
    for (const value of present) {
      const text = String(value);
      if (!samples.includes(text)) samples.push(text.length > 48 ? text.slice(0, 47) + "…" : text);
      if (samples.length === 4) break;
    }
    return { name, type, nullShare: exact.nullShare ?? (values.length ? (values.length - present.length) / values.length : 1),
      distinct, min, max, samples, distinctValues: distinct <= 200 ? [...distinctSet] : [],
      nonNull: exact.nonNull ?? present.length, date };
  }

  function assignRoles(profiles) {
    const out = profiles.map((profile) => ({ ...profile }));
    const dateCandidates = out.filter((profile) => profile.date?.rate >= DATE_THRESHOLD)
      .sort((a, b) => (b.date.rate - a.date.rate) || (b.nonNull - a.nonNull));
    const timeName = dateCandidates[0]?.name || null;
    for (const profile of out) {
      const ratio = profile.nonNull ? profile.distinct / profile.nonNull : 0;
      const idName = /(^id$|(^|_)id($|_)|identifier|(^|_)key$)/i.test(profile.name);
      const integerId = profile.type === "INTEGER" && ratio >= 0.98 && (profile.nonNull >= 20 || idName);
      const textId = profile.type === "TEXT" && idName && ratio >= 0.9;
      const idLike = integerId || textId;
      const nearUniqueText = (profile.type === "TEXT" || profile.type === "DATE") && ratio >= 0.9 && profile.nonNull >= 20;
      const freeText = profile.type === "TEXT" && profile.samples.length > 0 &&
        profile.samples.reduce((sum, value) => sum + String(value).length, 0) / profile.samples.length > 60;
      let role = "excluded";
      if (profile.name === timeName) role = "time";
      else if (idLike) role = "excluded";
      else if ((profile.type === "INTEGER" || profile.type === "REAL") && !idLike) role = "measure";
      else if (!nearUniqueText && !freeText && profile.distinct >= 2 && profile.distinct <= 200) role = "dimension";
      profile.idLike = idLike;
      profile.freeText = freeText;
      profile.proposedRole = role;
      profile.role = role;
    }
    return out;
  }

  function profileRows(headers, rows) {
    return assignRoles(headers.map((name, column) => basicColumnProfile(name, rows.map((row) => row[column]))));
  }

  function firstResult(db, sql) {
    const result = db.exec(sql);
    return result.length ? result[0].values : [];
  }

  function scanDateColumn(db, sql, nonNull) {
    const formats = Object.fromEntries(["iso", "us", "eu"].map((format) =>
      [format, { count: 0, min: null, max: null }]));
    const samples = [];
    const statement = db.prepare(sql);
    try {
      while (statement.step()) {
        const value = statement.get()[0];
        if (samples.length < 4) samples.push(value);
        for (const [format, stats] of Object.entries(formats)) {
          const parsed = parseDateValue(value, format);
          if (!parsed) continue;
          stats.count++;
          if (stats.min === null || parsed < stats.min) stats.min = parsed;
          if (stats.max === null || parsed > stats.max) stats.max = parsed;
        }
      }
    } finally {
      statement.free();
    }
    let best = { rate: 0, format: null, min: null, max: null };
    for (const [format, stats] of Object.entries(formats)) {
      const rate = nonNull ? stats.count / nonNull : 0;
      if (rate > best.rate) best = { rate, format, min: stats.min, max: stats.max };
    }
    return { samples, date: best };
  }

  function userTables(db) {
    return firstResult(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((row) => String(row[0]));
  }

  async function profileTable(db, table, onProgress = () => {}) {
    const qTable = quoteIdent(table);
    const countRows = firstResult(db, `SELECT COUNT(*) FROM ${qTable}`);
    const rowCount = Number(countRows[0]?.[0] || 0);
    if (!rowCount) throw new Error("empty file. The selected table has no rows");
    if (rowCount > MAX_ROWS) throw new Error(`table exceeds the ${MAX_ROWS.toLocaleString("en-US")}-row cap`);
    const info = firstResult(db, `PRAGMA table_info(${qTable})`);
    if (!info.length) throw new Error("selected table has no columns");
    const rawProfiles = [];
    for (let index = 0; index < info.length; index++) {
      const name = String(info[index][1]);
      const column = `u.${quoteIdent(name)}`;
      const base = `FROM ${qTable} u`;
      const stats = firstResult(db, `SELECT
        SUM(CASE WHEN ${column} IS NULL OR TRIM(CAST(${column} AS TEXT)) = '' THEN 1 ELSE 0 END),
        COUNT(DISTINCT CASE WHEN ${column} IS NULL OR TRIM(CAST(${column} AS TEXT)) = '' THEN NULL ELSE ${column} END),
        MIN(${column}), MAX(${column}),
        SUM(CASE WHEN typeof(${column}) = 'integer' THEN 1 ELSE 0 END),
        SUM(CASE WHEN typeof(${column}) = 'real' THEN 1 ELSE 0 END),
        SUM(CASE WHEN typeof(${column}) = 'text' AND TRIM(${column}) <> '' THEN 1 ELSE 0 END)
        ${base}`)[0];
      const nonNull = rowCount - Number(stats[0] || 0);
      const scan = scanDateColumn(db, `SELECT ${column} ${base}
        WHERE ${column} IS NOT NULL AND TRIM(CAST(${column} AS TEXT)) <> ''`, nonNull);
      const distinctValues = stats[1] <= 200
        ? firstResult(db, `SELECT DISTINCT ${column} ${base} WHERE ${column} IS NOT NULL AND TRIM(CAST(${column} AS TEXT)) <> '' ORDER BY 1 LIMIT 201`).map((row) => row[0])
        : [];
      let type = "TEXT";
      if (Number(stats[4]) === nonNull) type = "INTEGER";
      else if (Number(stats[4]) + Number(stats[5]) === nonNull) type = "REAL";
      const declared = String(info[index][2] || "").toUpperCase();
      if (/BLOB/.test(declared)) type = "BLOB";
      rawProfiles.push(basicColumnProfile(name, scan.samples, { type, nullShare: Number(stats[0] || 0) / rowCount,
        distinct: Number(stats[1] || 0), min: stats[2], max: stats[3], nonNull, distinctValues, date: scan.date }));
      onProgress({ column: index + 1, columns: info.length, rows: rowCount });
      await tick();
    }
    return { rowCount, profiles: assignRoles(rawProfiles) };
  }

  function normalizeCell(value, profile) {
    if (EMPTY(value)) return null;
    const text = String(value).trim();
    if (profile.type === "INTEGER") return Number(text);
    if (profile.type === "REAL") return Number(text);
    if (profile.type === "DATE") return parseDateValue(text, profile.date.format) || text;
    return String(value);
  }

  async function createCsvDatabase(Abacus, headers, rows, profiles, onProgress = () => {}) {
    const db = Abacus.createDatabase();
    const columns = profiles.map((profile) => `${quoteIdent(profile.name)} ${profile.type === "INTEGER" ? "INTEGER" : profile.type === "REAL" ? "REAL" : "TEXT"}`);
    db.run(`CREATE TABLE uploaded (${columns.join(", ")})`);
    db.run("BEGIN");
    const statement = db.prepare(`INSERT INTO uploaded VALUES (${headers.map(() => "?").join(", ")})`);
    try {
      for (let index = 0; index < rows.length; index++) {
        statement.run(rows[index].map((value, column) => normalizeCell(value, profiles[column])));
        if ((index + 1) % 2500 === 0) {
          onProgress({ rows: index + 1, total: rows.length });
          await tick();
        }
      }
      statement.free();
      db.run("COMMIT");
    } catch (error) {
      statement.free();
      db.run("ROLLBACK");
      db.close();
      throw error;
    }
    onProgress({ rows: rows.length, total: rows.length });
    return db;
  }

  function sqlDateExpression(columnSql, format) {
    if (format === "iso") return `substr(TRIM(CAST(${columnSql} AS TEXT)), 1, 10)`;
    const source = `replace(TRIM(CAST(${columnSql} AS TEXT)), '-', '/')`;
    const slash1 = `instr(${source}, '/')`;
    const rest = `substr(${source}, ${slash1} + 1)`;
    const slash2 = `instr(${rest}, '/')`;
    const first = `CAST(substr(${source}, 1, ${slash1} - 1) AS INTEGER)`;
    const second = `CAST(substr(${rest}, 1, ${slash2} - 1) AS INTEGER)`;
    const year = `CAST(substr(${rest}, ${slash2} + 1) AS INTEGER)`;
    const month = format === "eu" ? second : first;
    const day = format === "eu" ? first : second;
    return `printf('%04d-%02d-%02d', ${year}, ${month}, ${day})`;
  }

  function metricFormat(profile, average) {
    if (/(revenue|sales|amount|price|cost|profit|spend|value|income)/i.test(profile.name))
      return average ? "money2" : "money";
    if (average || profile.type === "REAL") return "num2";
    return "int";
  }

  function generateManifest({ profiles, rowCount, table = "uploaded", normalizedDates = false }) {
    const metrics = {}, dimensions = {}, values = {};
    const metricKeys = new Set(), dimKeys = new Set();
    const alias = "u";
    for (const profile of profiles.filter((item) => item.role === "measure")) {
      if (profile.type !== "INTEGER" && profile.type !== "REAL") continue;
      const column = `${alias}.${quoteIdent(profile.name)}`;
      const key = uniqueKey(profile.name, metricKeys);
      const label = profile.name.replace(/_/g, " ");
      metrics[key] = { label: `${label} · sum`, fmt: metricFormat(profile, false),
        syn: [label.toLowerCase(), `sum ${label}`.toLowerCase(), `total ${label}`.toLowerCase()],
        sql: `SUM(${column})`, additive: true };
      const avgKey = uniqueKey(`${key}_average`, metricKeys);
      metrics[avgKey] = { label: `${label} · average`, fmt: metricFormat(profile, true),
        syn: [`average ${label}`.toLowerCase(), `avg ${label}`.toLowerCase(), `mean ${label}`.toLowerCase()],
        sql: `1.0 * SUM(${column}) / NULLIF(COUNT(${column}), 0)`, additive: false };
    }
    if (!Object.keys(metrics).length) throw new Error("nothing to measure");

    for (const profile of profiles.filter((item) => item.role === "dimension")) {
      const key = uniqueKey(profile.name, dimKeys);
      const label = profile.name.replace(/_/g, " ");
      dimensions[key] = { label, sql: `${alias}.${quoteIdent(profile.name)}`,
        ...(profile.distinct > 20 ? { top_default: 10 } : {}),
        syn: [label.toLowerCase(), `by ${label}`.toLowerCase()] };
      values[key] = [...profile.distinctValues];
    }

    const timeProfile = profiles.find((item) => item.role === "time") || null;
    let timeSql = null, timeStart = "0001-01-01", today = new Date().toISOString().slice(0, 10);
    let monthDimension = null;
    if (timeProfile) {
      const raw = `${alias}.${quoteIdent(timeProfile.name)}`;
      // CSV ingest rewrites date cells to ISO (normalizeCell), so the stored text
      // is ISO regardless of the detected input format; only raw SQLite loads
      // keep their original format.
      const storedFormat = normalizedDates ? "iso" : ((timeProfile.date && timeProfile.date.format) || "iso");
      timeSql = sqlDateExpression(raw, storedFormat);
      timeStart = timeProfile.date.min || timeStart;
      today = timeProfile.date.max || today;
      const month = uniqueKey("month", dimKeys);
      monthDimension = month;
      const quarter = uniqueKey("quarter", dimKeys);
      const year = uniqueKey("year", dimKeys);
      dimensions[month] = { label: "month", sql: `strftime('%Y-%m', ${timeSql})`, time: true,
        syn: ["month", "monthly", "by month", "over time", "trend", "per month"] };
      dimensions[quarter] = { label: "quarter", time: true,
        sql: `strftime('%Y', ${timeSql}) || '-Q' || ((CAST(strftime('%m', ${timeSql}) AS INTEGER) + 2) / 3)`,
        syn: ["quarter", "quarterly", "by quarter", "per quarter"] };
      dimensions[year] = { label: "year", sql: `strftime('%Y', ${timeSql})`, time: true,
        syn: ["year", "yearly", "by year", "annually"] };
    }
    const runtime = { mode: "upload", base: `FROM ${quoteIdent(table)} ${alias}`, joins: {},
      timeSql, timeStart, monthDimension, exclusiveDimensions: [], metricFilters: {}, retention: null,
      driverDimensions: {}, legacyDimensions: [], volumeMetrics: {},
      watchlist: timeSql ? Object.keys(metrics).slice(0, 7).map((metric) => [metric, null]) : [] };
    const manifest = { today, metrics, dimensions, values,
      stats: { orders: 0, items: rowCount, customers: 0, products: 0, rows_total: rowCount },
      source: runtime };
    return { manifest, runtime, timeProfile };
  }

  function csvErrorMessage(errors) {
    if (!errors.length) return "";
    const shown = errors.slice(0, 3).map((error) => `row ${error.row}: ${error.message}`).join("; ");
    return `CSV ${shown}${errors.length > 3 ? `; +${errors.length - 3} more` : ""}`;
  }

  function runPureAssertions() {
    const parsed = parseCsvText('name,note,amount,date\r\nA,"hello, ""world""",10,01/02/2025\r\nB,"line 1\r\nline 2",20,15/02/2025\r\n');
    assert(parsed.rows.length === 2, "quoted/CRLF fixture row count");
    assert(parsed.rows[0][1] === 'hello, "world"', "escaped quote fixture");
    assert(parsed.rows[1][1] === "line 1\r\nline 2", "quoted CRLF fixture");
    const chunked = new CsvParser();
    chunked.push("a,b\r"); chunked.push('\n1,"x"'); chunked.push('"y"\r'); chunked.push("\n", true);
    const chunkedResult = finalizeCsv(chunked);
    assert(chunkedResult.rows[0][1] === 'x"y', "quoted field survives chunk boundaries");
    const garbage = parseCsvText('a,b\n1,"ok"x\n');
    assert(garbage.errors.length === 1 && /after closing quote/.test(garbage.errors[0].message),
      "trailing garbage is a row-level error");

    const headers = ["account_id", "amount", "segment", "order_date", "memo"];
    const rows = Array.from({ length: 24 }, (_, index) => [String(index + 1), String(10 + index / 2),
      index % 2 ? "business" : "consumer", `${index < 12 ? "2024" : "2025"}-${String(index % 12 + 1).padStart(2, "0")}-01`, `note ${index}`]);
    const profiles = profileRows(headers, rows);
    assert(profiles.find((item) => item.name === "account_id").role === "excluded", "near-unique integer id excluded");
    assert(profiles.find((item) => item.name === "amount").role === "measure", "numeric measure proposed");
    assert(profiles.find((item) => item.name === "segment").role === "dimension", "categorical dimension proposed");
    assert(profiles.find((item) => item.name === "order_date").role === "time", "date role proposed");
    const generated = generateManifest({ profiles, rowCount: rows.length });
    assert(JSON.stringify(Object.keys(generated.manifest)) === JSON.stringify(["today", "metrics", "dimensions", "values", "stats", "source"]),
      "generated manifest top-level shape");
    assert(Object.keys(generated.manifest.metrics).length === 2, "SUM and AVG variants generated");
    return true;
  }

  async function runEngineAssertions(Abacus) {
    const parsed = parseCsvText("category,amount,event_date\nA,10,2024-01-15\nA,21,2025-01-15\nB,30,2025-02-15\n");
    const profiles = profileRows(parsed.headers, parsed.rows);
    const db = await createCsvDatabase(Abacus, parsed.headers, parsed.rows, profiles);
    const generated = generateManifest({ profiles, rowCount: parsed.rows.length, normalizedDates: true });

    // regression: US-format CSV dates are stored as ISO by ingest, so the
    // compiled time filter must use the ISO expression, not the input format
    const usParsed = parseCsvText("category,amount,event_date\nA,10,01/15/2024\nA,21,01/15/2025\nB,30,02/15/2025\n");
    const usProfiles = profileRows(usParsed.headers, usParsed.rows);
    const usDb = await createCsvDatabase(Abacus, usParsed.headers, usParsed.rows, usProfiles);
    const usGenerated = generateManifest({ profiles: usProfiles, rowCount: usParsed.rows.length, normalizedDates: true });
    const usTimeSql = usGenerated.runtime.timeSql;
    const usRows = usDb.exec(`SELECT COUNT(*) FROM uploaded u WHERE ${usTimeSql} BETWEEN '2025-01-01' AND '2025-12-31'`);
    assert(Number(usRows[0].values[0][0]) === 2, "US-format dates filter correctly after ISO normalization");
    usDb.close();
    Abacus.mount({ manifest: generated.manifest, db, runtime: generated.runtime });
    const metric = Object.keys(generated.manifest.metrics).find((key) => !key.includes("average"));
    const plan = { kind: "aggregate", metric, dims: [], filters: [],
      time: { start: "2025-01-01", end: "2025-12-31", label: "2025" }, top: null,
      compare: { start: "2024-01-01", end: "2024-12-31", label: "2024" } };
    const sql = Abacus.compilePlan(plan);
    assert(/FROM "uploaded" u/.test(sql), "generated manifest compiles against uploaded table");
    const result = Abacus.runPlan(plan);
    assert(result.rows[0][0] === 51 && result.prior.value === 10, "calendar comparison uses detected date column");
    const average = Object.keys(generated.manifest.metrics).find((key) => key.includes("average"));
    const averageResult = Abacus.runPlan({ ...plan, metric: average, compare: null });
    assert(averageResult.rows[0][0] === 25.5, "generated AVG variant keeps real precision");
    return true;
  }

  return { MAX_BYTES, MAX_ROWS, CsvParser, parseCsvText, parseCsvFile, csvErrorMessage,
    detectDate, parseDateValue, profileRows, profileTable, userTables, assignRoles,
    createCsvDatabase, generateManifest, quoteIdent, runPureAssertions, runEngineAssertions };
});
