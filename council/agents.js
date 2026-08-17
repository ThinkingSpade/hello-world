/* agents.js — the bench, as a room.
 *
 * This used to draw fifteen cards. It now drives the office floor in
 * ./floor/office.js — Munder Difflin's Tiled map, their cast art, their
 * pathfinding — from the live run. The Bench API is unchanged, so app.js does
 * not know the difference: it still calls setState / say / passDossier / gavel /
 * dissent / stats and the room answers.
 *
 * When nothing is running the room plays the recorded case as attract mode,
 * with the four gates as buttons so a visitor can scrub through it — the first
 * thing app.js says to the room takes over, the gates disappear, and the replay
 * stops for good until the page is reloaded. (The case used to live on its own
 * page at /council/floor/; that URL now just redirects here.)
 *
 * State is never carried by motion alone: every state has a colour, a glyph on
 * the seat's terminal and a word in its tag and on its card. See CONTRACT.md §9.
 */

import { mountOffice, paintPortrait, PORTRAIT_W, PORTRAIT_H } from "./floor/office.js";
import { attractVerdict } from "./vp.js";
import { SEATS, SIGNER } from "./floor/cast.js";
import { ACTS, ACT_DUR } from "./floor/run.js";

const REDUCED = typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

const CAST = {};
SEATS.forEach((s) => { CAST[s.id] = s; });

/* council.js's states, plus the three the recorded case is written in so
 * attract mode reads the same as a live run */
const STATE_WORD = {
  idle: "idle", reading: "reading", thinking: "thinking",
  writing: "writing", flagged: "flagged", done: "done", blocked: "blocked",
  on: "reviewing", flag: "flagged", block: "blocked",
};
const BADGE = {
  idle: "idle", reading: "working", thinking: "working", writing: "working",
  flagged: "blocked", blocked: "blocked", done: "success",
  on: "working", flag: "blocked", block: "blocked",
};
const FILL = {
  idle: 1, reading: 3, thinking: 4, writing: 6, flagged: 6, blocked: 3, done: 8,
  on: 4, flag: 6, block: 3,
};

let root = null, roster = [], office = null, statStrip = null;
let selected = null, live = false, attractTimer = 0, act = 0;
const dissenting = new Set();
const noteOf = {};
const given = {};

function refreshChips() {
  if (!statStrip) return;
  const n = { working: 0, flagged: 0, blocked: 0, cleared: 0 };
  roster.forEach((a) => {
    const st = stateOf(a.id);
    if (BADGE[st] === "working") n.working++;
    else if (st === "flagged" || st === "flag") n.flagged++;
    else if (st === "blocked" || st === "block") n.blocked++;
    else if (st === "done") n.cleared++;
  });
  const view = statStrip.querySelector(".pv-view");
  const findings = given.findings != null ? given.findings : n.flagged;
  statStrip.innerHTML =
    `<span class="pchip">${roster.length} SEATS</span>` +
    `<span class="pchip${n.working ? " acc" : ""}">WORKING <b>${n.working}</b></span>` +
    `<span class="pchip${findings ? " warn" : ""}">FINDINGS <b>${findings}</b></span>` +
    `<span class="pchip${n.blocked || given.blockers ? " err" : ""}">BLOCKERS <b>${given.blockers != null ? given.blockers : n.blocked}</b></span>` +
    `<span class="pchip${dissenting.size ? " warn" : ""}">DISSENT <b>${dissenting.size}</b></span>` +
    `<span class="pchip${n.cleared ? " ok" : ""}">CLEARED <b>${n.cleared}</b></span>` +
    (given.reconciled != null ? `<span class="pchip">RECONCILED <b>${esc(String(given.reconciled))}</b></span>` : "");
  if (view) statStrip.appendChild(view);
}

/* ═════════════════════ styles ═════════════════════ */

