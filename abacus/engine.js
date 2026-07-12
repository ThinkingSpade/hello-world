/* Abacus browser engine — a faithful port of abacus/parser.py +
 * semantics.py + engine.py, driven by the same manifest.json. The
 * 30-question golden eval (goldens.json, frozen by the Python engine)
 * pins the two implementations together; the page lets you run it live.
 * Exposes window.Abacus. */
"use strict";

const Abacus = (() => {
  let MAN = null, DB = null;

  const MONTHS = ["january","february","march","april","may","june","july",
                  "august","september","october","november","december"];
  const MIDX = Object.fromEntries(MONTHS.map((m, i) => [m, i + 1]));

  /* ---------------- time grammar (mirrors parser.py) ---------------- */
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const qBounds = (y, q) => {
    const sm = 3 * (q - 1) + 1, em = sm + 2;
    return [`${y}-${pad(sm)}-01`, `${y}-${pad(em)}-${lastDay(y, em)}`];
  };
  const mBounds = (y, m) => [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${lastDay(y, m)}`];
  const shiftYear = (t) => ({ start: (+t.start.slice(0, 4) - 1) + t.start.slice(4),
    end: (+t.end.slice(0, 4) - 1) + t.end.slice(4), label: "same period, prior year" });
  const dshift = (isoStr, days) => {
    const d = new Date(isoStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const prevPeriod = (t) => {
    const n = Math.round((Date.parse(t.end) - Date.parse(t.start)) / 86400000) + 1;
    return { start: dshift(t.start, -n), end: dshift(t.start, -1), label: "previous period" };
  };

  const CMP_RE = /\bvs\.?\s+(?:the\s+)?(?:last|prior|previous)\s+(?:year|quarter|month|period)\b|\byoy\b|\byear over year\b/g;
  const TIME_STRIP = [
    CMP_RE,
    /\bq[1-4]\s*20\d\d\b/g,
    new RegExp(`\\b(?:${MONTHS.join("|")})\\s*(?:20\\d\\d)?\\b`, "g"),
    /\blast quarter\b/g, /\bthis quarter\b/g,
    /\blast \d+ months?\b/g, /\blast month\b/g,
    /\bytd\b/g, /\byear to date\b/g, /\bthis year\b/g, /\blast year\b/g,
    /\b20\d\d\b/g,
  ];
  const stripTime = (q) => {
    for (const re of TIME_STRIP) q = q.replace(new RegExp(re.source, "g"), " ");
    return q;
  };

  function parseTime(q) {
    const today = MAN.today;
    const ty = +today.slice(0, 4), tm = +today.slice(5, 7);
    const curQ = Math.floor((tm + 2) / 3);
    let t = null;

    const wantsYoy = /\bvs\.?\s+(?:the\s+)?(?:last|prior|previous) year\b|\byoy\b|\byear over year\b/.test(q);
    const wantsPrev = /\bvs\.?\s+(?:the\s+)?(?:last|prior|previous) (?:quarter|month|period)\b/.test(q);
    q = q.replace(new RegExp(CMP_RE.source, "g"), " ");

    let m = q.match(/\bq([1-4])\s*(20\d\d)\b/);
    if (m) {
      const [s, e] = qBounds(+m[2], +m[1]);
      t = { start: s, end: e, label: `Q${m[1]} ${m[2]}` };
    }
    if (!t) {
      m = q.match(new RegExp(`\\b(${MONTHS.join("|")})\\s*(20\\d\\d)?\\b`));
      if (m) {
        const y = m[2] ? +m[2] : (MIDX[m[1]] <= tm ? ty : ty - 1);
        const [s, e] = mBounds(y, MIDX[m[1]]);
        t = { start: s, end: e, label: `${m[1][0].toUpperCase() + m[1].slice(1)} ${y}` };
      }
    }
    if (!t && /\blast quarter\b/.test(q)) {
      const [y, qq] = curQ > 1 ? [ty, curQ - 1] : [ty - 1, 4];
      const [s, e] = qBounds(y, qq);
      t = { start: s, end: e, label: `Q${qq} ${y} (last quarter)` };
    }
    if (!t && /\bthis quarter\b/.test(q)) {
      const [s, e] = qBounds(ty, curQ);
      t = { start: s, end: e < today ? e : today, label: `Q${curQ} ${ty} (this quarter)` };
    }
    if (!t) {
      m = q.match(/\blast (\d+) months?\b/);
      if (m) {
        let ay = ty, am = tm;
        for (let i = 0; i < +m[1] - 1; i++) { am--; if (am === 0) { am = 12; ay--; } }
        t = { start: `${ay}-${pad(am)}-01`, end: today, label: `last ${m[1]} months` };
      }
    }
    if (!t && /\blast month\b/.test(q)) {
      const [ay, am] = tm === 1 ? [ty - 1, 12] : [ty, tm - 1];
      const [s, e] = mBounds(ay, am);
      const name = MONTHS[am - 1];
      t = { start: s, end: e, label: `${name[0].toUpperCase() + name.slice(1)} ${ay} (last month)` };
    }
    if (!t && /\bytd\b|\byear to date\b|\bthis year\b/.test(q))
      t = { start: `${ty}-01-01`, end: today, label: `${ty} YTD` };
    if (!t && /\blast year\b/.test(q))
      t = { start: `${ty - 1}-01-01`, end: `${ty - 1}-12-31`, label: String(ty - 1) };
    if (!t) {
      m = q.match(/\b(?:in|for|during)?\s*(20\d\d)\b/);
      if (m) t = { start: `${m[1]}-01-01`, end: `${m[1]}-12-31`, label: m[1] };
    }
    if (!t) t = { start: "2024-01-01", end: today, label: "all time (2024 → today)" };

    const compare = wantsYoy ? shiftYear(t) : wantsPrev ? prevPeriod(t) : null;
    return [t, compare];
  }

  /* ---------------- synonym scan (mirrors _find) ---------------- */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function find(q, table) {
    const hits = [];
    for (const [key, spec] of Object.entries(table)) {
      for (const syn of [...spec.syn].sort((a, b) => b.length - a.length)) {
        const m = q.match(new RegExp(`(?<![a-z])${esc(syn)}(?![a-z])`));
        if (m) { hits.push([key, m.index, syn.length, syn]); break; }
      }
    }
    return hits;
  }

  function parse(question) {
    const q = question.toLowerCase().trim();
    const [time, compare0] = parseTime(q);
    let compare = compare0;

    const mhits = find(q, MAN.metrics);
    if (!mhits.length) {
      const known = Object.values(MAN.metrics).flatMap((m) => m.syn.slice(0, 2)).sort();
      throw new Error("no metric recognized — try one of: " + [...new Set(known)].join(", "));
    }
    mhits.sort((a, b) => (b[2] - a[2]) || (a[1] - b[1]));
    const metric = mhits[0][0];

    const qd = stripTime(q);
    const dims = [];
    for (const [key, pos, _len, syn] of find(qd, MAN.dimensions).sort((a, b) => a[1] - b[1])) {
      const spec = MAN.dimensions[key];
      const before = qd.slice(Math.max(0, pos - 12), pos);
      if (/\bby\s+$|\bper\s+$|\bacross\s+$|\btop\s+\d+\s*$/.test(before) || spec.time
          || syn.startsWith("by ") || spec.top_default) {
        if (!dims.includes(key)) dims.push(key);
      }
    }

    const filters = [];
    for (const [dim, vals] of Object.entries(MAN.values)) {
      for (const v of vals) {
        if (new RegExp(`(?<![a-z])${esc(v.toLowerCase())}(?![a-z])`).test(qd)) {
          if (!dims.includes(dim)) filters.push({ dim, value: v });
        }
      }
    }

    let top = null;
    const tm2 = qd.match(/\btop\s+(\d+)\b/);
    if (tm2) {
      top = +tm2[1];
      if (!dims.length) dims.push("product");
    }
    if (dims.length > 2) dims.length = 2;
    if (compare && dims.some((d) => !MAN.dimensions[d].time)) compare = null;

    return { metric, dims, filters, time, top, compare };
  }

  /* ---------------- compiler (mirrors semantics.py) ---------------- */
  const BASE = "FROM fact_order_items i JOIN fact_orders o ON i.order_id = o.order_id";
  const JOINS = { p: "JOIN dim_product p ON i.product_id = p.product_id",
                  c: "JOIN dim_customer c ON o.customer_id = c.customer_id" };

  function compilePlan(plan) {
    const metric = MAN.metrics[plan.metric];
    if (!metric) throw new Error("unknown metric: " + plan.metric);
    const dims = (plan.dims || []).map((d) => {
      if (!MAN.dimensions[d]) throw new Error("unknown dimension: " + d);
      return MAN.dimensions[d];
    });
    const filters = plan.filters || [];
    for (const f of filters) {
      if (!MAN.values[f.dim] || !MAN.values[f.dim].includes(f.value))
        throw new Error("unknown filter: " + JSON.stringify(f));
    }
    const { start, end } = plan.time;
    const msql = metric.sql.replaceAll("{start}", start).replaceAll("{end}", end);
    const dsqls = dims.map((d) => d.sql);
    const fsqls = filters.map((f) => `${MAN.dimensions[f.dim].sql} = '${f.value}'`);
    const fAll = plan.metric === "new_customers" ? [...fsqls, "c.customer_id IS NOT NULL"] : fsqls;
    const chunks = [msql, ...dsqls, ...fsqls];
    const joins = ["p", "c"].filter((a) => chunks.some((ch) => ch && ch.includes(a + ".")))
      .map((a) => " " + JOINS[a]).join("");
    const sel = dims.map((d, i) => `${d.sql} AS ${plan.dims[i]}`);
    sel.push(`${msql} AS value`);
    const where = [`o.order_date >= '${start}'`, `o.order_date <= '${end}'`, ...fAll];
    let sql = `SELECT ${sel.join(", ")}\n${BASE}${joins}\nWHERE ${where.join(" AND ")}`;
    if (dims.length) {
      sql += `\nGROUP BY ${dims.map((_, i) => i + 1).join(", ")}`;
      sql += dims.some((d) => d.time) ? "\nORDER BY 1" : "\nORDER BY value DESC";
    }
    let top = plan.top;
    if (!top && dims.length) {
      const td = Math.max(...dims.map((d) => d.top_default || 0));
      if (td) top = td;
    }
    if (top && dims.length) sql += `\nLIMIT ${Math.trunc(top)}`;
    return sql;
  }

  /* ---------------- runner + narration (mirrors engine.py) ---------------- */
  function exec(sql) {
    const t0 = performance.now();
    const res = DB.exec(sql);
    const ms = performance.now() - t0;
    if (!res.length) return { columns: ["value"], rows: [], ms };
    return { columns: res[0].columns, rows: res[0].values.map((r) => [...r]), ms };
  }

  function runPlan(plan) {
    const sql = compilePlan(plan);
    const out = { sql, ...exec(sql) };
    if (plan.compare) {
      const prior = { ...plan, time: plan.compare, compare: null };
      const psql = compilePlan(prior);
      const pr = exec(psql);
      out.prior = { sql: psql, value: pr.rows.length ? pr.rows[0][pr.rows[0].length - 1] : null, ms: pr.ms };
    }
    return out;
  }

  const nf = (v, min, max) => v.toLocaleString("en-US",
    { minimumFractionDigits: min, maximumFractionDigits: max });
  function fmt(v, kind) {
    if (v === null || v === undefined) return "—";
    if (kind === "money") {
      if (Math.abs(v) >= 1e6) return "$" + nf(v / 1e6, 2, 2) + "M";
      if (Math.abs(v) >= 1e3) return "$" + nf(v / 1e3, 1, 1) + "K";
      return "$" + nf(v, 0, 0);
    }
    if (kind === "money2") return "$" + nf(v, 2, 2);
    if (kind === "pct") return nf(v, 1, 1) + "%";
    return nf(v, 0, 0);
  }

  function narrate(plan, result) {
    const m = MAN.metrics[plan.metric];
    const { label } = m, kind = m.fmt;
    const t = plan.time.label;
    const rows = result.rows;
    const where = (plan.filters || []).map((f) => ` · ${f.value}`).join("");

    if (!plan.dims.length) {
      const v = rows.length ? rows[0][rows[0].length - 1] : null;
      let line = `${label}${where}, ${t}: ${fmt(v, kind)}.`;
      const prior = result.prior;
      if (prior && prior.value !== null && prior.value !== 0 && v !== null) {
        const d = 100 * (v - prior.value) / Math.abs(prior.value);
        line += ` That's ${d >= 0 ? "+" : ""}${nf(d, 1, 1)}% vs ${plan.compare.label} (${fmt(prior.value, kind)}).`;
      }
      return line;
    }
    if (!rows.length) return `${label}${where}, ${t}: no rows matched.`;
    const dim0 = plan.dims[0];
    const last = (r) => r[r.length - 1];
    if (MAN.dimensions[dim0].time) {
      const vals = rows.map(last).filter((v) => v !== null);
      const total = vals.reduce((a, b) => a + b, 0);
      const peak = rows.reduce((a, b) => (last(a) || 0) >= (last(b) || 0) ? a : b);
      const chg = rows[0] && last(rows[0]) ? 100 * (last(rows[rows.length - 1]) - last(rows[0])) / Math.abs(last(rows[0])) : 0;
      const isSum = kind === "money" || kind === "int";
      const agg = isSum ? fmt(total, kind) : fmt(total / vals.length, kind);
      return `${label}${where} by ${dim0}, ${t}: ${isSum ? "total" : "average"} ${agg} across ${rows.length} ${dim0}s — peak ${peak[0]} at ${fmt(last(peak), kind)}, ${chg >= 0 ? "+" : ""}${nf(chg, 1, 1)}% first-to-last.`;
    }
    const top = rows[0];
    let line = `${label}${where} by ${dim0}, ${t}: ${top[0]} leads at ${fmt(last(top), kind)}`;
    if (rows.length > 1) {
      const tail = rows[rows.length - 1];
      line += `; ${tail[0]} trails at ${fmt(last(tail), kind)}`;
    }
    if (kind === "money" || kind === "int") {
      const total = rows.map(last).filter((v) => v !== null).reduce((a, b) => a + b, 0);
      if (total) line += ` (${Math.round(100 * last(top) / total)}% of the shown total)`;
    }
    return line + ".";
  }

  /* ---------------- LLM planner (BYO key — validated, never writes SQL) --- */
  function llmPrompt(question) {
    return `You are Abacus's query planner. Map the user's question onto this semantic layer and reply with ONLY a JSON object, no prose, no code fences.

Schema: {"metric": <one metric key>, "dims": [<0-2 dimension keys>], "filters": [{"dim": <dim with values>, "value": <exact value>}], "time_phrase": <the question's time words verbatim, e.g. "last quarter", "q2 2026", "in 2025", or "all time">, "compare_phrase": <"vs last year" | "vs previous period" | null>, "top": <integer or null>}

Metric keys: ${Object.entries(MAN.metrics).map(([k, v]) => `${k} (${v.syn[0]})`).join(", ")}
Dimension keys: ${Object.keys(MAN.dimensions).join(", ")}
Filterable values: ${Object.entries(MAN.values).map(([d, vs]) => `${d}: ${vs.join("/")}`).join("; ")}
Warehouse clock: today is ${MAN.today}.

Question: ${question}`;
  }

  function validateLLMPlan(raw, question) {
    let obj = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    obj = JSON.parse(obj);
    if (!MAN.metrics[obj.metric]) throw new Error(`model picked unknown metric "${obj.metric}"`);
    const dims = (obj.dims || []).filter((d) => MAN.dimensions[d]).slice(0, 2);
    const filters = (obj.filters || []).filter((f) =>
      MAN.values[f.dim] && MAN.values[f.dim].includes(f.value));
    const phrase = `${obj.time_phrase || "all time"} ${obj.compare_phrase || ""}`.toLowerCase();
    const [time, compare0] = parseTime(phrase);
    let compare = compare0;
    if (compare && dims.some((d) => !MAN.dimensions[d].time)) compare = null;
    const top = Number.isInteger(obj.top) && obj.top > 0 && obj.top <= 50 ? obj.top : null;
    return { metric: obj.metric, dims, filters, time, top, compare };
  }

  async function llmPlan(question, cfg) {
    const t0 = performance.now();
    let text, usage = "";
    if (cfg.provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model: cfg.model, max_tokens: 300,
          messages: [{ role: "user", content: llmPrompt(question) }] }),
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      text = j.content[0].text;
      usage = j.usage ? `${j.usage.input_tokens}+${j.usage.output_tokens} tok` : "";
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model,
          messages: [{ role: "user", content: llmPrompt(question) }],
          response_format: { type: "json_object" } }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      text = j.choices[0].message.content;
      usage = j.usage ? `${j.usage.prompt_tokens}+${j.usage.completion_tokens} tok` : "";
    }
    const ms = Math.round(performance.now() - t0);
    return { plan: validateLLMPlan(text, question), raw: text, ms, usage };
  }

  /* ---------------- init ---------------- */
  async function init(paths) {
    const [SQL, manRes, dbRes] = await Promise.all([
      initSqlJs({ locateFile: (f) => paths.vendor + f }),
      fetch(paths.manifest).then((r) => r.json()),
      fetch(paths.db).then((r) => r.arrayBuffer()),
    ]);
    MAN = manRes;
    DB = new SQL.Database(new Uint8Array(dbRes));
    return { manifest: MAN };
  }

  return { init, parse, compilePlan, runPlan, narrate, fmt, llmPlan, llmPrompt,
           exec, get manifest() { return MAN; } };
})();
window.Abacus = Abacus;
