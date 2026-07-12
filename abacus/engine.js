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

  const INVESTIGATE_RE = /^why\b|\bwhy did\b|\bwhy is\b|\bwhat (?:drove|caused)\b|\bexplain the (?:change|drop|dip|spike|jump|move)\b/;
  const RETENTION_RE = /\bretention\b|\bcohorts?\b/;
  const ANOMALY_RE = /\banomal|\boutlier|\bunusual\b|\bweird\b|\bscan\b|\bwhat changed\b/;

  function parse(question) {
    const q = question.toLowerCase().trim();
    const [time, compare0] = parseTime(q);
    let compare = compare0;

    // ---- analyst kinds outrank plain aggregation (mirrors parser.py) ----
    if (RETENTION_RE.test(q))
      return { kind: "retention", metric: null, dims: [], filters: [], time, top: null, compare: null };
    if (ANOMALY_RE.test(q))
      return { kind: "anomalies", metric: null, dims: [], filters: [], time, top: null, compare: null };
    if (INVESTIGATE_RE.test(q)) {
      const mh = find(q, MAN.metrics);
      mh.sort((a, b) => (b[2] - a[2]) || (a[1] - b[1]));
      const metric = mh.length ? mh[0][0] : "revenue";
      const qd0 = stripTime(q);
      const filters = [];
      for (const [dim, vals] of Object.entries(MAN.values))
        for (const v of vals)
          if (new RegExp(`(?<![a-z])${esc(v.toLowerCase())}(?![a-z])`).test(qd0))
            filters.push({ dim, value: v });
      if (!compare) compare = prevPeriod(time);
      return { kind: "investigate", metric, dims: [], filters, time, top: null, compare };
    }

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

    return { kind: "aggregate", metric, dims, filters, time, top, compare };
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
      paths.dbData ? Promise.resolve(paths.dbData)
                   : fetch(paths.db).then((r) => r.arrayBuffer()),
    ]);
    MAN = manRes;
    DB = new SQL.Database(new Uint8Array(dbRes));
    return { manifest: MAN };
  }

  /* ============ the analyst brain (mirrors abacus/analyst.py) ============ */
  const DRIVER_DIMS = ["category", "region", "channel", "segment"];
  const ADDITIVE = new Set(["revenue", "gross_margin", "orders", "units"]);
  const lastCell = (r) => r[r.length - 1];

  function totalOf(metric, time, filters) {
    const r = runPlan({ metric, dims: [], filters, time, top: null });
    return (r.rows.length ? lastCell(r.rows[0]) : 0) || 0;
  }
  function byDim(metric, dim, time, filters) {
    const r = runPlan({ metric, dims: [dim], filters, time, top: null });
    return Object.fromEntries(r.rows.map((row) => [row[0], lastCell(row) || 0]));
  }

  function investigate(plan) {
    const { metric } = plan, curT = plan.time, priT = plan.compare;
    const filters = plan.filters || [];
    let queries = 0;
    const cur = totalOf(metric, curT, filters); queries++;
    const pri = totalOf(metric, priT, filters); queries++;
    const delta = cur - pri;
    const additive = ADDITIVE.has(metric);

    const drivers = [], by_dim = {};
    for (const dim of DRIVER_DIMS) {
      const a = byDim(metric, dim, curT, filters); queries++;
      const b = byDim(metric, dim, priT, filters); queries++;
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const rows = keys.map((k) => ({ value: k, cur: a[k] || 0, prior: b[k] || 0,
                                      delta: (a[k] || 0) - (b[k] || 0) }));
      by_dim[dim] = rows;
      if (additive) for (const r of rows) drivers.push({ dim, value: r.value, delta: r.delta });
    }
    drivers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const top_drivers = drivers.slice(0, 6);

    let vol_price = null;
    if (metric === "revenue" && additive) {
      const o1 = totalOf("orders", curT, filters); queries++;
      const o0 = totalOf("orders", priT, filters); queries++;
      const a1 = o1 ? cur / o1 : 0, a0 = o0 ? pri / o0 : 0;
      const vol = (o1 - o0) * a0, price = o0 * (a1 - a0);
      vol_price = { orders_cur: o1, orders_prior: o0, aov_cur: a1, aov_prior: a0,
                    volume_effect: vol, price_effect: price, interaction: delta - vol - price };
    }

    let waterfall = null;
    if (additive && delta !== 0 && top_drivers.length) {
      const wdim = top_drivers[0].dim;
      const rows = [...by_dim[wdim]].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      const shown = rows.slice(0, 6);
      const other = delta - shown.reduce((s, r) => s + r.delta, 0);
      waterfall = { dim: wdim, start: pri, end: cur,
        steps: [...shown.map((r) => ({ label: r.value, delta: r.delta })),
                ...(Math.abs(other) > 1e-9 ? [{ label: "everything else", delta: other }] : [])] };
    }
    return { kind: "investigate", metric, cur, prior: pri, delta, additive,
             drivers: top_drivers, by_dim, vol_price, waterfall, queries };
  }

  function narrateInvestigation(plan, inv) {
    const m = MAN.metrics[plan.metric], kind = m.fmt;
    const pct = inv.prior ? 100 * inv.delta / Math.abs(inv.prior) : 0;
    const verb = inv.delta > 0 ? "rose" : "fell";
    let line = `${m.label} ${verb} ${nf(Math.abs(pct), 1, 1)}% in ${plan.time.label} vs ${plan.compare.label} (${fmt(inv.prior, kind)} → ${fmt(inv.cur, kind)}, ${inv.delta >= 0 ? "+" : "−"}${fmt(Math.abs(inv.delta), kind)}).`;
    if (inv.additive && inv.drivers.length) {
      const d0 = inv.drivers[0];
      const share = inv.delta ? 100 * d0.delta / inv.delta : 0;
      line += ` The move concentrates in ${d0.dim}: ${d0.value} ${d0.delta >= 0 ? "+" : "−"}${fmt(Math.abs(d0.delta), kind)} (${Math.round(share)}% of the change)`;
      const offs = inv.drivers.filter((d) => (d.delta > 0) !== (inv.delta > 0));
      if (offs.length) line += `; biggest offset ${offs[0].value} ${offs[0].delta >= 0 ? "+" : "−"}${fmt(Math.abs(offs[0].delta), kind)}`;
      line += ".";
    }
    const vp = inv.vol_price;
    if (vp && inv.delta) {
      line += ` Volume vs price: order count explains ${Math.round(100 * vp.volume_effect / inv.delta)}% of it (orders ${vp.orders_prior.toLocaleString("en-US")} → ${vp.orders_cur.toLocaleString("en-US")}), basket size ${Math.round(100 * vp.price_effect / inv.delta)}% (AOV ${fmt(vp.aov_prior, "money2")} → ${fmt(vp.aov_cur, "money2")}).`;
    }
    if (!inv.additive) line += " (Rate metric — showing level shifts per dimension rather than additive contributions.)";
    return line;
  }

  function retention() {
    const firsts = exec("SELECT customer_id, first_order_date FROM dim_customer WHERE first_order_date IS NOT NULL").rows;
    const active = exec("SELECT DISTINCT customer_id, CAST(strftime('%Y', order_date) AS INTEGER) * 4 + (CAST(strftime('%m', order_date) AS INTEGER) + 2) / 3 - 1 FROM fact_orders").rows;
    const qidx = (d) => (+d.slice(0, 4)) * 4 + Math.floor((+d.slice(5, 7) + 2) / 3) - 1;
    const qlabel = (i) => `${Math.floor(i / 4)}-Q${i % 4 + 1}`;
    const cohorts = new Map();
    for (const [cid, f] of firsts) {
      const k = qidx(f);
      if (!cohorts.has(k)) cohorts.set(k, new Set());
      cohorts.get(k).add(cid);
    }
    const actBy = new Map();
    let maxper = 0;
    for (const [cid, per] of active) {
      if (!actBy.has(per)) actBy.set(per, new Set());
      actBy.get(per).add(cid);
      if (per > maxper) maxper = per;
    }
    const matrix = [];
    for (const c of [...cohorts.keys()].sort((a, b) => a - b)) {
      const members = cohorts.get(c), size = members.size;
      const row = { cohort: qlabel(c), size, cells: [] };
      for (let k = 0; c + k <= maxper; k++) {
        const act = actBy.get(c + k) || new Set();
        let hit = 0;
        for (const cid of members) if (act.has(cid)) hit++;
        row.cells.push(size ? Math.round(1000 * hit / size) / 10 : 0);
      }
      matrix.push(row);
    }
    return { kind: "retention", matrix };
  }

  function narrateRetention(ret) {
    const rows = ret.matrix.filter((r) => r.cells.length >= 2 && r.size >= 50);
    if (!rows.length) return "Cohort retention computed — matrix below.";
    const q1 = rows.map((r) => r.cells[1]);
    const best = rows.reduce((a, b) => a.cells[1] >= b.cells[1] ? a : b);
    const worst = rows.reduce((a, b) => a.cells[1] <= b.cells[1] ? a : b);
    return `Behavioral cohorts (quarter of first purchase): next-quarter retention averages ${Math.round(q1.reduce((a, b) => a + b, 0) / q1.length)}% across ${rows.length} cohorts — best ${best.cohort} at ${Math.round(best.cells[1])}%, softest ${worst.cohort} at ${Math.round(worst.cells[1])}%. Every row starts at 100% by construction (the first purchase defines the cohort).`;
  }

  const WATCHLIST = [["revenue", null], ["revenue", "category"], ["revenue", "channel"],
                     ["aov", null], ["return_rate", null], ["discount_rate", null],
                     ["new_customers", null]];

  function anomalyScan(time, zFloor = 2.0) {
    const flags = [];
    let queries = 0;
    for (const [metric, dim] of WATCHLIST) {
      const dims = dim ? ["month", dim] : ["month"];
      const rows = runPlan({ metric, dims, filters: [], time, top: null }).rows; queries++;
      const series = new Map();
      for (const r of rows) {
        const key = dim ? r[1] : "overall";
        if (!series.has(key)) series.set(key, []);
        series.get(key).push([r[0], lastCell(r) || 0]);
      }
      for (const [key, pts] of series) {
        pts.sort((a, b) => a[0] < b[0] ? -1 : 1);
        if (pts.length < 8) continue;
        const moms = [];
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1][1];
          if (prev) moms.push([pts[i][0], 100 * (pts[i][1] - prev) / Math.abs(prev), pts[i][1]]);
        }
        if (moms.length < 6) continue;
        const vals = moms.map((m) => m[1]);
        const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length);
        if (!sd) continue;
        for (let mi = 0; mi < moms.length; mi++) {
          const [month, mom, level] = moms[mi];
          const z = (mom - mu) / sd;
          if (Math.abs(z) >= zFloor) {
            flags.push({ series: MAN.metrics[metric].label + (key !== "overall" ? ` · ${key}` : ""),
                         metric, month, mom_pct: Math.round(mom * 10) / 10,
                         z: Math.round(z * 100) / 100, level, idx: mi + 1,
                         points: pts.map((p) => p[1]) });
          }
        }
      }
    }
    flags.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return { kind: "anomalies", flags: flags.slice(0, 10), queries,
             method: `z-score on month-over-month changes, |z| ≥ ${zFloor}`,
             window: time.label };
  }

  function narrateAnomalies(an) {
    if (!an.flags.length)
      return `Scanned ${an.queries} series over ${an.window} — nothing beats the ${an.method} bar. A quiet warehouse is a finding too.`;
    const f0 = an.flags[0];
    return `Scanned ${an.queries} metric series over ${an.window} (${an.method}): ${an.flags.length} months flagged. Loudest: ${f0.series} in ${f0.month}, ${f0.mom_pct >= 0 ? "+" : ""}${nf(f0.mom_pct, 1, 1)}% month-over-month (z ${f0.z >= 0 ? "+" : ""}${nf(f0.z, 1, 1)}).`;
  }

  function runAny(plan) {
    const kind = plan.kind || "aggregate";
    if (kind === "aggregate") {
      const r = runPlan(plan);
      return { result: r, story: narrate(plan, r) };
    }
    if (kind === "investigate") {
      const inv = investigate(plan);
      return { result: inv, story: narrateInvestigation(plan, inv) };
    }
    if (kind === "retention") {
      const ret = retention();
      return { result: ret, story: narrateRetention(ret) };
    }
    if (kind === "anomalies") {
      const an = anomalyScan(plan.time);
      return { result: an, story: narrateAnomalies(an) };
    }
    throw new Error("unknown plan kind " + kind);
  }

  function canonicalCheck(plan, result) {
    const kind = plan.kind || "aggregate";
    const r4 = (x) => Math.round(x * 10000) / 10000;
    if (kind === "aggregate") return result.rows;
    if (kind === "investigate")
      return [["_total", r4(result.cur), r4(result.prior)],
              ...result.drivers.map((d) => [d.dim, d.value, r4(d.delta)])];
    if (kind === "retention")
      return result.matrix.map((r) => [r.cohort, r.size, ...r.cells]);
    if (kind === "anomalies")
      return result.flags.map((f) => [f.series, f.month, f.z]);
    throw new Error(kind);
  }

  return { init, parse, compilePlan, runPlan, runAny, canonicalCheck,
           narrate, fmt, llmPlan, llmPrompt,
           exec, get manifest() { return MAN; } };
})();
window.Abacus = Abacus;