let injected = false;
function injectCSS() {
  if (injected) return;
  injected = true;
  const css = `
.pv-bench { position: relative; }
.pv-stats { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px; }
.pv-stats .pv-view { margin-left: auto; display: flex; gap: 0; }
.pv-view button {
  font-family: var(--pi-font-ui); font-size: 13px; line-height: 1;
  padding: 6px 10px; cursor: pointer; color: var(--pi-muted);
  background: var(--pi-panel); border: 2px solid var(--pi-line); border-right-width: 0;
}
.pv-view button:last-child { border-right-width: 2px; }
.pv-view button[aria-pressed="true"] { background: var(--pi-ink); border-color: var(--pi-ink); color: var(--pi-panel); }

.pv-room { display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 12px; align-items: start; }
.pv-room .pv-floor { grid-row: 1; grid-column: 1; }
.pv-room .pv-card { grid-row: 1 / span 2; grid-column: 2; }
.pv-room .pv-gates, .pv-room .pv-gates-slot { grid-row: 2; grid-column: 1; }
.pv-floor { position: relative; background: #fff; border: 2px solid var(--pi-ink); padding: 4px; min-width: 0; }
.pv-floor canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; cursor: pointer; }
.pv-gates { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.pv-gates[hidden] { display: none; }
.pv-gate {
  flex: 1 1 150px; text-align: left; cursor: pointer;
  background: var(--pi-panel); border: 1px solid var(--pi-line);
  padding: 7px 10px 6px; color: var(--pi-ink);
  font-family: var(--pi-font-title); font-size: 7px; line-height: 1.4;
}
.pv-gate span { display: block; margin-top: 4px; font-family: var(--pi-font-ui); font-size: 12px; color: var(--pi-muted); }
.pv-gate:hover { border-color: var(--pi-muted); }
.pv-gate.on { background: var(--pi-ink); border-color: var(--pi-ink); color: var(--pi-panel); }
.pv-gate.on span { color: var(--pi-line); }

.pv-hint {
  position: absolute; left: 12px; bottom: 8px; margin: 0;
  font-family: var(--pi-font-title); font-size: 7px; letter-spacing: .08em;
  color: var(--pi-muted); pointer-events: none;
}
.pv-mode {
  position: absolute; right: 8px; top: 8px; margin: 0;
  font-family: var(--pi-font-title); font-size: 7px; letter-spacing: .08em;
  color: var(--pi-muted); background: rgba(255,255,255,.9); padding: 3px 5px;
  border: 1px solid var(--pi-line);
}

.pv-card { background: var(--pi-panel); border: 2px solid var(--pi-ink); padding: 12px; }
.pv-card-top {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin: -12px -12px 12px; padding: 6px 12px 5px;
  background: var(--pi-accent-soft); border-bottom: 2px solid var(--pi-ink);
  font-family: var(--pi-font-title); font-size: 8px; color: var(--pi-ink);
}
.pv-card-top span { font-family: var(--pi-font-code); font-size: 11px; color: var(--pi-muted); }
.pv-who { display: flex; gap: 12px; align-items: flex-start; }
.pv-who canvas { width: 72px; height: 112px; flex: none; image-rendering: pixelated; border: 1px solid var(--pi-line); background: #fff; }
.pv-who h3 { margin: 0; font-family: var(--pi-font-ui); font-size: 17px; line-height: 1.15; }
.pv-who p { margin: 2px 0 8px; font-size: 12px; color: var(--pi-muted); }
.pv-rows { margin: 12px 0 0; }
.pv-rows > div { display: flex; gap: 8px; align-items: baseline; padding: 5px 0; border-bottom: 1px solid var(--pi-line); }
.pv-rows > div:last-child { border-bottom: 0; }
.pv-rows dt { flex: none; font-family: var(--pi-font-title); font-size: 7px; color: var(--pi-muted); }
.pv-rows dd { margin: 0 0 0 auto; text-align: right; font-family: var(--pi-font-ui); font-size: 13px; }
.pv-mandate { margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: var(--pi-muted); }

.pv-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px 1px;
  font-family: var(--pi-font-ui); font-size: 12px; line-height: 18px;
  background: var(--pi-panel); box-shadow: inset 0 0 0 1px var(--bd, var(--pi-muted));
}
.pv-badge i { width: 8px; height: 8px; background: var(--bd, var(--pi-muted)); }
[data-st="idle"]    { --bd: #8b8272; }
[data-st="working"] { --bd: var(--pi-warn); }
[data-st="blocked"] { --bd: var(--pi-err); }
[data-st="success"] { --bd: var(--pi-ok); }

.pv-strip { display: flex; gap: 8px; overflow-x: auto; padding: 12px 2px 2px; }
.pv-bench[data-view="cards"] .pv-room { display: none; }
.pv-bench[data-view="cards"] .pv-strip { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); overflow: visible; }
/* in the grid the cell sets the width, not the card */
.pv-bench[data-view="cards"] .pv-seat { flex: initial; min-width: 0; }
.pv-seat {
  flex: 0 0 176px; display: flex; gap: 8px; align-items: center; text-align: left;
  padding: 6px; background: var(--pi-panel); border: 1px solid var(--pi-line);
  font: inherit; color: inherit; cursor: pointer;
}
.pv-seat:hover { border-color: var(--pi-muted); }
.pv-seat.on { border: 2px solid var(--pi-ink); padding: 5px; }
.pv-seat.pv-dissent { box-shadow: inset 3px 0 0 var(--pi-warn); }
.pv-seat canvas { width: 32px; height: 50px; flex: none; image-rendering: pixelated; }
.pv-seat .m { min-width: 0; flex: 1 1 auto; }
.pv-seat .h { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: wrap; min-width: 0; }
.pv-seat .h b { font-family: var(--pi-font-title); font-size: 7px; font-weight: 400; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pv-seat .pv-badge { padding: 1px 5px 0; font-size: 11px; line-height: 15px; gap: 4px; max-width: 100%; }
.pv-seat .pv-badge i { width: 6px; height: 6px; }
.pv-seat .r { display: block; margin: 4px 0 5px; font-size: 12px; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-seat .d { display: flex; gap: 2px; }
.pv-seat .d u { flex: 1 1 0; height: 4px; background: var(--pi-line); }
.pv-seat .d u.lit { background: var(--pi-ink); }

@media (max-width: 980px) {
  .pv-room { grid-template-columns: minmax(0, 1fr); }
  .pv-room .pv-floor, .pv-room .pv-card, .pv-room .pv-gates, .pv-room .pv-gates-slot { grid-row: auto; grid-column: auto; }
  .pv-bench[data-view="cards"] .pv-strip { grid-template-columns: repeat(3, minmax(0,1fr)); }
}
@media (max-width: 620px) {
  .pv-bench[data-view="cards"] .pv-strip { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .pv-bench *, .pv-bench *::before, .pv-bench *::after { animation: none !important; transition: none !important; }
}`;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
}

