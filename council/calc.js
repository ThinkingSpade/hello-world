/* calc.js — the only module in this application permitted to produce a number.
 *
 * A language model may PROPOSE a calculation. It may never perform one. Every
 * figure that reaches a claim is computed twice, by two engines that share no
 * code path:
 *
 *   1. SQL, executed by SQLite compiled to WebAssembly.
 *   2. A registered JavaScript reducer, iterating the collapsed rows directly.
 *
 * If the two disagree beyond tolerance the result is returned with
 * `reconciled: false` and claims.js refuses to promote it. Failing closed is
 * the entire value of the design: a number nobody can reproduce is not an
 * answer, it is a rumour.
 *
 * See CONTRACT.md §5.
 */
import { U } from "./util.js";

/* ---------- SQL guard ----------
 * The guard is not a formality. A model-proposed spec is untrusted input that
 * will be handed to a database engine, so the grammar it is allowed to use is
 * deliberately tiny: exactly one SELECT, no statement chaining, no DDL, no
 * file or extension access. Anything else is refused with a reason the user
 * can read. */
const FORBIDDEN = /\b(attach|detach|pragma|insert|update|delete|drop|create|alter|replace|vacuum|reindex|load_extension|readfile|writefile|edit)\b/i;

function stripLiteralsAndComments(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/* ---------- engine ---------- */

let SQL = null;      // the sql.js module
let db = null;       // the live in-memory database
const reducers = new Map();
const loaded = new Map();   // sqlName -> { rows, header, table }

function sqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/* SQLite has no fixed types, but declaring them keeps ORDER BY and comparison
 * behaviour predictable, which matters when the JS reducer has to agree. */
function declaredType(colType) {
  return colType === "number" ? "REAL" : "TEXT";
}

export const Calc = {
  async init(wasmBase = "./vendor/") {
    if (db) return;
    if (!globalThis.initSqlJs) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = wasmBase + "sql-wasm.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Could not load the SQLite engine (vendor/sql-wasm.js)."));
        document.head.appendChild(s);
      });
    }
    SQL = await globalThis.initSqlJs({ locateFile: (f) => wasmBase + f });
    db = new SQL.Database();
  },

  /* Load a collapsed table into SQL *and* keep the row array for the reducer.
   * Both engines therefore start from the identical post-contract rows — the
   * reconciliation tests the calculation, not the ingest. */
  async loadTable(table, contract, name = "t") {
    await Calc.init();
    const cols = table.header.map((h, i) => `${sqlIdent(h)} ${declaredType((table.colTypes || [])[i])}`);
    db.run(`DROP TABLE IF EXISTS ${sqlIdent(name)}`);
    db.run(`CREATE TABLE ${sqlIdent(name)} (${cols.join(", ")})`);

    const ph = table.header.map(() => "?").join(", ");
    const stmt = db.prepare(`INSERT INTO ${sqlIdent(name)} VALUES (${ph})`);
    db.run("BEGIN");
    for (const row of table.rows) {
      stmt.run(row.map((v) => (v === undefined ? null : v)));
    }
    db.run("COMMIT");
    stmt.free();

    // Row objects for the reducer, keyed by column name.
    const objects = table.rows.map((r) => {
      const o = {};
      table.header.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
    loaded.set(name, { table, contract, rows: objects, header: table.header });
    return { name, rows: table.rows.length, columns: table.header.length };
  },

  tableNames() { return [...loaded.keys()]; },
  rowsOf(name = "t") { return (loaded.get(name) || {}).rows || []; },
  schemaOf(name = "t") {
    const e = loaded.get(name);
    if (!e) return null;
    return { name, header: e.header, types: e.table.colTypes, rows: e.rows.length };
  },

  registerReducer(name, fn) { reducers.set(name, fn); },
  reducerNames() { return [...reducers.keys()].sort(); },

  guard(sql) {
    const s = String(sql || "").trim();
    if (!s) return { ok: false, reason: "Empty statement." };
    const bare = stripLiteralsAndComments(s);
    const statements = bare.split(";").map((x) => x.trim()).filter(Boolean);
    if (statements.length !== 1) {
      return { ok: false, reason: `Exactly one statement is allowed; found ${statements.length}.` };
    }
    if (!/^\s*(with\b|select\b)/i.test(bare)) {
      return { ok: false, reason: "Only a single SELECT (optionally preceded by WITH) may be executed." };
    }
    const bad = bare.match(FORBIDDEN);
    if (bad) return { ok: false, reason: `Disallowed keyword: ${bad[0].toUpperCase()}.` };
    return { ok: true };
  },

  /* Execute a spec through both engines and reconcile.
   *
   * Gate 2 is enforced here rather than in the UI on purpose: the check belongs
   * next to the thing it protects, so no future caller can route around it. */
  async run(spec, { requireApproval = true, tolerance = 1e-9, tableName = "t" } = {}) {
    const t0 = performance.now();
    const base = {
      specId: spec.specId, runId: spec.runId || "",
      sqlValue: null, jsValue: null, rows: [],
      reconciled: false, delta: NaN, tolerance, ms: 0, error: null,
    };

    if (requireApproval && !spec.approved) {
      return { ...base, error: `Spec "${spec.name}" has not cleared Gate 2 (calculation definitions).` };
    }
    const g = Calc.guard(spec.sql);
    if (!g.ok) return { ...base, error: `Rejected by SQL guard: ${g.reason}` };

    let rows = [];
    let sqlValue = null;
    try {
      await Calc.init();
      const stmt = db.prepare(spec.sql);
      if (spec.params && Object.keys(spec.params).length) stmt.bind(spec.params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      sqlValue = scalarOf(rows);
    } catch (e) {
      return { ...base, error: `SQL failed: ${e.message}`, ms: performance.now() - t0 };
    }

    const reducer = reducers.get(spec.reducer);
    if (!reducer) {
      return { ...base, rows, sqlValue, ms: performance.now() - t0,
        error: `No independent reducer registered as "${spec.reducer}" — a figure with only one engine behind it cannot be promoted.` };
    }

    let jsValue = null;
    try {
      jsValue = reducer(Calc.rowsOf(tableName), spec.params || {}, { spec });
    } catch (e) {
      return { ...base, rows, sqlValue, ms: performance.now() - t0, error: `Reducer failed: ${e.message}` };
    }

    const delta = (sqlValue === null || jsValue === null)
      ? NaN
      : Math.abs(sqlValue - jsValue) / Math.max(1, Math.abs(sqlValue), Math.abs(jsValue));
    const reconciled = Number.isFinite(delta) && delta <= tolerance;

    return {
      ...base, rows, sqlValue, jsValue, delta, reconciled,
      ms: performance.now() - t0,
      error: reconciled ? null
        : `Engines disagree: SQL returned ${fmtNum(sqlValue)}, the independent reducer returned ${fmtNum(jsValue)} (relative delta ${Number.isFinite(delta) ? delta.toExponential(2) : "n/a"}).`,
    };
  },

  /* Convenience for the sensitivity seat: run the same spec against a table
   * collapsed under a different rule and report how far the answer moves. */
  async sensitivity(spec, variants, opts = {}) {
    const out = [];
    for (const v of variants) {
      const r = await Calc.run({ ...spec, sql: v.sql || spec.sql }, { ...opts, tableName: v.tableName || "t" });
      out.push({ label: v.label, value: r.sqlValue, reconciled: r.reconciled, error: r.error });
    }
    const base = out[0] ? out[0].value : null;
    return out.map((o) => ({
      ...o,
      deltaVsBase: base && o.value !== null ? o.value / base - 1 : null,
    }));
  },

  reset() {
    if (db) { db.close(); db = null; }
    loaded.clear();
  },
};

function scalarOf(rows) {
  if (rows.length !== 1) return null;
  const vals = Object.values(rows[0]);
  if (vals.length !== 1) return null;
  const v = vals[0];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtNum(v) {
  return v === null ? "no scalar" : String(v);
}

/* ---------- built-in reducers ----------
 * These are written deliberately as plain array walks. They must NOT share
 * helpers with anything that generates SQL, because two implementations that
 * share a bug reconcile perfectly and are both wrong. */

Calc.registerReducer("sum", (rows, p) =>
  rows.reduce((a, r) => a + (num(r[p.col]) || 0), 0));

Calc.registerReducer("sum_where", (rows, p) => {
  let t = 0;
  for (const r of rows) if (matches(r, p)) t += num(r[p.col]) || 0;
  return t;
});

Calc.registerReducer("count_where", (rows, p) => {
  let t = 0;
  for (const r of rows) if (matches(r, p)) t++;
  return t;
});

Calc.registerReducer("weighted_sum_where", (rows, p) => {
  // sum(value * weight[key]) — used for rated pages (units x yield) and for
  // price-index measures (units x msrp index).
  const w = p.weights || {};
  let t = 0;
  for (const r of rows) {
    if (!matches(r, p)) continue;
    const k = String(r[p.weightKey]);
    if (!(k in w)) continue;
    t += (num(r[p.col]) || 0) * w[k];
  }
  return t;
});

Calc.registerReducer("ratio_of_windows", (rows, p) => {
  // (measure over window A) / (measure over window B) - 1
  const acc = (from, to) => {
    let t = 0;
    for (const r of rows) {
      const d = String(r[p.dateCol] ?? "").slice(0, 10);
      if (d < from || d > to) continue;
      if (!matches(r, p)) continue;
      const weight = p.weights ? (p.weights[String(r[p.weightKey])] ?? 0) : 1;
      t += (num(r[p.col]) || 0) * weight;
    }
    return t;
  };
  const a = acc(p.fromA, p.toA);
  const b = acc(p.fromB, p.toB);
  return b === 0 ? null : a / b - 1;
});

Calc.registerReducer("distinct_count", (rows, p) => {
  const s = new Set();
  for (const r of rows) if (matches(r, p)) s.add(String(r[p.col] ?? ""));
  return s.size;
});

Calc.registerReducer("share_where", (rows, p) => {
  let num_ = 0, den = 0;
  for (const r of rows) {
    if (!matches(r, p, "denom")) continue;
    const v = num(r[p.col]) || 0;
    den += v;
    if (matches(r, p)) num_ += v;
  }
  return den === 0 ? null : num_ / den;
});

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* A tiny, explicit filter language. Deliberately not an expression evaluator —
 * spec filters arrive from model proposals, and `eval` on untrusted input is
 * exactly the door this project is built to keep shut. */
function matches(row, p, scope = "filter") {
  const filters = scope === "denom" ? (p.denomFilters || []) : (p.filters || []);
  for (const f of filters) {
    const v = row[f.col];
    const s = v === null || v === undefined ? "" : String(v);
    switch (f.op) {
      case "eq":    if (s !== String(f.value)) return false; break;
      case "ne":    if (s === String(f.value)) return false; break;
      case "in":    if (!f.value.map(String).includes(s)) return false; break;
      case "notin": if (f.value.map(String).includes(s)) return false; break;
      case "gte":   if (!(num(v) >= f.value)) return false; break;
      case "lte":   if (!(num(v) <= f.value)) return false; break;
      case "between": {
        const d = s.slice(0, 10);
        if (d < f.value[0] || d > f.value[1]) return false;
        break;
      }
      default: return false;
    }
  }
  return true;
}
