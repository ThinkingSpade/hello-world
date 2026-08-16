/* floor.js — the replay driver.
 *
 * The room itself is ./office.js, which knows nothing about Council. This file
 * is one of its two drivers: it walks the four recorded acts in ../floor/run.js
 * and tells the room what happened. The other driver is ../agents.js, which
 * tells it the same things from a live run.
 */

import { mountOffice, paintPortrait, PORTRAIT_W, PORTRAIT_H } from "./office.js";
import { SEATS, SIGNER, ACTS, ACT_DUR, STATE_WORD } from "./run.js";

const $ = (id) => document.getElementById(id);
const BY_ID = {};
SEATS.forEach((s) => { BY_ID[s.id] = s; });

let office = null;
let act = 0, actAt = 0, pausedUntil = 0;
let logIdx = 0, nextLogAt = 0, talkIdx = 0, nextTalkAt = 0, nextShipAt = 0, toolIdx = 0, nextToolAt = 0;
let selected = SEATS[0].id;

const badgeOf = (st) =>
  st === "flag" || st === "block" ? "blocked" : st === "done" ? "success" : st === "on" ? "working" : "idle";

mountOffice($("floorCanvas"), {
  seats: SEATS,
  signer: SIGNER,
  chatter: true,
  onSelect: (id) => { selected = id; paintSeat(); },
}).then((o) => {
  office = o;
  buildChrome();
  setAct(0, false);
  requestAnimationFrame(loop);
});

/* ── chrome ── */

function buildChrome() {
  const strip = $("cards");
  SEATS.forEach((s) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "card";
    c.dataset.seat = s.id;
    c.innerHTML =
      `<canvas class="card-face" width="${PORTRAIT_W * 2}" height="${PORTRAIT_H * 2}"></canvas>` +
      `<span class="card-main">` +
        `<span class="card-top"><b>${s.code}</b><span class="badge" data-st="idle"><i></i><em>idle</em></span></span>` +
        `<span class="card-sub">${s.lens}</span>` +
        `<span class="dots">${"<u></u>".repeat(8)}</span>` +
      `</span>`;
    paintPortrait(c.querySelector("canvas").getContext("2d"), s.r, 2);
    c.addEventListener("click", () => office.select(s.id));
    strip.appendChild(c);
  });

  ACTS.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gate" + (i === 0 ? " on" : "");
    b.dataset.act = i;
    b.innerHTML = `${a.btn}<span>${a.sub}</span>`;
    b.addEventListener("click", () => setAct(i, true));
    $("gates").appendChild(b);
  });
}

function stateOf(k) { return ACTS[act].st[k] || "idle"; }
function nowOf(k) {
  const a = ACTS[act];
  if (a.now && a.now[k]) return a.now[k];
  const st = stateOf(k);
  return st === "done" ? "lens covered, nothing outstanding"
    : st === "block" ? "held — cannot become evidence"
    : st === "on" ? "reading the analysis" : "waiting its turn";
}

function paintSeat() {
  const s = BY_ID[selected], st = stateOf(selected);
  paintPortrait($("idPortrait").getContext("2d"), s.r, 5);
  $("idName").textContent = s.name;
  $("idRole").textContent = s.lens;
  $("idLens").textContent = s.tag.toLowerCase();
  $("idMay").textContent = s.may;
  $("idTask").textContent = nowOf(selected);
  $("idSerial").textContent = "SEAT " + String(SEATS.indexOf(s) + 1).padStart(2, "0") + "/15";
  const b = $("idState");
  b.dataset.st = badgeOf(st);
  b.querySelector("em").textContent = STATE_WORD[st];
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("on", c.dataset.seat === selected));
}

function paintCards() {
  document.querySelectorAll(".card").forEach((c) => {
    const st = stateOf(c.dataset.seat);
    const b = c.querySelector(".badge");
    b.dataset.st = badgeOf(st);
    b.querySelector("em").textContent = STATE_WORD[st].replace(/^[^ ]+ /, "");
    const on = st === "idle" ? 1 : st === "on" ? 4 : st === "flag" ? 6 : st === "block" ? 3 : 8;
    c.querySelectorAll(".dots u").forEach((d, i) => d.classList.toggle("lit", i < on));
  });
}

function pushLog(line) {
  const el = $("log");
  const p = document.createElement("p");
  p.textContent = line;
  el.appendChild(p);
  while (el.children.length > 3) el.removeChild(el.firstChild);
}

/* ── the acts ── */

const CONVENERS = ["causal", "narrative", "sensitivity", "defensibility"];

function setAct(n, manual) {
  if (manual) pausedUntil = performance.now() + 45000;
  act = n;
  actAt = performance.now();
  const a = ACTS[n];
  $("dexTitle").textContent = a.title;
  $("dexRead").textContent = a.read;
  $("clock").textContent = a.time;
  document.querySelectorAll(".gate").forEach((b) => b.classList.toggle("on", +b.dataset.act === n));
  $("log").innerHTML = "";
  logIdx = 0; nextLogAt = 0; talkIdx = 0; nextTalkAt = 0; nextShipAt = 0; toolIdx = 0; nextToolAt = 0;

  office.reset();
  SEATS.forEach((s) => office.setSeat(s.id, stateOf(s.id), nowOf(s.id)));
  if (n === 2) office.convene(CONVENERS); else office.disperse();
  office.gate(a.signer ? "await" : null);
  paintCards();
  paintSeat();
}

function loop(ts) {
  const a = ACTS[act];
  if (ts > pausedUntil && ts - actAt > ACT_DUR) setAct((act + 1) % ACTS.length, false);

  if (ts >= nextLogAt) {
    pushLog(a.log[logIdx % a.log.length]);
    logIdx++;
    nextLogAt = ts + 3000;
    /* the analyst signs on the act's last line, then goes back to her office */
    if (a.signer && logIdx % a.log.length === 0) office.gate("signed");
  }
  if (ts >= nextTalkAt) {
    const t = a.talk[talkIdx % a.talk.length];
    talkIdx++;
    office.say(t[0], t[1]);
    nextTalkAt = ts + 3600;
  }
  if (a.tools && ts >= nextToolAt) {
    const t = a.tools[toolIdx % a.tools.length];
    toolIdx++;
    office.tool(t[0], t[1], t[2]);
    nextToolAt = ts + 4200;
  }
  if (ts >= nextShipAt) {
    const ships = a.ships || [];
    const pool = SEATS.map((s) => s.id).filter((k) => stateOf(k) !== "idle");
    if (ships.length && pool.length) {
      office.toast(pool[(Math.random() * pool.length) | 0], "✓ " + ships[(Math.random() * ships.length) | 0]);
    }
    nextShipAt = ts + 5200 + Math.random() * 3400;
  }
  requestAnimationFrame(loop);
}