/* ═════════════════════ helpers ═════════════════════ */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const seatEl = (id) => root && root.querySelector('.pv-seat[data-agent="' + id + '"]');
const stateOf = (id) => (office ? office.seatState(id) : "idle");

function badge(state) {
  const b = BADGE[state] || "idle";
  return `<span class="pv-badge" data-st="${b}"><i></i><em>${STATE_WORD[state] || state}</em></span>`;
}

function paintSeatCard(id) {
  const el = seatEl(id);
  if (!el) return;
  const st = stateOf(id);
  const b = el.querySelector(".pv-badge");
  b.dataset.st = BADGE[st] || "idle";
  b.querySelector("em").textContent = STATE_WORD[st] || st;
  el.querySelector(".r").textContent = noteOf[id] || (CAST[id] ? CAST[id].lens : "");
  const n = FILL[st] || 1;
  el.querySelectorAll(".d u").forEach((u, i) => u.classList.toggle("lit", i < n));
}

function paintInspector() {
  if (!root || !selected) return;
  const a = roster.find((x) => x.id === selected) || {};
  const c = CAST[selected];
  const st = stateOf(selected);
  paintPortrait(root.querySelector("#pv-port").getContext("2d"), c.r, 4);
  root.querySelector("#pv-name").textContent = a.seat || c.name;
  root.querySelector("#pv-lens").textContent = a.short || c.lens;
  root.querySelector("#pv-tag").textContent = c.tag.toLowerCase();
  root.querySelector("#pv-may").textContent = c.may;
  const m = root.querySelector("#pv-mandate");
  m.textContent = a.mandate ? String(a.mandate).split(". ").slice(0, 2).join(". ") + "." : "";
  root.querySelector("#pv-now").textContent = noteOf[selected] || STATE_WORD[st];
  root.querySelector("#pv-seatno").textContent =
    "SEAT " + String(roster.findIndex((x) => x.id === selected) + 1).padStart(2, "0") + "/" + roster.length;
  const b = root.querySelector("#pv-state");
  b.dataset.st = BADGE[st] || "idle";
  b.querySelector("em").textContent = STATE_WORD[st] || st;
  root.querySelectorAll(".pv-seat").forEach((s) => s.classList.toggle("on", s.dataset.agent === selected));
}

