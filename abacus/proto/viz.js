/* Shared result renderer for the Abacus UI prototypes.
 * Every prototype builds the SAME plan objects and calls Viz.run() — so the
 * charts, narration, and math look identical across shells and only the
 * INPUT experience differs. Depends on window.Abacus (engine.js).
 * Charts read CSS vars the host theme must define:
 *   --text --dim --grid --green --coral  and  --viz-accent (chart primary). */
"use strict";
const Viz = (() => {
  const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const F = (v, kind) => Abacus.fmt(v, kind);
  const AC = "var(--viz-accent, #3f5aa0)";

  function barChart(zone, rows, kind) {
    const n = rows.length, W = 860, rowH = 30, L = 210, R = 96, H = n * rowH + 12;
    const vmax = Math.max(...rows.map((r) => r[r.length - 1] || 0));
    let g = "";
    rows.forEach((r, i) => {
      const v = r[r.length - 1] || 0;
      const w = Math.max(2, (W - L - R) * v / (vmax || 1)), y = 6 + i * rowH;
      const label = r.slice(0, -1).join(" · ");
      g += `<text x="${L - 8}" y="${y + 18}" font-size="11" fill="var(--text)" text-anchor="end">${escH(label.length > 28 ? label.slice(0, 27) + "…" : label)}</text>
        <rect class="bar" x="${L}" y="${y + 5}" width="${w.toFixed(1)}" height="${rowH - 12}" rx="4" fill="${AC}"><title>${escH(label)}: ${F(v, kind)}</title></rect>
        <text x="${L + w + 7}" y="${y + 18}" font-size="10.5" font-weight="bold" fill="var(--dim)">${F(v, kind)}</text>`;
    });
    zone.innerHTML = `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
  }

  function lineChart(zone, rows, kind) {
    const W = 860, H = 250, L = 64, R = 20, T = 14, B = 30;
    const vals = rows.map((r) => r[r.length - 1] || 0);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padv = Math.max((hi - lo) * 0.1, Math.abs(hi) * 0.02 + 1e-9);
    lo = Math.min(lo, lo - padv); hi += padv;
    const X = (i) => L + i * (W - L - R) / Math.max(1, rows.length - 1);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = lo + k * (hi - lo) / 4, y = Y(v);
      g += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--grid)"/><text x="${L - 6}" y="${y + 3}" font-size="9" fill="var(--dim)" text-anchor="end">${F(v, kind)}</text>`;
    }
    const nx = Math.min(6, rows.length);
    for (let k = 0; k < nx; k++) {
      const i = Math.round(k * (rows.length - 1) / Math.max(1, nx - 1));
      g += `<text x="${X(i)}" y="${H - 12}" font-size="9" fill="var(--dim)" text-anchor="middle">${escH(rows[i][0])}</text>`;
    }
    const line = rows.map((r, i) => `${X(i).toFixed(1)},${Y(r[r.length - 1] || 0).toFixed(1)}`).join(" ");
    const peakI = vals.indexOf(Math.max(...vals));
    g += `<polygon points="${L},${H - B} ${line} ${W - R},${H - B}" fill="${AC}" opacity=".1"/>
      <polyline points="${line}" fill="none" stroke="${AC}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(peakI)}" cy="${Y(vals[peakI])}" r="4" fill="${AC}"/>
      <text x="${X(peakI)}" y="${Y(vals[peakI]) - 8}" font-size="9.5" font-weight="bold" fill="${AC}" text-anchor="middle">${F(vals[peakI], kind)}</text>
      <rect class="hov" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
      <line class="crs" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--dim)" opacity="0"/>`;
    zone.innerHTML = `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg><div class="tip"></div></div>`;
    const wrap = zone.querySelector(".chartwrap"), svg = wrap.querySelector("svg"),
          hov = svg.querySelector(".hov"), crs = svg.querySelector(".crs"), tip = wrap.querySelector(".tip");
    hov.addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect();
      const fx = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(rows.length - 1, Math.round((fx - L) / ((W - L - R) / Math.max(1, rows.length - 1)))));
      crs.setAttribute("x1", X(i)); crs.setAttribute("x2", X(i)); crs.setAttribute("opacity", ".5");
      tip.innerHTML = `${escH(rows[i][0])} — <b>${F(rows[i][rows[i].length - 1], kind)}</b>`;
      tip.style.opacity = 1;
      tip.style.left = Math.min(r.width - 160, Math.max(0, (X(i) / W) * r.width + 10)) + "px";
      tip.style.top = "8px";
    });
    hov.addEventListener("mouseleave", () => { tip.style.opacity = 0; crs.setAttribute("opacity", "0"); });
  }

  function statTile(zone, plan, result, kind) {
    const v = result.rows.length ? result.rows[0][result.rows[0].length - 1] : null;
    let delta = "";
    if (result.prior && result.prior.value) {
      const d = 100 * (v - result.prior.value) / Math.abs(result.prior.value);
      delta = `<div class="delta ${d >= 0 ? "up" : "dn"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% vs ${escH(plan.compare.label)} (${F(result.prior.value, kind)})</div>`;
    }
    const lbl = Abacus.manifest.metrics[plan.metric].label + " · " + plan.time.label;
    zone.innerHTML = `<div class="stat"><div class="lbl">${escH(lbl)}</div><div class="big">${F(v, kind)}</div>${delta}</div>`;
  }

  function waterfallChart(zone, w, kind) {
    const items = [{ label: "prior", v: w.start, type: "total" },
      ...w.steps.map((s) => ({ label: s.label, v: s.delta, type: s.delta >= 0 ? "up" : "dn" })),
      { label: "current", v: w.end, type: "total" }];
    const W = 860, H = 280, L = 70, R = 16, T = 18, B = 56;
    let run = 0;
    const levels = items.map((it) => { if (it.type === "total") { const a = [0, it.v]; run = it.v; return a; } const a = [run, run + it.v]; run += it.v; return a; });
    const all = levels.flat(), lo = Math.min(0, ...all) * 1.02, hi = Math.max(...all) * 1.08;
    const Y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const bw = Math.min(84, (W - L - R) / items.length - 14), X = (i) => L + i * (W - L - R) / items.length + 7;
    let g = "";
    for (let k = 0; k <= 4; k++) { const v = lo + k * (hi - lo) / 4; g += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 3}" font-size="9" fill="var(--dim)" text-anchor="end">${F(v, kind)}</text>`; }
    items.forEach((it, i) => {
      const [a, b] = levels[i], y0 = Y(Math.max(a, b)), h = Math.max(2, Math.abs(Y(a) - Y(b)));
      const fill = it.type === "total" ? "#5f5a51" : it.type === "up" ? "var(--green)" : "var(--coral)";
      g += `<rect x="${X(i)}" y="${y0}" width="${bw}" height="${h}" rx="3" fill="${fill}" opacity="${it.type === "total" ? ".55" : "1"}"><title>${escH(it.label)}: ${F(it.v, kind)}</title></rect>`;
      const vtxt = it.type === "total" ? F(it.v, kind) : (it.v >= 0 ? "+" : "−") + F(Math.abs(it.v), kind);
      g += `<text x="${X(i) + bw / 2}" y="${y0 - 5}" font-size="9.5" font-weight="bold" fill="var(--dim)" text-anchor="middle">${vtxt}</text>`;
      const lbl = String(it.label).length > 12 ? String(it.label).slice(0, 11) + "…" : it.label;
      g += `<text x="${X(i) + bw / 2}" y="${H - B + (i % 2 ? 27 : 15)}" font-size="9" fill="var(--text)" text-anchor="middle">${escH(lbl)}</text>`;
      if (i < items.length - 1) g += `<line x1="${X(i) + bw}" y1="${Y(levels[i][1])}" x2="${X(i + 1)}" y2="${Y(levels[i][1])}" stroke="var(--dim)" stroke-dasharray="3 3" opacity=".5"/>`;
    });
    g += `<text x="${L}" y="${H - 6}" font-size="9" fill="var(--dim)">bridge by ${escH(w.dim)} — steps reconcile exactly to the total change</text>`;
    zone.innerHTML = `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
  }

  function heatmap(zone, matrix) {
    const maxCols = Math.max(...matrix.map((r) => r.cells.length));
    const mix = (t) => { const a = [243, 240, 233], b = [37, 71, 201]; return a.map((x, i) => Math.round(x + (b[i] - x) * t)); };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let head = `<tr><th style="text-align:left">cohort</th><th>size</th>`;
    for (let k = 0; k < maxCols; k++) head += `<th>+Q${k}</th>`;
    head += "</tr>";
    const body = matrix.map((r) => {
      let tds = `<td class="lab" style="font-weight:700">${escH(r.cohort)}</td><td class="lab">${r.size.toLocaleString("en-US")}</td>`;
      r.cells.forEach((c) => {
        const rgb = mix(Math.min(1, c / 100)), lum = luminance(rgb);
        const text = 1.05 / (lum + 0.05) >= 4.5 ? "#fff" : "#000";
        tds += `<td style="background:rgb(${rgb.join(",")});color:${text}" title="${c}% still active">${Math.round(c)}%</td>`;
      });
      if (maxCols > r.cells.length) tds += `<td class="lab" colspan="${maxCols - r.cells.length}"></td>`;
      return `<tr>${tds}</tr>`;
    }).join("");
    zone.innerHTML = `<div class="table-scroll"><table class="heat">${head}${body}</table></div><div class="ramp">0% <i></i> 100% still ordering &nbsp;·&nbsp; cohort = quarter of first purchase · +Q0 is 100% by construction</div>`;
  }

  function sparkline(points, idx, up) {
    const lo = Math.min(...points), hi = Math.max(...points), rng = hi - lo || 1;
    const P = (v, i) => [(i * 110 / Math.max(1, points.length - 1)), (22 - 18 * (v - lo) / rng)];
    const pts = points.map((v, i) => P(v, i).map((x) => x.toFixed(1)).join(",")).join(" ");
    let mark = "";
    if (idx !== undefined && points[idx] !== undefined) { const [mx, my] = P(points[idx], idx); mark = `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.2" fill="${up ? "var(--green)" : "var(--coral)"}"/>`; }
    return `<svg viewBox="-4 -3 120 32" width="120" height="30"><polyline points="${pts}" fill="none" stroke="#8b857a" stroke-width="1.6"/>${mark}</svg>`;
  }

  function anomalyList(zone, an) {
    if (!an.flags.length) { zone.innerHTML = `<div style="font-size:.8rem;color:var(--dim);padding:.4rem 0">no series moved more than 2σ in ${escH(an.window)} — steady as she goes.</div>`; return; }
    zone.innerHTML = `<div class="table-scroll"><table><tr><th style="text-align:left">series</th><th>month</th><th>MoM</th><th>z</th><th style="text-align:left">shape</th></tr>` +
      an.flags.map((f) => `<tr><td style="text-align:left">${escH(f.series)}</td><td>${escH(f.month)}</td>
        <td style="font-weight:700;color:${f.mom_pct >= 0 ? "var(--green)" : "var(--coral)"}">${f.mom_pct >= 0 ? "+" : ""}${f.mom_pct}%</td>
        <td style="font-weight:700">${f.z >= 0 ? "+" : ""}${f.z}σ</td>
        <td style="text-align:left">${sparkline(f.points, f.idx, f.mom_pct >= 0)}</td></tr>`).join("") +
      `</table></div><div style="font-size:.66rem;color:var(--dim);margin-top:.3rem">${escH(an.method)} · ${an.queries} series scanned</div>`;
  }

  function driverDrilldown(inv, kind) {
    return `<details class="viz-details"><summary>every dimension's contribution (each partitions the exact delta)</summary>` +
      Object.entries(inv.by_dim).map(([dim, rows]) => `<div class="table-scroll"><table style="margin-top:.4rem"><tr><th style="text-align:left">${escH(dim)}</th><th>prior</th><th>current</th><th>Δ</th></tr>
        ${rows.map((r) => `<tr><td style="text-align:left">${escH(r.value)}</td><td>${F(r.prior, kind)}</td><td>${F(r.cur, kind)}</td><td style="font-weight:700;color:${r.delta >= 0 ? "var(--green)" : "var(--coral)"}">${r.delta >= 0 ? "+" : "−"}${F(Math.abs(r.delta), kind)}</td></tr>`).join("")}</table></div>`).join("") + `</details>`;
  }

  function resultTable(result, kind) {
    const head = result.columns.map((c) => `<th>${escH(c)}</th>`).join("");
    const body = result.rows.slice(0, 40).map((r) => `<tr>${r.map((v, i) => `<td>${i === r.length - 1 ? F(v, kind) : escH(v)}</td>`).join("")}</tr>`).join("");
    return `<details class="viz-details"><summary>result table (${result.rows.length} rows)</summary><div class="table-scroll"><table><tr>${head}</tr>${body}</table></div></details>`;
  }

  function planChips(plan) {
    const bits = [];
    const kind = plan.kind || "aggregate";
    if (kind !== "aggregate") bits.push(`<b>${kind.toUpperCase()}</b>`);
    if (plan.metric) bits.push(`metric <b>${plan.metric}</b>`);
    if (plan.dims && plan.dims.length) bits.push(`by <b>${plan.dims.join(", ")}</b>`);
    bits.push(`window <b>${plan.time.label}</b>`);
    for (const f of plan.filters || []) bits.push(`${f.dim} = <b>${f.value}</b>`);
    if (plan.top) bits.push(`top <b>${plan.top}</b>`);
    if (plan.compare) bits.push(`vs <b>${plan.compare.label}</b>`);
    return `<div class="planchips">${bits.map((b) => `<span>${b}</span>`).join("")}</div>`;
  }

  function chart(zone, plan, result, kind) {
    const man = Abacus.manifest;
    if (plan.kind === "investigate") { if (result.waterfall) waterfallChart(zone, result.waterfall, kind); else zone.innerHTML = ""; }
    else if (plan.kind === "retention") heatmap(zone, result.matrix);
    else if (plan.kind === "anomalies") anomalyList(zone, result);
    else if (!plan.dims.length) statTile(zone, plan, result, kind);
    else if (man.dimensions[plan.dims[0]].time && plan.dims.length === 1 && result.rows.length > 1) lineChart(zone, result.rows, kind);
    else barChart(zone, result.rows.slice(0, 14), kind);
  }

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function type(el, text, done) {
    if (REDUCED) { el.textContent = text; if (done) done(); return; }
    let i = 0; const iv = setInterval(() => { i += 4; el.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(iv); if (done) done(); } }, 16);
  }

  // Build the shared result body inside `mount`. opts.onWhy(plan) adds a WHY
  // button on scalar totals; opts.sql shows the compiled SQL (default true).
  function renderCard(mount, plan, result, story, opts = {}) {
    const man = Abacus.manifest;
    const kind = plan.metric ? man.metrics[plan.metric].fmt : "int";
    const showSql = opts.sql !== false;
    mount.innerHTML =
      `${opts.chips === false ? "" : planChips(plan)}
       <div class="viz-story"></div>
       <div class="viz-zone"></div>
       ${plan.kind === "aggregate" && showSql ? `<details class="viz-details"><summary>the compiled SQL</summary><pre class="viz-sql">${escH(result.sql)}${result.prior ? "\n\n-- prior period\n" + escH(result.prior.sql) : ""}</pre></details>` : ""}
       ${plan.kind === "investigate" ? driverDrilldown(result, kind) : ""}
       ${plan.kind === "aggregate" ? resultTable(result, kind) : ""}`;
    chart(mount.querySelector(".viz-zone"), plan, result, kind);
    type(mount.querySelector(".viz-story"), story);
    if (opts.onWhy && plan.kind === "aggregate" && plan.dims.length === 0 && result.rows.length) {
      const b = document.createElement("button");
      b.className = "viz-why"; b.textContent = "🔎 why did it move?";
      b.addEventListener("click", () => opts.onWhy(plan));
      mount.appendChild(b);
    }
    return mount;
  }

  async function run(plan, mount, opts = {}) {
    const { result, story } = Abacus.runAny(plan);
    renderCard(mount, plan, result, story, opts);
    return { result, story };
  }

  // Baseline CSS for chart internals — identical everywhere; themes set the vars.
  function injectCSS() {
    const css = `
      .chartwrap { position: relative; margin-top: .4rem; overflow-x: auto; }
      .chartwrap svg { width: 100%; min-width: 860px; height: auto; display: block; }
      .tip { position: absolute; pointer-events: none; background: var(--text); color: var(--panel, #fff); font-size: .66rem; border-radius: 8px; padding: .35rem .55rem; opacity: 0; transition: opacity .12s; z-index: 5; white-space: nowrap; }
      .bar { transition: opacity .15s; } .bar:hover { opacity: .78; }
      .table-scroll { width: 100%; overflow-x: auto; }
      .viz-zone table { border-collapse: collapse; width: 100%; min-width: 560px; font-size: .72rem; font-variant-numeric: tabular-nums; margin-top: .3rem; }
      .viz-zone th, .viz-zone td { border: 1px solid var(--grid); padding: .18rem .45rem; text-align: right; }
      .viz-zone th:first-child, .viz-zone td:first-child { text-align: left; }
      .viz-zone table.heat { border-spacing: 3px; border-collapse: separate; }
      .viz-zone table.heat td, .viz-zone table.heat th { border: 0; border-radius: 6px; padding: .3rem .35rem; min-width: 2.4rem; text-align: center; font-weight: 700; font-size: .66rem; }
      .viz-zone table.heat th { color: var(--dim); font-weight: 400; } .viz-zone table.heat td.lab { text-align: left; }
      .ramp { display: inline-flex; align-items: center; gap: .35rem; font-size: .62rem; color: var(--dim); margin-top: .3rem; }
      .ramp i { width: 60px; height: 8px; border-radius: 4px; display: inline-block; background: linear-gradient(90deg, #f3f0e9, #2547c9); }
      .stat { text-align: center; padding: .6rem 0 .3rem; }
      .stat .lbl { font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); margin-bottom: .15rem; }
      .stat .big { font-size: 2.6rem; font-weight: 800; font-variant-numeric: tabular-nums; }
      .stat .delta { display: inline-block; font-size: .72rem; font-weight: 700; border-radius: 999px; padding: .1rem .6rem; margin-top: .35rem; }
      .stat .delta.up { color: var(--green); border: 1.5px solid var(--green); } .stat .delta.dn { color: var(--coral); border: 1.5px solid var(--coral); }
      .planchips { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .1rem; }
      .planchips span { font-size: .6rem; font-weight: 700; color: var(--dim); background: var(--chip, rgba(127,127,127,.1)); border: 1px solid var(--grid); border-radius: 999px; padding: .05rem .5rem; }
      .planchips span b { color: var(--viz-accent, #3f5aa0); }
      .viz-story { font-size: .9rem; line-height: 1.6; margin: .5rem 0; min-height: 1.2em; }
      .viz-details { font-size: .7rem; color: var(--dim); margin-top: .35rem; } .viz-details summary { cursor: pointer; }
      .viz-sql { background: #161a20; color: #c9d4e4; border-radius: 8px; padding: .5rem .7rem; font-size: .68rem; overflow-x: auto; white-space: pre-wrap; margin-top: .3rem; }
      .viz-why { font: inherit; cursor: pointer; margin-top: .5rem; border: 2px solid var(--coral); color: #fff; background: var(--coral); border-radius: 8px; padding: .3rem .8rem; font-size: .74rem; font-weight: 800; }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  // Shared bootstrap: fetch warehouse with progress → init engine.
  async function boot(onProgress) {
    const r = await fetch("../data/warehouse.sqlite");
    const total = +r.headers.get("content-length") || 0;
    let dbData;
    if (r.body && total) {
      const reader = r.body.getReader(); const chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (onProgress) onProgress(got, total); }
      const buf = new Uint8Array(got); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; } dbData = buf.buffer;
    } else dbData = await r.arrayBuffer();
    return Abacus.init({ vendor: "../vendor/", manifest: "../data/manifest.json", dbData });
  }

  return { escH, F, run, renderCard, chart, planChips, injectCSS, boot, REDUCED };
})();
window.Viz = Viz;
