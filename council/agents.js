/* agents.js — the pixel bench.
 *
 * Fifteen auditors around a horseshoe, on white. Each seat gets a distinct
 * silhouette and a desk prop that hints at its job, so you can find the one you
 * want without reading every label.
 *
 * State is never conveyed by motion alone. Every state has a shape, a colour
 * and a word, because the animation is the first thing to go when someone turns
 * motion off — and because a bench you cannot read at a glance is decoration.
 *
 * Self-contained: injects its own scoped CSS, depends on nothing but the DOM.
 *
 * See CONTRACT.md §9.
 */

const REDUCED = typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Per-seat visual identity. `hair`/`gear`/`prop` are drawn below; the point is
 * that no two seats share a combination. */
const LOOK = {
  contract:      { hair: "bob",    gear: "visor",   prop: "ledger",   ac: "#2547c9", mutter: ["one row, one fact", "that key repeats", "grain first"] },
  math:          { hair: "crop",   gear: "none",    prop: "abacus",   ac: "#1d7a4d", mutter: ["show the spec", "recompute it", "twice or not at all"] },
  analytics:     { hair: "pony",   gear: "glasses", prop: "ruler",    ac: "#2547c9", mutter: ["equal windows", "same weekday?", "what base?"] },
  definition:    { hair: "bun",    gear: "glasses", prop: "dict",     ac: "#7a4fbf", mutter: ["define it once", "which period?", "per what?"] },
  causal:        { hair: "wave",   gear: "none",    prop: "arrows",   ac: "#9a6a00", mutter: ["after ≠ because", "who else moved?", "confound"] },
  sensitivity:   { hair: "curl",   gear: "goggles", prop: "dial",     ac: "#9a6a00", mutter: ["flip the rule", "does it hold?", "how far?"] },
  viz:           { hair: "beret",  gear: "none",    prop: "easel",    ac: "#7a4fbf", mutter: ["zero the axis", "no dual axes", "label it"] },
  narrative:     { hair: "spike",  gear: "none",    prop: "mask",     ac: "#b3372c", mutter: ["what else fits?", "opposing counsel", "prove me wrong"] },
  story:         { hair: "long",   gear: "none",    prop: "thread",   ac: "#2547c9", mutter: ["does it follow?", "one step too far", "read it alone"] },
  defensibility: { hair: "flat",   gear: "none",    prop: "shieldq",  ac: "#b3372c", mutter: ["one hard question", "and then?", "who asks first"] },
  assumption:    { hair: "part",   gear: "glasses", prop: "iceberg",  ac: "#9a6a00", mutter: ["unwritten", "breaks if…", "says who?"] },
  decision:      { hair: "short",  gear: "none",    prop: "gavelp",   ac: "#1d7a4d", mutter: ["who owns it?", "what threshold?", "reversible?"] },
  exec:          { hair: "slick",  gear: "none",    prop: "podium",   ac: "#14120e", mutter: ["read it alone", "so what?", "cut it"] },
  research:      { hair: "cap",    gear: "mask",    prop: "globe",    ac: "#c2683a", mutter: ["outside the case", "not evidence", "worth checking"] },
  sentinel:      { hair: "helm",   gear: "visor",   prop: "shield",   ac: "#b3372c", mutter: ["data, not orders", "who wrote this?", "quarantined"] },
};

const STATE_LABEL = {
  idle: "idle", reading: "reading", thinking: "thinking",
  writing: "writing", flagged: "flagged", done: "done", blocked: "blocked",
};

const IDLE_LINES = ["reviewing notes", "waiting on the dossier", "checking a reference", "sharpening a question"];

let root = null, roster = [], dossier = null, statStrip = null;
let busy = false, idleTimer = null, chatterTimer = null;
const dissenting = new Set();

/* ---------- pixel avatar ---------- */