/* ═════════════════════ attract mode ═════════════════════
 * An empty bench that says IDLE fifteen times tells a visitor nothing. Until
 * app.js says something, the room plays the recorded case. */

function playAct(n) {
  if (live) return;
  act = n;
  const a = ACTS[n];
  roster.forEach((r) => {
    const s = a.st[r.id] || "idle";
    office.setSeat(r.id, s, (a.now && a.now[r.id]) || "");
    noteOf[r.id] = (a.now && a.now[r.id]) || "";
    paintSeatCard(r.id);
  });
  refreshChips();
  if (n === 2) office.convene(["causal", "narrative", "sensitivity", "defensibility"]);
  else office.disperse();
  office.gate(a.signer ? "await" : null);
  setMode("replaying the sample case");
  let i = 0;
  const talk = () => {
    if (live) return;
    const t = a.talk[i++ % a.talk.length];
    office.say(t[0], t[1]);
    attractTimer = setTimeout(talk, 3600);
  };
  clearTimeout(attractTimer);
  talk();
  paintInspector();
  const gates = root && root.querySelector(".pv-gates");
  if (gates) gates.querySelectorAll(".pv-gate").forEach((b) => b.classList.toggle("on", +b.dataset.act === n));
  /* the last act has a verdict; every other act clears it */
  attractVerdict(n === ACTS.length - 1);
}

function startAttract() {
  if (REDUCED || live) return;
  playAct(0);
  attractCycle = setInterval(() => playAct((act + 1) % ACTS.length), ACT_DUR);
}

/* The four gates of the recorded case, as buttons under the room. This was the
 * one thing the retired /council/floor/ page could do that the bench could not:
 * jump straight to a gate instead of waiting the cycle out. Clicking restarts
 * the clock so the chosen act gets its full stay; going live removes them. */
function buildGates() {
  const gates = document.createElement("div");
  gates.className = "pv-gates";
  ACTS.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pv-gate" + (i === 0 ? " on" : "");
    b.dataset.act = i;
    b.innerHTML = esc(a.btn) + "<span>" + esc(a.sub) + "</span>";
    b.addEventListener("click", () => {
      if (live) return;
      clearInterval(attractCycle);
      playAct(i);
      attractCycle = setInterval(() => playAct((act + 1) % ACTS.length), ACT_DUR);
    });
    gates.appendChild(b);
  });
  return gates;
}
let attractCycle = 0;

function goLive() {
  if (live) return;
  live = true;
  clearInterval(attractCycle);
  clearTimeout(attractTimer);
  const gates = root && root.querySelector(".pv-gates");
  if (gates) gates.hidden = true;
  attractVerdict(false);
  office.chatter(false);
  office.reset();
  office.disperse();
  roster.forEach((r) => { noteOf[r.id] = ""; paintSeatCard(r.id); });
  setMode("");
  paintInspector();
}

function setMode(text) {
  const el = root && root.querySelector(".pv-mode");
  if (el) { el.textContent = text; el.hidden = !text; }
}

