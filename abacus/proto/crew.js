/* The Abacus pixel crew — reusable across shells. Renders the four analysts,
 * the traveling query ticket, eye-tracking and idle office life, and a
 * Crew.run(plan, mount, opts) that choreographs a query through the desks and
 * paints the result via Viz. Depends on window.Abacus + window.Viz.
 * Injects its own CSS; the host theme supplies --panel/--line/--text/--dim. */
"use strict";
const Crew = (() => {
  const $ = (id) => document.getElementById(id);
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
  let busy = false, nQ = 0, nSql = 0, nCharts = 0;

  const CREW = [
    { id: "analyst", name: "The Analyst", role: "Reads the question", ac: "#3f5aa0", style: "pony", chip: "0 QUESTIONS",
      bubs: ["hm, 'margin'…", "define 'good'?", "that's a metric", "since when?"],
      idles: ["sharpening pencils", "re-reading old tickets", "aligning the headset"] },
    { id: "librarian", name: "The Librarian", role: "Keeps the semantic layer", ac: "#8f6f1d", style: "bun", chip: "… ON FILE",
      bubs: ["one metric, one card", "no synonym clashes", "joins are earned", "shh."],
      idles: ["dusting the catalog", "re-filing 'revenue'", "stamping new cards"] },
    { id: "machinist", name: "The Machinist", role: "Runs the warehouse", ac: "#2f8a58", style: "cap", chip: "0 QUERIES",
      bubs: ["tk tk tk", "125k rows, no sweat", "full scan? fine.", "wasm hums tonight"],
      idles: ["oiling the flywheel", "listening to the fans", "topping off the cache"] },
    { id: "illustrator", name: "The Illustrator", role: "Inks the answer", ac: "#6a47a0", style: "beret", chip: "0 CHARTS",
      bubs: ["one axis. ONE.", "labels, not legends", "ink the peak", "gridlines whisper"],
      idles: ["cleaning brushes", "mixing the blues", "squaring the easel"] },
  ];

  function pixelChar(c) {
    const ink = "#17181b", suit = "#2e3442", skin = { pony: "#dfa77e", bun: "#d59a72", cap: "#caa27e", beret: "#e2b088" }[c.style];
    const hairC = { pony: "#6b4a2f", bun: "#3a2f28", cap: "#5a4632", beret: "#2a2622" }[c.style];
    let hair = "";
    if (c.style === "pony") hair = `<rect x="50" y="13" width="32" height="9" fill="${hairC}"/><rect x="80" y="18" width="8" height="18" fill="${hairC}"/><rect x="50" y="19" width="5" height="9" fill="${hairC}"/><rect x="46" y="27" width="5" height="10" fill="${ink}"/><rect x="47" y="37" width="3" height="6" fill="${ink}"/><rect x="47" y="43" width="8" height="3" fill="${ink}"/>`;
    else if (c.style === "bun") hair = `<rect x="50" y="14" width="32" height="8" fill="${hairC}"/><rect x="82" y="18" width="9" height="9" fill="${hairC}"/><rect x="50" y="20" width="5" height="12" fill="${hairC}"/>`;
    else if (c.style === "cap") hair = `<rect x="50" y="12" width="32" height="9" fill="${c.ac}"/><rect x="76" y="19" width="14" height="4" fill="${c.ac}"/><rect x="62" y="8" width="8" height="6" fill="${c.ac}"/>`;
    else hair = `<rect x="48" y="12" width="30" height="9" fill="${c.ac}"/><rect x="74" y="10" width="12" height="7" fill="${c.ac}"/><rect x="50" y="19" width="32" height="3" fill="${hairC}"/>`;
    const glasses = c.style === "bun" || c.style === "beret" ? `<rect x="54" y="30" width="10" height="8" fill="none" stroke="${ink}" stroke-width="2"/><rect x="68" y="30" width="10" height="8" fill="none" stroke="${ink}" stroke-width="2"/><rect x="64" y="33" width="4" height="2" fill="${ink}"/>` : "";
    const charts = {
      pony: `<g class="mchart"><rect x="16" y="50" width="18" height="2" fill="#cfd6e4"/><rect x="16" y="55" width="22" height="2" fill="#cfd6e4"/><rect x="16" y="60" width="14" height="2" fill="#cfd6e4"/></g>`,
      bun: `<g class="mchart"><rect x="16" y="50" width="8" height="12" fill="#cfd6e4"/><rect x="27" y="50" width="8" height="12" fill="#cfd6e4"/><rect x="18" y="53" width="4" height="1.5" fill="#5a6478"/><rect x="29" y="53" width="4" height="1.5" fill="#5a6478"/></g>`,
      cap: `<g class="mchart"><rect x="16" y="58" width="4" height="8" fill="#8fa7d9"/><rect x="23" y="54" width="4" height="12" fill="#8fa7d9"/><rect x="30" y="50" width="4" height="16" fill="#8fa7d9"/></g>`,
      beret: `<polyline class="mchart" points="14,64 20,58 25,60 31,52 38,48" fill="none" stroke="#7fbf6a" stroke-width="2"/>`,
    };
    const extra = {
      pony: "",
      bun: `<g><rect x="96" y="58" width="22" height="18" fill="#8a7d64"/><rect x="98" y="60" width="18" height="6" fill="#6b5d47"/><rect x="98" y="68" width="18" height="6" fill="#6b5d47"/><rect x="105" y="62" width="4" height="2" fill="#e0c36a"/><rect x="105" y="70" width="4" height="2" fill="#e0c36a"/></g>`,
      cap: `<g><rect x="98" y="46" width="22" height="30" fill="#23272f"/><rect x="101" y="50" width="4" height="3" fill="#2f8a58"/><rect x="107" y="50" width="4" height="3" fill="#e0c36a"/><rect x="101" y="57" width="4" height="3" fill="#2f8a58"/><rect x="107" y="57" width="4" height="3" fill="#2f8a58"/><rect x="101" y="64" width="4" height="3" fill="#b8463a"/><rect x="107" y="64" width="4" height="3" fill="#2f8a58"/></g>`,
      beret: `<g><rect x="98" y="60" width="16" height="12" fill="#efe9da"/><rect x="100" y="62" width="5" height="3" fill="#3f5aa0"/><rect x="106" y="62" width="5" height="3" fill="#b8463a"/><rect x="100" y="67" width="5" height="3" fill="#8f6f1d"/><rect x="106" y="67" width="5" height="3" fill="#2f8a58"/></g>`,
    };
    return `<span class="workbub">${c.bubs[0]}</span>
    <svg viewBox="0 0 132 116" shape-rendering="crispEdges">
      <g class="person"><g class="head">${hair}
        <rect x="50" y="20" width="32" height="30" fill="${skin}"/>
        <rect class="facelight" x="50" y="20" width="32" height="26" fill="${c.ac}" opacity="0"/>
        <g class="eye"><rect x="57" y="32" width="4" height="4" fill="${ink}"/></g>
        <g class="eye"><rect x="71" y="32" width="4" height="4" fill="${ink}"/></g>${glasses}
        <rect x="59" y="43" width="14" height="3" fill="${ink}"/></g>
        <rect x="44" y="50" width="44" height="24" fill="${suit}"/>
        <rect x="58" y="50" width="16" height="10" fill="#fff"/>
        <rect x="62" y="52" width="8" height="16" fill="${c.ac}"/>
        <rect class="arm-l" x="34" y="64" width="14" height="9" fill="${suit}"/>
        <rect class="arm-r" x="84" y="64" width="14" height="9" fill="${suit}"/>
        <g class="sipsteam"><rect x="70" y="34" width="2" height="4" fill="#c9c2b4"/><rect x="75" y="31" width="2" height="4" fill="#c9c2b4"/></g></g>
      <g class="hands"><rect x="52" y="70" width="7" height="5" fill="${skin}"/><rect x="63" y="70" width="7" height="5" fill="${skin}"/></g>
      <rect x="48" y="75" width="26" height="4" fill="#23272f"/>
      <rect x="10" y="44" width="34" height="26" fill="#23272f"/>
      <rect class="scr" x="13" y="47" width="28" height="20" fill="#161a20"/>${charts[c.style]}<rect class="mglow" x="13" y="47" width="28" height="20" fill="${c.ac}" opacity="0"/>
      <rect x="22" y="70" width="10" height="4" fill="#23272f"/>${extra[c.style]}
      <rect x="4" y="76" width="124" height="9" fill="${c.ac}"/>
      <rect x="4" y="85" width="124" height="14" fill="#3a3f4d"/>
      <rect x="12" y="99" width="10" height="12" fill="#3a3f4d"/>
      <rect x="110" y="99" width="10" height="12" fill="#3a3f4d"/>
      <g class="deskstuff"><rect x="86" y="66" width="9" height="10" fill="#fff"/><rect x="95" y="68" width="3" height="5" fill="#fff"/><rect x="87" y="64" width="7" height="2" fill="${c.ac}"/>
        <g class="steam"><rect x="88" y="56" width="2" height="5" fill="#b8b2a4"/><rect x="92" y="54" width="2" height="5" fill="#b8b2a4"/></g></g>
    </svg>`;
  }

  let container = null, ticketEl = null;
  const setDesk = (id, cls, text) => { const el = $("cr-" + id); if (!el) return; el.className = "agent " + cls; $("crst-" + id).innerHTML = text; };
  const chip = (id, t) => { const e = $("crchip-" + id); if (e) e.textContent = t; };
  function moveTicket(i) { const d = $("cr-" + CREW[i].id); if (!d) return; ticketEl.classList.remove("filed"); ticketEl.classList.add("show"); ticketEl.style.left = (d.offsetLeft + d.offsetWidth / 2 - 20) + "px"; ticketEl.style.top = (d.offsetTop - 10) + "px"; }
  function fileTicket() { ticketEl.classList.add("filed"); setTimeout(() => ticketEl.classList.remove("show", "filed"), 550); }
  function eyes(a) { CREW.forEach((c, j) => { const el = $("cr-" + c.id); el.classList.remove("look-left", "look-right"); if (a >= 0 && j !== a) el.classList.add(j < a ? "look-right" : "look-left"); }); }
  function stageClear() { fileTicket(); eyes(-1); }

  function injectCSS() {
    const css = `
      .crew { position: relative; display: grid; grid-template-columns: repeat(4,1fr); gap: .6rem; margin-bottom: 1rem; }
      @media (max-width:1000px){ .crew { grid-template-columns: repeat(2,1fr); } } @media (max-width:560px){ .crew { grid-template-columns:1fr; } }
      .agent { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: .55rem .5rem .6rem; text-align: center; position: relative; box-shadow: 0 1px 2px rgba(20,20,26,.04); transition: transform .35s cubic-bezier(.34,1.2,.64,1), box-shadow .35s, border-color .35s; will-change: transform; }
      .agent.working, .agent.speaking { border-color: var(--ac); }
      .agent.working { transform: translateY(-4px); box-shadow: 0 14px 30px -8px rgba(20,20,26,.16), 0 2px 6px rgba(20,20,26,.06); }
      .agent .ava { width: 96px; height: 84px; margin: 0 auto .2rem; position: relative; perspective: 340px; }
      .agent .ava svg { width: 100%; height: 100%; image-rendering: pixelated; overflow: visible; }
      .agent .person { transform-origin: 66px 84px; animation: breathe 4.2s ease-in-out infinite; }
      @keyframes breathe { 0%,100%{ transform: translateY(0) scale(1); filter: drop-shadow(0 3px 3px rgba(20,20,26,.12)); } 50%{ transform: translateY(-1.6px) scale(1.008); filter: drop-shadow(0 6px 5px rgba(20,20,26,.08)); } }
      .agent .head { transform-origin: 66px 46px; transition: transform .3s ease; }
      .facelight { transition: opacity .3s; } .mglow { transition: opacity .3s; }
      .agent .nm { font-weight: 800; font-size: .74rem; } .agent .rl { font-size: .58rem; color: var(--ac); font-weight: 700; }
      .agent .chipstat { display:inline-block; margin-top:.22rem; font-size:.55rem; font-weight:700; letter-spacing:.04em; color:var(--ac); border:1px solid color-mix(in srgb, var(--ac) 35%, transparent); border-radius:999px; padding:.06rem .42rem; background:color-mix(in srgb, var(--ac) 7%, #fff); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .agent .st { font-size: .58rem; color: var(--dim); min-height: 2em; margin-top: .16rem; } .agent .st b { color: var(--text); }
      .agent .st .dots:after { content:""; animation: dots 1.2s steps(4) infinite; }
      @keyframes dots { 0%{content:""} 25%{content:"."} 50%{content:".."} 75%{content:"..."} }
      .agent.thinking .person { animation: ponder 1.6s ease-in-out infinite; } .agent.working .person { animation: leanin .62s ease-in-out infinite alternate; }
      @keyframes ponder { 0%,100%{ transform: translateY(0); filter: drop-shadow(0 3px 3px rgba(20,20,26,.12)); } 50%{ transform: translateY(-3px); filter: drop-shadow(0 6px 5px rgba(20,20,26,.1)); } }
      @keyframes leanin { from{ transform: translateY(0) scale(1); filter: drop-shadow(0 3px 3px rgba(20,20,26,.12)); } to{ transform: translateY(-3px) scale(1.055); filter: drop-shadow(0 10px 9px rgba(20,20,26,.16)); } }
      .agent.working .head { animation: peekin .62s ease-in-out infinite alternate; } @keyframes peekin { from{transform:translateY(0)} to{transform:translateY(1.4px) scale(1.02)} }
      .agent.working .facelight { opacity: .16; animation: facepulse 1.3s ease-in-out infinite; } @keyframes facepulse { 0%,100%{opacity:.08} 50%{opacity:.2} }
      .agent.working .mglow { animation: mglowpulse 1.1s ease-in-out infinite; } @keyframes mglowpulse { 0%,100%{opacity:.12} 50%{opacity:.4} }
      .agent.working .hands rect:nth-child(1){animation:tap .18s steps(1) infinite} .agent.working .hands rect:nth-child(2){animation:tap .18s steps(1) infinite .09s}
      @keyframes tap { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      .agent.cheer .person { animation: cheer .7s cubic-bezier(.34,1.56,.64,1) 2; } @keyframes cheer { 0%,100%{transform:translateY(0)} 45%{transform:translateY(-9px)} }
      .agent.sip .person { animation: sipping 1s ease-in-out 1; } @keyframes sipping { 0%,100%{transform:rotate(0)} 35%,65%{transform:rotate(-3.5deg) translateY(-2px)} }
      .agent.sip .sipsteam { opacity: 1; } .sipsteam { opacity: 0; transition: opacity .3s; }
      .steam rect { animation: steam 2.6s ease-in-out infinite; opacity: 0; } .steam rect:nth-child(2){animation-delay:1.3s}
      @keyframes steam { 0%{opacity:0;transform:translateY(0)} 30%{opacity:.7} 100%{opacity:0;transform:translateY(-7px)} }
      .eye { animation: blink 4.6s infinite; transform-origin: center; } @keyframes blink { 0%,94%,100%{transform:scaleY(1)} 96%,98%{transform:scaleY(.1)} }
      .mchart { stroke-dasharray: 60; animation: mflow 5s linear infinite; } @keyframes mflow { to { stroke-dashoffset: -120; } }
      .scr { animation: flick 7.3s steps(1) infinite; } @keyframes flick { 0%,93%,100%{opacity:1} 94%,96%{opacity:.72} }
      .workbub { position:absolute; top:-10px; left:0; display:none; z-index:5; background:#fff; border:1px solid var(--ac); border-radius:8px; padding:.06rem .4rem; font-size:.56rem; font-weight:700; color:var(--ac); white-space:nowrap; box-shadow:0 4px 10px -2px rgba(20,20,26,.18); }
      .workbub:after { content:""; position:absolute; right:12px; bottom:-5px; width:7px; height:7px; background:#fff; border-right:1px solid var(--ac); border-bottom:1px solid var(--ac); transform:rotate(45deg); }
      .agent.working .workbub, .agent.mumble .workbub { display:block; animation: ponder 1.4s ease-in-out infinite; }
      #crticket { position:absolute; width:40px; height:32px; z-index:7; display:none; transition:left .55s cubic-bezier(.34,1.25,.64,1), top .55s cubic-bezier(.34,1.25,.64,1); pointer-events:none; filter:drop-shadow(0 5px 8px rgba(20,20,26,.24)); }
      #crticket.show { display:block; } #crticket .flap { animation: tick-bob .55s ease-in-out infinite alternate; }
      @keyframes tick-bob { from{transform:translateY(0)} to{transform:translateY(-5px)} }
      #crticket.filed { animation: tick-file .5s ease-in forwards; } @keyframes tick-file { to{transform:translateY(46px) scale(.5);opacity:0} }
      .agent.look-left .eye rect { transform: translateX(-1.6px); } .agent.look-right .eye rect { transform: translateX(1.6px); } .agent .eye rect { transition: transform .25s; }
      .agent.look-left .head { transform: translateX(-1.4px) rotate(-1.3deg); } .agent.look-right .head { transform: translateX(1.4px) rotate(1.3deg); }
      .agent.stretch .person { animation: stretching 1.3s ease-in-out 1; } .agent.stretch .arm-l, .agent.stretch .arm-r { animation: armsup 1.3s ease-in-out 1; }
      @keyframes stretching { 0%,100%{transform:translateY(0)} 30%,70%{transform:translateY(-4px)} } @keyframes armsup { 0%,100%{transform:translateY(0)} 30%,70%{transform:translateY(-7px)} }
      .agent.wiggle .person { animation: swivel 1.5s ease-in-out 1; } @keyframes swivel { 0%,100%{transform:rotate(0)} 28%{transform:rotate(-4deg)} 68%{transform:rotate(4deg)} }
      .agent.yawn .eye { animation:none; transform:scaleY(.18); } .agent.yawn .person { animation: yawnlean 1.1s ease-in-out 1; } @keyframes yawnlean { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-2px) rotate(-1.5deg)} }
      @media (prefers-reduced-motion: reduce) { .agent *, #crticket { animation: none !important; } }`;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  function mount(el) {
    injectCSS();
    container = el; el.className = "crew";
    for (const c of CREW) {
      const d = document.createElement("div"); d.className = "agent"; d.id = "cr-" + c.id; d.style.setProperty("--ac", c.ac);
      d.innerHTML = `<div class="ava">${pixelChar(c)}</div><div class="nm">${c.name}</div><div class="rl">${c.role}</div>
        <span class="chipstat" id="crchip-${c.id}">${c.chip}</span><div class="st" id="crst-${c.id}">warming up<span class="dots"></span></div>`;
      el.appendChild(d);
    }
    ticketEl = document.createElement("div"); ticketEl.id = "crticket";
    ticketEl.innerHTML = `<svg viewBox="0 0 40 32" shape-rendering="crispEdges" class="flap"><rect x="1" y="3" width="38" height="26" fill="#ffffff" stroke="#16161a" stroke-width="2"/><rect x="6" y="9" width="22" height="2.5" fill="#6b6b73"/><rect x="6" y="14" width="28" height="2.5" fill="#d6d6db"/><rect x="6" y="19" width="16" height="2.5" fill="#d6d6db"/><rect x="30" y="7" width="6" height="6" fill="#4b5bd6"/></svg>`;
    el.appendChild(ticketEl);
    // office life
    const FID = ["sip","stretch","wiggle","yawn","mumble","glance"], MS = {sip:1100,stretch:1300,wiggle:1500,yawn:1100,mumble:1700,glance:1400};
    setInterval(() => { if (REDUCED || busy) return;
      const n = 1 + (Math.random()<.35?1:0);
      for (let k=0;k<n;k++){ const c=CREW[Math.floor(Math.random()*CREW.length)]; const el=$("cr-"+c.id);
        if (!el || /working|thinking|mumble|sip|stretch|wiggle|yawn/.test(el.className)) continue;
        const f=FID[Math.floor(Math.random()*FID.length)];
        if (f==="glance"){ const dir=Math.random()<.5?"look-left":"look-right"; el.classList.add(dir); setTimeout(()=>el.classList.remove(dir),MS.glance); }
        else { if(f==="mumble"){ const wb=el.querySelector(".workbub"); if(wb)wb.textContent=c.bubs[Math.floor(Math.random()*c.bubs.length)]; } el.classList.add(f); setTimeout(()=>el.classList.remove(f),MS[f]); } }
    }, 3400);
    setInterval(() => { if (REDUCED || busy) return; const c=CREW[Math.floor(Math.random()*CREW.length)]; const el=$("cr-"+c.id); if (el && el.className==="agent") $("crst-"+c.id).textContent=c.idles[Math.floor(Math.random()*c.idles.length)]; }, 7000);
  }

  function ready(manifest) {
    chip("librarian", `${Object.keys(manifest.metrics).length} METRICS · ${Object.keys(manifest.dimensions).length} DIMS`);
    const wake = [["machinist",`warehouse open · ${manifest.stats.rows_total.toLocaleString()} rows`],["librarian","catalog open"],["illustrator","easel up"],["analyst","ready — send a query"]];
    wake.forEach(([id,t],i)=> setTimeout(()=>{ setDesk(id,"agent cheer",t); setTimeout(()=>$("cr-"+id).className="agent",900); }, i*220));
  }

  async function run(plan, mount, opts = {}) {
    busy = true;
    try {
    const man = Abacus.manifest;
    const analystKind = plan.kind && plan.kind !== "aggregate";
    nQ++; chip("analyst", `${nQ} QUESTION${nQ>1?"S":""}`);
    moveTicket(0); eyes(0);
    setDesk("analyst","agent working", opts.fromLLM ? 'transcribing the model’s pick<span class="dots"></span>' : 'reading the ticket<span class="dots"></span>');
    await sleep(340);
    setDesk("analyst","agent", analystKind ? `<b>${plan.kind}</b>${plan.metric?` on ${plan.metric}`:""} · ${plan.time.label}` : `<b>${plan.metric}</b>${plan.dims.length?" by "+plan.dims.join(", "):""} · ${plan.time.label}`);
    moveTicket(1); eyes(1);
    setDesk("librarian","agent working", analystKind ? 'pulling every card<span class="dots"></span>' : 'flipping the catalog<span class="dots"></span>');
    await sleep(320);
    if (plan.metric){ const msql=man.metrics[plan.metric].sql.split("\n")[0]; const joins=["p","c"].filter(a=>(msql+plan.dims.map(d=>man.dimensions[d].sql).join(" ")+(plan.filters||[]).map(f=>man.dimensions[f.dim].sql).join(" ")).includes(a+"."));
      setDesk("librarian","agent",`<b>${plan.metric}</b> ✓ joins: ${joins.length?joins.map(j=>j==="p"?"products":"customers").join(", "):"none"}`); }
    else setDesk("librarian","agent", plan.kind==="retention" ? "cohort recipe ready ✓" : "watchlist out ✓");
    moveTicket(2); eyes(2);
    const mL = {investigate:"running the decomposition",retention:"walking the cohorts",anomalies:"sweeping the watchlist"}[plan.kind] || "spinning the flywheel";
    setDesk("machinist","agent working", mL + '<span class="dots"></span>');
    await sleep(320);
    const { result, story } = Abacus.runAny(plan);
    if (plan.kind==="investigate"){ nSql+=result.queries; setDesk("machinist","agent",`<b>${result.queries}</b> queries · decomposed ✓`); }
    else if (plan.kind==="retention"){ nSql+=2; setDesk("machinist","agent",`<b>${result.matrix.length}</b> cohorts ✓`); }
    else if (plan.kind==="anomalies"){ nSql+=result.queries; setDesk("machinist","agent",`<b>${result.flags.length}</b> flags · ${result.queries} series ✓`); }
    else { nSql+=1+(result.prior?1:0); setDesk("machinist","agent",`<b>${result.rows.length}</b> row${result.rows.length===1?"":"s"} · ${result.ms.toFixed(1)} ms ✓`); }
    chip("machinist", `${nSql} QUERIES`);
    moveTicket(3); eyes(3);
    const iL = {investigate:"drawing the waterfall",retention:"shading the triangle",anomalies:"circling outliers"}[plan.kind] || "inking the chart";
    setDesk("illustrator","agent working", iL + '<span class="dots"></span>');
    await sleep(300);
    Viz.renderCard(mount, plan, result, story, opts);
    nCharts++; chip("illustrator", `${nCharts} CHART${nCharts>1?"S":""}`);
    setDesk("illustrator","agent cheer","filed ✓");
    setTimeout(()=>setDesk("illustrator","agent","cleaning brushes"),1800);
    return { result, story };
    } catch (e) {
      mount.innerHTML = "";
      const err = document.createElement("div"); err.className = "viz-story";
      err.style.color = "var(--coral)"; err.textContent = "Could not run this query — " + e.message;
      mount.appendChild(err);
      setDesk("machinist", "agent", "query failed ✗");
      return { error: e };
    } finally {
      busy = false;
      stageClear();
    }
  }

  return { mount, ready, run, get busy(){ return busy; } };
})();
window.Crew = Crew;