function avatar(id) {
  const L = LOOK[id] || LOOK.contract;
  const ink = "#14120e";
  const skins = ["#e3b48d", "#c98f63", "#a46b42", "#8a5432", "#efc9a6", "#d6a077"];
  const skin = skins[Math.abs(hash(id)) % skins.length];
  const hairC = ["#2a2622", "#5a4632", "#7a5230", "#3a2f28", "#8d7a5e"][Math.abs(hash(id + "h")) % 5];

  const hair = {
    bob:   `<rect x="18" y="8" width="28" height="9" fill="${hairC}"/><rect x="16" y="14" width="5" height="14" fill="${hairC}"/><rect x="43" y="14" width="5" height="14" fill="${hairC}"/>`,
    crop:  `<rect x="19" y="9" width="26" height="7" fill="${hairC}"/>`,
    pony:  `<rect x="18" y="8" width="28" height="9" fill="${hairC}"/><rect x="44" y="13" width="7" height="16" fill="${hairC}"/>`,
    bun:   `<rect x="18" y="9" width="28" height="8" fill="${hairC}"/><rect x="45" y="4" width="9" height="9" fill="${hairC}"/>`,
    wave:  `<rect x="17" y="8" width="30" height="6" fill="${hairC}"/><rect x="17" y="14" width="8" height="5" fill="${hairC}"/><rect x="39" y="14" width="8" height="5" fill="${hairC}"/>`,
    curl:  `<rect x="17" y="7" width="8" height="8" fill="${hairC}"/><rect x="26" y="4" width="12" height="9" fill="${hairC}"/><rect x="39" y="7" width="8" height="8" fill="${hairC}"/>`,
    beret: `<rect x="16" y="7" width="30" height="8" fill="${L.ac}"/><rect x="42" y="4" width="10" height="6" fill="${L.ac}"/>`,
    spike: `<rect x="20" y="9" width="4" height="8" fill="${hairC}"/><rect x="27" y="5" width="4" height="12" fill="${hairC}"/><rect x="34" y="7" width="4" height="10" fill="${hairC}"/><rect x="41" y="10" width="4" height="7" fill="${hairC}"/>`,
    long:  `<rect x="18" y="8" width="28" height="9" fill="${hairC}"/><rect x="15" y="14" width="5" height="24" fill="${hairC}"/><rect x="44" y="14" width="5" height="24" fill="${hairC}"/>`,
    flat:  `<rect x="18" y="10" width="28" height="6" fill="${hairC}"/>`,
    part:  `<rect x="18" y="8" width="28" height="8" fill="${hairC}"/><rect x="30" y="8" width="3" height="8" fill="${skin}"/>`,
    short: `<rect x="19" y="9" width="26" height="8" fill="${hairC}"/><rect x="19" y="16" width="4" height="5" fill="${hairC}"/>`,
    slick: `<rect x="18" y="9" width="28" height="6" fill="${hairC}"/><rect x="40" y="9" width="8" height="3" fill="#fff" opacity=".35"/>`,
    cap:   `<rect x="17" y="7" width="30" height="9" fill="${L.ac}"/><rect x="40" y="14" width="14" height="4" fill="${L.ac}"/>`,
    helm:  `<rect x="16" y="6" width="32" height="12" fill="#8a8f9a"/><rect x="30" y="2" width="4" height="6" fill="${L.ac}"/>`,
  }[L.hair] || "";

  const gear = {
    glasses: `<rect x="21" y="24" width="9" height="7" fill="none" stroke="${ink}" stroke-width="2"/><rect x="34" y="24" width="9" height="7" fill="none" stroke="${ink}" stroke-width="2"/><rect x="30" y="27" width="4" height="2" fill="${ink}"/>`,
    visor:   `<rect x="18" y="22" width="28" height="6" fill="${L.ac}" opacity=".8"/><rect x="18" y="22" width="28" height="6" fill="none" stroke="${ink}" stroke-width="1.5"/>`,
    goggles: `<circle cx="26" cy="27" r="5.5" fill="#dfe6f5" stroke="${ink}" stroke-width="2"/><circle cx="38" cy="27" r="5.5" fill="#dfe6f5" stroke="${ink}" stroke-width="2"/><rect x="31" y="26" width="2" height="2" fill="${ink}"/>`,
    mask:    `<rect x="19" y="30" width="26" height="10" fill="#eef1f6" stroke="${ink}" stroke-width="1.5"/>`,
    none:    "",
  }[L.gear] || "";

  const eyes = L.gear === "visor" || L.gear === "goggles" ? ""
    : `<g class="eye"><rect x="24" y="26" width="4" height="4" fill="${ink}"/></g><g class="eye"><rect x="36" y="26" width="4" height="4" fill="${ink}"/></g>`;

  const props = {
    ledger:  `<rect x="72" y="52" width="18" height="14" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="75" y="56" width="12" height="1.5" fill="${L.ac}"/><rect x="75" y="60" width="9" height="1.5" fill="#b9b3a6"/>`,
    abacus:  `<rect x="71" y="50" width="20" height="17" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="73" y="55" width="16" height="1.2" fill="${ink}"/><rect x="73" y="60" width="16" height="1.2" fill="${ink}"/><rect x="75" y="52" width="4" height="4" fill="${L.ac}"/><rect x="83" y="57" width="4" height="4" fill="${L.ac}"/><rect x="77" y="62" width="4" height="4" fill="${L.ac}"/>`,
    ruler:   `<rect x="70" y="58" width="22" height="7" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="74" y="58" width="1.2" height="4" fill="${ink}"/><rect x="79" y="58" width="1.2" height="4" fill="${ink}"/><rect x="84" y="58" width="1.2" height="4" fill="${ink}"/>`,
    dict:    `<rect x="71" y="51" width="19" height="15" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="80" y="51" width="1.5" height="15" fill="${ink}"/><rect x="73" y="55" width="5" height="1.4" fill="${L.ac}"/><rect x="83" y="55" width="5" height="1.4" fill="${L.ac}"/>`,
    arrows:  `<path d="M71 64 L80 54 L89 60" fill="none" stroke="${L.ac}" stroke-width="2.4"/><rect x="86" y="57" width="5" height="5" fill="${L.ac}"/>`,
    dial:    `<circle cx="81" cy="59" r="9" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="80" y="52" width="2" height="8" fill="${L.ac}"/><rect x="81" y="58" width="7" height="2" fill="${ink}"/>`,
    easel:   `<rect x="70" y="50" width="21" height="15" fill="#fff" stroke="${ink}" stroke-width="1.5"/><path d="M73 62 L78 56 L83 59 L88 53" fill="none" stroke="${L.ac}" stroke-width="2"/>`,
    mask:    `<path d="M71 54 Q81 48 91 54 Q91 64 81 68 Q71 64 71 54 Z" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="75" y="57" width="4" height="3" fill="${ink}"/><rect x="83" y="57" width="4" height="3" fill="${ink}"/>`,
    thread:  `<path d="M70 64 Q76 50 82 62 Q88 74 92 56" fill="none" stroke="${L.ac}" stroke-width="2"/>`,
    shieldq: `<path d="M81 49 L91 53 V61 Q91 68 81 71 Q71 68 71 61 V53 Z" fill="#fff" stroke="${ink}" stroke-width="1.5"/><text x="81" y="65" font-size="13" font-family="monospace" text-anchor="middle" fill="${L.ac}">?</text>`,
    iceberg: `<path d="M70 60 H92 L86 52 L81 57 L76 51 Z" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="70" y="60" width="22" height="8" fill="${L.ac}" opacity=".28"/>`,
    gavelp:  `<rect x="70" y="60" width="20" height="5" fill="#8a6a44" stroke="${ink}" stroke-width="1.4"/><rect x="76" y="50" width="12" height="8" fill="#8a6a44" stroke="${ink}" stroke-width="1.4"/>`,
    podium:  `<rect x="73" y="52" width="16" height="6" fill="#fff" stroke="${ink}" stroke-width="1.5"/><rect x="79" y="58" width="4" height="9" fill="${ink}"/><rect x="73" y="67" width="16" height="2.5" fill="${ink}"/>`,
    globe:   `<circle cx="81" cy="59" r="9" fill="#fff" stroke="${ink}" stroke-width="1.5"/><ellipse cx="81" cy="59" rx="4" ry="9" fill="none" stroke="${L.ac}" stroke-width="1.3"/><rect x="72" y="58" width="18" height="1.3" fill="${L.ac}"/>`,
    shield:  `<path d="M81 49 L91 53 V61 Q91 68 81 71 Q71 68 71 61 V53 Z" fill="#fff" stroke="${ink}" stroke-width="1.5"/><path d="M76 59 L80 63 L87 55" fill="none" stroke="${L.ac}" stroke-width="2.2"/>`,
  }[L.prop] || "";

  return `
  <svg viewBox="0 0 100 86" shape-rendering="crispEdges" aria-hidden="true">
    <g class="pv-person">
      <g class="pv-head">${hair}
        <rect x="20" y="16" width="24" height="22" fill="${skin}"/>
        <rect class="pv-facelight" x="20" y="16" width="24" height="22" fill="${L.ac}" opacity="0"/>
        ${eyes}${gear}
        <rect x="27" y="33" width="10" height="2" fill="${ink}"/>
      </g>
      <rect x="15" y="38" width="34" height="19" fill="#3a4050"/>
      <rect x="26" y="38" width="12" height="8" fill="#fff"/>
      <rect x="29" y="40" width="6" height="12" fill="${L.ac}"/>
      <rect class="pv-arm-l" x="7"  y="49" width="10" height="7" fill="#3a4050"/>
      <rect class="pv-arm-r" x="47" y="49" width="10" height="7" fill="#3a4050"/>
      <g class="pv-hand"><rect x="22" y="55" width="6" height="4" fill="${skin}"/><rect x="32" y="55" width="6" height="4" fill="${skin}"/></g>
    </g>
    <rect x="2" y="60" width="96" height="5" fill="${L.ac}"/>
    <rect x="2" y="65" width="96" height="12" fill="#eceae4"/>
    <rect x="2" y="65" width="96" height="12" fill="none" stroke="${ink}" stroke-width="1.5"/>
    ${props}
    <g class="pv-paper"><rect x="10" y="52" width="16" height="12" fill="#fff" stroke="${ink}" stroke-width="1.4"/><rect x="13" y="56" width="10" height="1.3" fill="#b9b3a6"/><rect x="13" y="59" width="7" height="1.3" fill="#b9b3a6"/></g>
    <g class="pv-hand-up"><rect x="52" y="24" width="7" height="16" fill="${skin}" stroke="${ink}" stroke-width="1.2"/></g>
  </svg>`;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/* ---------- CSS ---------- */

function injectCSS() {
  if (document.getElementById("pv-css")) return;
  const s = document.createElement("style");
  s.id = "pv-css";
  s.textContent = `
.pv-bench { position: relative; }
/* row-gap leaves a band above each card for the speech bubble to sit in,
   rather than growing down over the avatar it belongs to. margin-top gives the
   first row the same band, so its bubbles clear the stats strip. */
.pv-grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); column-gap: 8px; row-gap: 38px; margin-top: 38px; }
@media (max-width: 1200px){ .pv-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
@media (max-width: 900px) { .pv-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
@media (max-width: 560px) { .pv-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }

.pv-seat {
  background:#fff; border:2px solid var(--pi-ink); padding:6px 5px 7px; text-align:center;
  position:relative; transition: transform .3s cubic-bezier(.32,1.28,.55,1), box-shadow .3s, border-color .25s;
}
.pv-seat .pv-av { width:92px; height:78px; margin:0 auto; }
.pv-seat svg { width:100%; height:100%; image-rendering:pixelated; overflow:visible; }
.pv-seat .pv-nm { font-family:var(--pi-font-ui); font-size:12px; font-weight:600; line-height:1.15; margin-top:2px; }
.pv-seat .pv-rl { font-family:var(--pi-font-code); font-size:12px; color:var(--pi-muted); }
.pv-seat .pv-st {
  display:inline-block; margin-top:3px; font-family:var(--pi-font-ui); font-size:12px;
  letter-spacing:.04em; text-transform:uppercase; border:1.5px solid var(--pi-line);
  padding:0 5px; background:#fff; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.pv-seat[data-s="reading"]  { border-color:var(--pi-accent); }
.pv-seat[data-s="reading"]  .pv-st { border-color:var(--pi-accent); color:var(--pi-accent); }
.pv-seat[data-s="thinking"] { border-color:var(--pi-accent); transform:translateY(-3px); box-shadow:0 8px 0 -4px rgba(37,71,201,.25); }
.pv-seat[data-s="thinking"] .pv-st { border-color:var(--pi-accent); background:var(--pi-accent-soft); color:var(--pi-accent); }
.pv-seat[data-s="writing"]  { border-color:var(--pi-ok); }
.pv-seat[data-s="writing"]  .pv-st { border-color:var(--pi-ok); background:var(--pi-ok-soft); color:var(--pi-ok); }
.pv-seat[data-s="flagged"]  { border-color:var(--pi-err); }
.pv-seat[data-s="flagged"]  .pv-st { border-color:var(--pi-err); background:var(--pi-err-soft); color:var(--pi-err); }
.pv-seat[data-s="done"]     { border-color:var(--pi-ok); }
.pv-seat[data-s="done"]     .pv-st::before { content:"✓ "; }
.pv-seat[data-s="blocked"]  { border-color:var(--pi-err); background:var(--pi-err-soft); }

/* the research seat is walled off, visibly */
.pv-seat.pv-quar { border-style:dashed; border-color:#c2683a; background:#fff8f4; }
.pv-seat.pv-quar::after {
  content:"QUARANTINED"; position:absolute; top:-9px; left:50%; transform:translateX(-50%);
  font-family:var(--pi-font-title); font-size:10px; background:#fff8f4; color:#8a4a24; padding:0 4px;
}

/* ---- motion ---- */
.pv-person { transform-origin:32px 57px; animation: pv-breathe 4.4s ease-in-out infinite; }
@keyframes pv-breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-1.4px)} }
.pv-head { transform-origin:32px 30px; transition:transform .3s ease; }
.eye { animation: pv-blink 5.2s infinite; transform-origin:center; }
@keyframes pv-blink { 0%,95%,100%{transform:scaleY(1)} 96%,98%{transform:scaleY(.1)} }

.pv-seat[data-s="reading"] .pv-head { animation: pv-scan 1.7s ease-in-out infinite; }
@keyframes pv-scan { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
.pv-seat[data-s="reading"] .pv-paper { animation: pv-page .9s steps(2) infinite; }
@keyframes pv-page { 50%{transform:translateX(2px) rotate(-2deg)} }

.pv-seat[data-s="thinking"] .pv-person { animation: pv-ponder 1.5s ease-in-out infinite; }
@keyframes pv-ponder { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
.pv-seat[data-s="thinking"] .pv-facelight { opacity:.14; animation: pv-pulse 1.25s ease-in-out infinite; }
@keyframes pv-pulse { 0%,100%{opacity:.06} 50%{opacity:.22} }

.pv-seat[data-s="writing"] .pv-hand rect { animation: pv-tap .17s steps(1) infinite; }
.pv-seat[data-s="writing"] .pv-hand rect:nth-child(2){ animation-delay:.085s; }
@keyframes pv-tap { 50%{transform:translateY(-2px)} }
.pv-seat[data-s="writing"] .pv-arm-r { animation: pv-write .4s ease-in-out infinite alternate; }
@keyframes pv-write { to { transform: translate(-2px,-2px); } }

.pv-seat[data-s="flagged"] .pv-person { animation: pv-alarm .55s ease-in-out 3; }
@keyframes pv-alarm { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-2.5px)} 75%{transform:translateX(2.5px)} }

.pv-seat[data-s="done"] .pv-person { animation: pv-nod .6s cubic-bezier(.34,1.56,.64,1) 2; }
@keyframes pv-nod { 0%,100%{transform:translateY(0)} 45%{transform:translateY(-6px)} }

.pv-hand-up { opacity:0; transform:translateY(14px); transition:opacity .3s, transform .3s cubic-bezier(.34,1.56,.64,1); }
.pv-seat.pv-dissent .pv-hand-up { opacity:1; transform:translateY(0); animation: pv-wave 1.1s ease-in-out infinite; }
@keyframes pv-wave { 0%,100%{transform:rotate(-6deg)} 50%{transform:rotate(6deg)} }
.pv-seat.pv-dissent { box-shadow: inset 0 0 0 2px var(--pi-warn); }

.pv-seat.pv-pulse { animation: pv-flash .5s ease-out; }
@keyframes pv-flash { from{ box-shadow:0 0 0 0 rgba(37,71,201,.5) } to{ box-shadow:0 0 0 14px rgba(37,71,201,0) } }

/* idle life */
.pv-seat.pv-sip .pv-person   { animation: pv-sipping 1s ease-in-out 1; }
@keyframes pv-sipping { 0%,100%{transform:rotate(0)} 40%,60%{transform:rotate(-4deg) translateY(-2px)} }
.pv-seat.pv-stretch .pv-arm-l,
.pv-seat.pv-stretch .pv-arm-r { animation: pv-armsup 1.2s ease-in-out 1; }
@keyframes pv-armsup { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }
.pv-seat.pv-glance-l .pv-head { transform:translateX(-2px) rotate(-4deg); }
.pv-seat.pv-glance-r .pv-head { transform:translateX(2px) rotate(4deg); }

.pv-bub {
  position:absolute; bottom:calc(100% + 5px); left:50%; transform:translateX(-50%);
  background:#fff; border:1.5px solid var(--pi-ink); padding:1px 7px; font-family:var(--pi-font-ui);
  font-size:12px; white-space:nowrap; z-index:6; display:none; box-shadow:2px 2px 0 var(--pi-ink);
  max-width:min(210px, 96vw); overflow:hidden; text-overflow:ellipsis; pointer-events:none;
}
.pv-seat.pv-mutter .pv-bub, .pv-seat[data-s="thinking"] .pv-bub { display:block; }

/* holding the floor */
.pv-seat.pv-speaking { border-color:var(--pi-accent); box-shadow:0 0 0 3px var(--pi-accent-soft); z-index:8; }
.pv-seat.pv-speaking .pv-bub {
  display:block; border-color:var(--pi-accent); border-width:2px;
  animation: pv-pop .25s cubic-bezier(.34,1.56,.64,1);
}
.pv-seat.pv-speaking .pv-bub[data-kind="challenge"] { border-color:var(--pi-err); background:var(--pi-err-soft); }
.pv-seat.pv-speaking .pv-bub[data-kind="key"]       { border-color:var(--pi-ok);  background:var(--pi-ok-soft); }
.pv-seat.pv-speaking .pv-bub[data-kind="quarantine"]{ border-color:#c2683a; background:#fff8f4; }
.pv-seat.pv-speaking .pv-person { animation: pv-talk .38s ease-in-out infinite alternate; }
@keyframes pv-talk { from{transform:translateY(0)} to{transform:translateY(-2.5px)} }
@keyframes pv-pop  { from{opacity:0;transform:translateX(-50%) scale(.85)} to{opacity:1;transform:translateX(-50%) scale(1)} }
.pv-bub::after {
  content:""; position:absolute; left:50%; margin-left:-4px; bottom:-5px;
  width:7px; height:7px; background:#fff;
  border-right:1.5px solid var(--pi-ink); border-bottom:1.5px solid var(--pi-ink);
  transform:rotate(45deg);
}
.pv-seat.pv-speaking .pv-bub::after { border-color:var(--pi-accent); border-width:2px; }
.pv-seat.pv-speaking .pv-bub[data-kind="challenge"], 
.pv-seat.pv-speaking .pv-bub[data-kind="challenge"]::after { border-color:var(--pi-err); }
.pv-seat.pv-speaking .pv-bub[data-kind="key"],
.pv-seat.pv-speaking .pv-bub[data-kind="key"]::after { border-color:var(--pi-ok); }

#pv-dossier {
  position:absolute; width:30px; height:24px; z-index:9; display:none; pointer-events:none;
  transition:left .5s cubic-bezier(.34,1.25,.64,1), top .5s cubic-bezier(.34,1.25,.64,1);
  filter: drop-shadow(2px 3px 0 rgba(20,18,14,.3));
}
#pv-dossier.on { display:block; }

#pv-gavel {
  position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  z-index:12; pointer-events:none;
}
#pv-gavel.on { display:flex; }
#pv-gavel span {
  font-family:var(--pi-font-title); font-size:24px; color:var(--pi-ok);
  border:4px solid var(--pi-ok); background:#fff; padding:10px 18px;
  animation: pv-gavel .75s cubic-bezier(.34,1.56,.64,1) forwards;
}
@keyframes pv-gavel { 0%{transform:scale(2.6) rotate(-14deg); opacity:0} 40%{transform:scale(1) rotate(-6deg); opacity:1} 100%{transform:scale(1) rotate(-6deg); opacity:0} }

.pv-stats {
  display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;
  font-family:var(--pi-font-code); font-size:12px;
}
.pv-stats b { font-family:var(--pi-font-ui); }

@media (prefers-reduced-motion: reduce) {
  .pv-bench *, .pv-bench *::before, .pv-bench *::after { animation:none !important; transition:none !important; }
  .pv-seat.pv-dissent .pv-hand-up { opacity:1; transform:none; }
  #pv-gavel span { opacity:1; transform:none; }
}`;
  document.head.appendChild(s);
}

/* ---------- public API ---------- */

export const Bench = {
  mount(el, list) {
    injectCSS();
    root = el;
    roster = list || [];
    el.className = "pv-bench";
    el.innerHTML = "";

    statStrip = document.createElement("div");
    statStrip.className = "pv-stats";
    el.appendChild(statStrip);

    const grid = document.createElement("div");
    grid.className = "pv-grid";
    el.appendChild(grid);

    for (const a of roster) {
      const L = LOOK[a.id] || LOOK.contract;
      const seat = document.createElement("div");
      seat.className = "pv-seat" + (a.id === "research" ? " pv-quar" : "");
      seat.id = "pv-" + a.id;
      seat.dataset.agent = a.id;
      seat.dataset.s = "idle";
      seat.style.setProperty("--ac", L.ac);
      seat.innerHTML =
        `<span class="pv-bub">${escapeHtml(L.mutter[0])}</span>` +
        `<div class="pv-av">${avatar(a.id)}</div>` +
        `<div class="pv-nm">${escapeHtml(a.seat || a.id)}</div>` +
        `<div class="pv-rl">${escapeHtml(a.short || "")}</div>` +
        `<span class="pv-st">idle</span>`;
      seat.title = a.mandate ? String(a.mandate).slice(0, 300) : a.seat;
      grid.appendChild(seat);
    }

    dossier = document.createElement("div");
    dossier.id = "pv-dossier";
    dossier.innerHTML =
      `<svg viewBox="0 0 30 24" shape-rendering="crispEdges"><rect x="1" y="2" width="28" height="20" fill="#fff" stroke="#14120e" stroke-width="2"/>` +
      `<rect x="5" y="7" width="16" height="2" fill="#6b6459"/><rect x="5" y="11" width="20" height="2" fill="#d6d2c8"/>` +
      `<rect x="5" y="15" width="12" height="2" fill="#d6d2c8"/><rect x="22" y="5" width="5" height="5" fill="#2547c9"/></svg>`;
    el.appendChild(dossier);

    const gavel = document.createElement("div");
    gavel.id = "pv-gavel";
    gavel.innerHTML = "<span>GATE CLEARED</span>";
    el.appendChild(gavel);

    Bench.stats({ findings: 0, blockers: 0, reconciled: "—" });
    startIdleLife();
  },

  setState(agentId, state, label) {
    const seat = document.getElementById("pv-" + agentId);
    if (!seat) return;
    seat.dataset.s = STATE_LABEL[state] ? state : "idle";
    const st = seat.querySelector(".pv-st");
    if (st) st.textContent = label || STATE_LABEL[state] || state;
    busy = roster.some((a) => {
      const s = document.getElementById("pv-" + a.id);
      return s && ["reading", "thinking", "writing"].includes(s.dataset.s);
    });
    if (["reading", "thinking", "writing"].includes(state)) moveDossier(agentId);
  },

  /* Put a line in a seat's mouth and give it the floor. The bubble is capped
   * short because a wall of text over a 92px avatar is unreadable — the full
   * line lives in the transcript, and this is the visual cue for who is
   * speaking. */
  say(agentId, text, kind) {
    const seat = document.getElementById("pv-" + agentId);
    if (!seat) return;
    /* Only one seat holds the floor. A seat that has finished keeps its border
     * and its finding count, but must stop claiming to be speaking — otherwise
     * three cards read SPEAKING at once and the bench stops telling you who to
     * look at. */
    for (const other of roster) {
      const s = document.getElementById("pv-" + other.id);
      if (!s || s === seat) continue;
      s.classList.remove("pv-speaking");
      if (s.dataset.s === "writing" || s.dataset.s === "flagged") {
        const st = s.querySelector(".pv-st");
        if (st && /speaking|challenging/i.test(st.textContent)) st.textContent = "spoke";
      }
    }
    const bub = seat.querySelector(".pv-bub");
    if (bub) {
      const short = String(text).replace(/\s+/g, " ").trim();
      bub.textContent = short.length > 34 ? short.slice(0, 33) + "…" : short;
      bub.title = short;
      bub.dataset.kind = kind || "speak";
    }
    seat.classList.add("pv-speaking");
    Bench.pulse(agentId);
    moveDossier(agentId);
    busy = true;
  },

  hush() {
    for (const a of roster) {
      const s = document.getElementById("pv-" + a.id);
      if (s) s.classList.remove("pv-speaking");
    }
    busy = false;
  },

  pulse(agentId) {
    const seat = document.getElementById("pv-" + agentId);
    if (!seat) return;
    seat.classList.remove("pv-pulse");
    void seat.offsetWidth;
    seat.classList.add("pv-pulse");
    setTimeout(() => seat.classList.remove("pv-pulse"), 520);
  },

  passDossier(fromId, toId) {
    if (fromId) moveDossier(fromId);
    setTimeout(() => moveDossier(toId), REDUCED ? 0 : 240);
  },

  gavel() {
    const g = document.getElementById("pv-gavel");
    if (!g) return;
    g.classList.add("on");
    setTimeout(() => g.classList.remove("on"), REDUCED ? 400 : 800);
  },

  dissent(agentId) {
    const seat = document.getElementById("pv-" + agentId);
    if (!seat) return;
    dissenting.add(agentId);
    seat.classList.add("pv-dissent");
  },

  clearDissent(agentId) {
    dissenting.delete(agentId);
    const seat = document.getElementById("pv-" + agentId);
    if (seat) seat.classList.remove("pv-dissent");
  },

  stats({ findings = 0, blockers = 0, reconciled = "—" } = {}) {
    if (!statStrip) return;
    statStrip.innerHTML =
      `<span class="pchip">${roster.length} SEATS</span>` +
      `<span class="pchip${findings ? " acc" : ""}">FINDINGS <b>${findings}</b></span>` +
      `<span class="pchip${blockers ? " err" : ""}">BLOCKERS <b>${blockers}</b></span>` +
      `<span class="pchip${dissenting.size ? " warn" : ""}">DISSENT <b>${dissenting.size}</b></span>` +
      `<span class="pchip">RECONCILED <b>${escapeHtml(String(reconciled))}</b></span>`;
  },

  reset() {
    for (const a of roster) {
      Bench.setState(a.id, "idle", "idle");
      Bench.clearDissent(a.id);
    }
    if (dossier) dossier.classList.remove("on");
  },
};

function moveDossier(agentId) {
  const seat = document.getElementById("pv-" + agentId);
  if (!seat || !dossier) return;
  dossier.classList.add("on");
  dossier.style.left = seat.offsetLeft + seat.offsetWidth / 2 - 15 + "px";
  dossier.style.top = seat.offsetTop - 12 + "px";
}

/* Idle life only runs when nothing is working — a bench that fidgets while it
 * is also computing reads as noise rather than as life. */
function startIdleLife() {
  if (REDUCED) return;
  clearInterval(idleTimer);
  clearInterval(chatterTimer);

  idleTimer = setInterval(() => {
    if (busy || !roster.length) return;
    const a = roster[Math.floor(Math.random() * roster.length)];
    const seat = document.getElementById("pv-" + a.id);
    if (!seat || seat.dataset.s !== "idle") return;
    const move = ["pv-sip", "pv-stretch", "pv-glance-l", "pv-glance-r", "pv-mutter"][Math.floor(Math.random() * 5)];
    if (move === "pv-mutter") {
      const L = LOOK[a.id] || LOOK.contract;
      const b = seat.querySelector(".pv-bub");
      if (b) b.textContent = L.mutter[Math.floor(Math.random() * L.mutter.length)];
    }
    seat.classList.add(move);
    setTimeout(() => seat.classList.remove(move), 1400);
  }, 2600);

  chatterTimer = setInterval(() => {
    if (busy || !roster.length) return;
    const a = roster[Math.floor(Math.random() * roster.length)];
    const seat = document.getElementById("pv-" + a.id);
    if (!seat || seat.dataset.s !== "idle") return;
    const st = seat.querySelector(".pv-st");
    if (st) st.textContent = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
    setTimeout(() => { if (seat.dataset.s === "idle" && st) st.textContent = "idle"; }, 3200);
  }, 7000);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export default Bench;