/* The analyst is not on the bench and app.js has no verb for her, so the room
 * reads the rail instead: a stage that says it is awaiting approval brings her
 * out of the corner office, and Bench.gavel() — which app.js already calls on
 * every approval — sends her back. */
function watchGates() {
  const rail = document.getElementById("rail");
  if (!rail || !office) return;
  let waiting = false;
  const check = () => {
    const now = Array.prototype.some.call(
      rail.querySelectorAll(".c-step .s"),
      (n) => /awaiting/i.test(n.textContent),
    );
    if (now === waiting) return;
    waiting = now;
    office.gate(now ? "await" : null);
  };
  new MutationObserver(check).observe(rail, { childList: true, subtree: true, characterData: true });
  check();
}

/* ═════════════════════ the Bench API (unchanged) ═════════════════════ */

export const Bench = {
  mount(el, list) {
    injectCSS();
    root = el;
    roster = list || [];
    selected = roster.length ? roster[0].id : null;
    el.className = "pv-bench";
    el.dataset.view = "room";

    el.innerHTML =
      `<div class="pv-stats"></div>` +
      `<div class="pv-room">` +
        `<div class="pv-floor">` +
          `<canvas id="pv-canvas" aria-label="The council floor: fifteen auditors at their desks, the boardroom, and the analyst's office"></canvas>` +
          `<p class="pv-hint">CLICK SOMEONE TO INSPECT</p>` +
          `<p class="pv-mode" hidden></p>` +
        `</div>` +
        `<div class="pv-gates-slot"></div>` +
        `<aside class="pv-card">` +
          `<div class="pv-card-top">SEAT<span id="pv-seatno">SEAT 01/${roster.length}</span></div>` +
          `<div class="pv-who">` +
            `<canvas id="pv-port" width="${PORTRAIT_W * 4}" height="${PORTRAIT_H * 4}"></canvas>` +
            `<div><h3 id="pv-name"></h3><p id="pv-lens"></p>` +
            `<span class="pv-badge" id="pv-state" data-st="idle"><i></i><em>idle</em></span></div>` +
          `</div>` +
          `<dl class="pv-rows">` +
            `<div><dt>LENS</dt><dd id="pv-tag"></dd></div>` +
            `<div><dt>MAY ASSERT</dt><dd id="pv-may"></dd></div>` +
            `<div><dt>NOW</dt><dd id="pv-now">idle</dd></div>` +
          `</dl>` +
          `<p class="pv-mandate" id="pv-mandate"></p>` +
        `</aside>` +
      `</div>` +
      `<div class="pv-strip"></div>`;

    statStrip = el.querySelector(".pv-stats");

    const strip = el.querySelector(".pv-strip");
    for (const a of roster) {
      const c = CAST[a.id];
      if (!c) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pv-seat" + (a.id === "research" ? " pv-quar" : "");
      b.dataset.agent = a.id;
      b.title = a.mandate ? String(a.mandate).slice(0, 300) : (a.seat || c.name);
      b.innerHTML =
        `<canvas width="${PORTRAIT_W * 2}" height="${PORTRAIT_H * 2}"></canvas>` +
        `<span class="m"><span class="h"><b>${esc(c.code)}</b>${badge("idle")}</span>` +
        `<span class="r">${esc(a.short || c.lens)}</span>` +
        `<span class="d">${"<u></u>".repeat(8)}</span></span>`;
      paintPortrait(b.querySelector("canvas").getContext("2d"), c.r, 2);
      b.addEventListener("click", () => office && office.select(a.id));
      strip.appendChild(b);
    }

    /* room / cards, because a grid of cards is still the better read on a phone */
    const view = document.createElement("div");
    view.className = "pv-view";
    view.innerHTML =
      `<button type="button" data-v="room" aria-pressed="true">room</button>` +
      `<button type="button" data-v="cards" aria-pressed="false">cards</button>`;
    view.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      el.dataset.view = b.dataset.v;
      view.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      try { localStorage.setItem("council-bench-view", b.dataset.v); } catch (_) {}
    });
    Bench.stats({});
    statStrip.appendChild(view);
    /* On a phone the room shrinks to a postage stamp — the cards say more.
     * An explicit choice always wins. */
    let start = null;
    try { start = localStorage.getItem("council-bench-view"); } catch (_) {}
    if (!start && window.innerWidth < 760) start = "cards";
    if (start === "cards") view.querySelector('[data-v="cards"]').click();

    mountOffice(el.querySelector("#pv-canvas"), {
      seats: roster.map((a) => CAST[a.id]).filter(Boolean),
      signer: SIGNER,
      chatter: true,
      onSelect: (id) => { selected = id; paintInspector(); },
    }).then((o) => {
      office = o;
      paintInspector();
      roster.forEach((a) => paintSeatCard(a.id));
      watchGates();
      if (!live && !REDUCED) {
        el.querySelector(".pv-gates-slot").replaceWith(buildGates());
        setTimeout(startAttract, 900);
      }
    });
  },

  setState(agentId, state, label) {
    goLive();
    if (!office) return;
    noteOf[agentId] = label || "";
    office.setSeat(agentId, STATE_WORD[state] ? state : "idle", label || "");
    if (label && /execut|reconcil|sql/i.test(label)) office.tool(agentId, "Bash", "SQL + reducer");
    else if (label && /scan|read|profil/i.test(label)) office.tool(agentId, "Read", label.slice(0, 22));
    else if (state === "flagged") office.tool(agentId, "Grep", label ? label.slice(0, 22) : "finding");
    paintSeatCard(agentId);
    refreshChips();
    if (agentId === selected) paintInspector();
  },

  /* Put a line in a seat's mouth. The bubble is capped short because a wall of
   * text over an 18px sprite is unreadable — the full line lives in the
   * transcript, and this is the visual cue for who is speaking. */
  say(agentId, text, kind) {
    goLive();
    if (!office) return;
    const short = String(text).replace(/\s+/g, " ").trim();
    office.say(agentId, short.length > 54 ? short.slice(0, 53) + "…" : short, 4200);
    /* the council convening is not scripted anywhere — it is just what happens
     * when seats start taking the floor one after another */
    office.callToBoard(agentId);
    if (kind === "challenge") {
      office.tool(agentId, "Grep", "challenge");
      office.note(agentId, selected && selected !== agentId ? selected : agentId, "flag");
    }
  },

  hush() { if (office) { office.hush(); office.disperse(); } },

  /* app.js pulses on every state change, so this cannot write anything — it
   * blinks the seat's terminal and nothing else. */
  pulse(agentId) { if (office) office.flash(agentId); },

  passDossier(fromId, toId) {
    if (!office) return;
    if (fromId && toId) { office.note(fromId, toId, "claim"); office.tool(toId, "Read", "dossier"); }
    else if (toId) office.flash(toId);
  },

  gavel() { if (office) office.gate("signed"); },

  dissent(agentId) {
    if (office && !dissenting.has(agentId)) office.toast(agentId, "dissent recorded");
    dissenting.add(agentId);
    if (office) office.dissent(agentId, true);
    refreshChips();
    const el = seatEl(agentId);
    if (el) el.classList.add("pv-dissent");
  },

  clearDissent(agentId) {
    dissenting.delete(agentId);
    if (office) office.dissent(agentId, false);
    refreshChips();
    const el = seatEl(agentId);
    if (el) el.classList.remove("pv-dissent");
  },

  /* app.js never had to call this — the chips count the room itself, so they
   * are live whether or not anything reports totals. Anything passed in wins. */
  stats(o) {
    if (o) Object.assign(given, o);
    refreshChips();
  },

  reset() {
    goLive();
    dissenting.clear();
    if (office) office.reset();
    roster.forEach((a) => { noteOf[a.id] = ""; paintSeatCard(a.id); });
    refreshChips();
    root && root.querySelectorAll(".pv-dissent").forEach((e) => e.classList.remove("pv-dissent"));
    paintInspector();
  },

  /* the room wants to know when a gate is waiting on a person */
  gate(status) { if (office) office.gate(status); },
};

export default Bench;
