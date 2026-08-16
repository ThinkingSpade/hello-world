/* office.js — the room, as a component.
 *
 * Munder Difflin's office floor, extracted from their app scene so it can be
 * driven by anything. vendor/munder-office.tmj is the Tiled map — walls,
 * collision, the boardroom and cafeteria zones, every desk position and both
 * furniture layers. They took it from shahar061/the-office (ISC) and so did we.
 * The people are their cast art from vendor/munder-people.js, and they walk on
 * their BFS from vendor/munder-pathfinding.js.
 *
 * Two things are deliberately ours:
 *
 *   The paint. Their floor is rendered from the LimeZu tilesets, which are
 *   licensed non-commercial, so nothing here loads an image — every tile is
 *   drawn in code. And Council's surface is white-dominant with one accent, so
 *   the room is white and ink rather than their sage and wood. The only
 *   saturated things in it are the people, the fifteen lens colours, and state.
 *
 *   The driver. This module knows nothing about runs, gates or replays. It is
 *   mounted with a cast and then told things: who is doing what, who said what,
 *   what is crossing the floor, who is wanted in the boardroom, and whether a
 *   human is waiting to sign. ../agents.js drives it from a real run;
 *   ./floor.js drives it from a recorded one.
 */

import {
  SCENE_W, SCENE_H, PORTRAIT_W, PORTRAIT_H,
  sceneFrameBufs, bufToCanvas, paintPortrait,
} from "./vendor/munder-people.js";
import { findPath } from "./vendor/munder-pathfinding.js";
import { BREAK_LINES, BREAK_EXCHANGES } from "./cast.js";
import { loadTilesets, paintLayers, missingGids, drawGid, drawRaw } from "./vendor/munder-tiles.js";

export { PORTRAIT_W, PORTRAIT_H, paintPortrait };

const TILE = 16;
const MAP_URL = new URL("./vendor/munder-office.tmj", import.meta.url);

/* white-dominant paint: paper, ink, one accent */
/* Three values, lightest first, so a white room still has structure:
 * the floor is the white, the walls step down, the ink draws everything. */
/* White-dominant means the floor is white, not that everything is. A room reads
 * at a glance only if its materials differ in value: wood desks, dark chairs,
 * terracotta pots, grey screens, and walls with a face and a shadow. */
const C = {
  floorA: "#FFFFFF", floorB: "#F8F5ED", grout: "rgba(30,26,20,0.07)",
  grid: "rgba(30,26,20,0.07)",
  wallFace: "#E7E1D1", wallCap: "#F4F0E4", wallBase: "#CFC5AE", wallInk: "#1E1A14",
  cast: "rgba(30,26,20,0.13)",
  wood: "#E3C48E", woodEdge: "#C7A25F", woodLeg: "#A9884D",
  chair: "#4C4658", chairHi: "#655E73",
  metal: "#E9E4D6", metalEdge: "#CFC7B2",
  screen: "#2E2C36", stand: "#9A93A4",
  pot: "#C97B4E", leaf: "#3E8E5A", leafHi: "#5BAE74",
  rug: "#F1ECFA", rugEdge: "#DACFF0",
  deskTop: "#E3C48E", deskEdge: "#C7A25F",
  ink: "#1E1A14", soft: "#8B8272",
};
/* Two vocabularies, one room. The live bench speaks council.js's states; the
 * replay speaks the shorter set the acts are written in. Both land here. */
const STATE_TAG = {
  idle: "", reading: "reading", thinking: "thinking", writing: "writing",
  flagged: "flagged", blocked: "blocked", done: "cleared",
  on: "reviewing", flag: "flagged", block: "blocked",
};
const STATE_DOT = {
  idle: "#8B8272", reading: "#2547C9", thinking: "#8A6200", writing: "#7A4FBF",
  flagged: "#B3372C", blocked: "#B3372C", done: "#246B45",
  on: "#8A6200", flag: "#B3372C", block: "#B3372C",
};
const BUSY = new Set(["reading", "thinking", "writing", "on"]);

/* the fifteen desks, in the order their map lists them */
const STATION_ORDER = [
  "pc-1", "pc-2", "pc-3", "pc-4", "pc-5", "pc-6",
  "desk-team-lead", "desk-backend-engineer", "desk-product-manager",
  "desk-data-engineer", "desk-project-manager", "desk-market-researcher",
  "desk-agent-organizer", "desk-chief-architect", "desk-ui-ux-expert",
];

/* ── module state (one office per page) ── */
let cv = null, ctx = null, ready = false;
let W = 0, H = 0, COLS = 0, ROWS = 0;
let solid = [], solidRaw = [], wallAt = [], floorAt = [];
let stations = {}, zones = {};
let SEATS = [], BY_ID = {}, ORDER = [];
let frames = {}, signerFrames = null;
const people = {};
let signer = null;
let selected = null, onSelect = null;
const notes = [], toasts = [], board = [];
let chatter = false, nextNoteAt = 0;
let cafeSpots = [], nextBreakAt = 0, boardSeats = [];
/* The VP sits in the corner office and is the reason any of this is happening:
 * a seat that finishes its lens walks its findings over, hands them across the
 * desk and goes back to work. One at a time, so you can follow it. */
let vpSeat = null, submitQ = [], filing = null, vpStampUntil = 0;
const FILES_WITH_VP = new Set(["done", "flag", "flagged", "block", "blocked"]);
/* Their coffee economy, in miniature: a finite stock of clean mugs lives by the
 * machine. Brewing takes one; it then sits on that auditor's desk until they
 * carry it back and wash it. Park every mug on a desk and the rack runs dry,
 * and the floor notices. (OfficeFloor.tsx, "the coffee economy".) */
const MUGS = 4;
let cleanMugs = MUGS;
let running = true, onScreen = true, last = 0, simNow = 0, rafId = 0;
let staticCv = null;   /* the room under everyone, painted once */
let aboveTiles = [];   /* their furniture-above layer, depth-sorted with the people */
let mapData = null, tilesets = [], gaps = new Set(), fbRaw = null;
let SS = 2;            /* device pixels per world pixel, set from the layout */

const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const grid = { isWalkable: (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !solid[y][x] };

/* ═══════════════ mount ═══════════════ */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{seats: Array, signer: object, onSelect?: (id:string)=>void, chatter?: boolean}} opts
 * @returns {Promise<object>} the office handle
 */
export async function mountOffice(canvas, opts) {
  cv = canvas;
  ctx = cv.getContext("2d");
  SEATS = opts.seats;
  BY_ID = {}; ORDER = [];
  SEATS.forEach((s) => { BY_ID[s.id] = s; ORDER.push(s.id); });
  onSelect = opts.onSelect || null;
  chatter = !!opts.chatter;
  selected = ORDER[0];

  frames = {};
  SEATS.forEach((s) => {
    const f = sceneFrameBufs(s.r);
    frames[s.id] = {
      front: f.front.map((b) => bufToCanvas(b, SCENE_W, SCENE_H)),
      back: f.back.map((b) => bufToCanvas(b, SCENE_W, SCENE_H)),
    };
  });
  const sf = sceneFrameBufs(opts.signer.r);
  signerFrames = {
    front: sf.front.map((b) => bufToCanvas(b, SCENE_W, SCENE_H)),
    back: sf.back.map((b) => bufToCanvas(b, SCENE_W, SCENE_H)),
  };

  const map = mapData = await fetch(MAP_URL).then((r) => r.json());
  COLS = map.width; ROWS = map.height;
  W = COLS * TILE; H = ROWS * TILE;
  cv.height = Math.round(H * 2);   /* provisional, fixed up by resize() */
  cv.width = Math.round(W * 2);

  patchMap(map);
  const layer = (n) => map.layers.find((l) => l.name === n);
  const g = (n) => {
    const d = layer(n).data, out = [];
    for (let r = 0; r < ROWS; r++) out.push(d.slice(r * COLS, (r + 1) * COLS));
    return out;
  };
  const coll = g("collision"), wl = g("walls"), fl = g("floor");
  const fb = g("furniture-below"), fa = g("furniture-above");
  fbRaw = layer("furniture-below").data;
  solid = []; solidRaw = []; wallAt = []; floorAt = [];
  for (let r = 0; r < ROWS; r++) {
    solid.push([]); solidRaw.push([]); wallAt.push([]); floorAt.push([]);
    for (let c = 0; c < COLS; c++) {
      solid[r].push(coll[r][c] !== 0);
      solidRaw[r].push(coll[r][c] !== 0);
      wallAt[r].push(wl[r][c] !== 0);
      floorAt[r].push(fl[r][c] !== 0);
    }
  }
  tilesets = await loadTilesets(map, MAP_URL);
  gaps = missingGids(map, tilesets, ["floor", "walls", "furniture-below", "furniture-above"]);
  readFurniture(fb, fa);
  aboveTiles = [];
  {
    const d = layer("furniture-above").data;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const raw = d[r * COLS + c];
      if (raw) aboveTiles.push({ raw, x: c * TILE, y: r * TILE, sortY: (r + 1) * TILE - 2 });
    }
  }
  stations = {}; zones = {};
  layer("spawn-points").objects.forEach((o) => {
    stations[o.name] = { x: o.x, y: o.y };
    const t = tileOf(o.x, o.y);
    if (solid[t.y] && /^(desk-|pc-|warroom-|entrance|cafe-)/.test(o.name)) solid[t.y][t.x] = false;
  });
  layer("zones").objects.forEach((o) => { zones[o.name] = o; });

  SEATS.forEach((s, i) => {
    const st = stations[STATION_ORDER[i % STATION_ORDER.length]];
    const seat = seatPoint(st);
    const face = facingForSeat(tileOf(st.x, st.y));
    people[s.id] = {
      id: s.id, home: seat, homeFace: face,
      x: seat.x, y: seat.y, face, seated: true,
      st: "idle", note: "", dissent: false, at: -1e9, flash: -1e9, said: 0, cup: false,
      tool: null, toolUntil: 0, bubbleAt: 0,
      path: null, step: 0, bubble: null, bubbleUntil: 0, screen: i * 7,
    };
  });
  pairScreens(fb, fa);
  buildCafeSpots();
  buildBoardSeats(fb);
  const ceo = stations["desk-ceo"];
  signer = { x: ceo.x, y: ceo.y + TILE - 1, face: "down", path: null, step: 0, phase: "office", until: 0, alpha: 1, want: null };
  buildVpSeat();

  cv.addEventListener("click", hitTest);
  document.addEventListener("visibilitychange", vis);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; vis(); }, { threshold: 0.04 }).observe(cv);
  }

  resize();
  if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(cv.parentElement || cv);
  addEventListener("resize", resize);
  API.reset(true);
  ready = true;
  draw(0);
  rafId = requestAnimationFrame(frame);
  return API;
}

/* The cafeteria table looks half-built because of one tile: gid 39, a blank
 * cream slab, sits against its right edge with collision on. It belongs to
 * nothing — the table itself is a 2x2 decal in the floor layer (1698/1699 over
 * 1714/1715) with legs and benches on top, and it is complete without it.
 * Drop the slab and the table reads as finished. */
function patchMap(map) {
  const cols = map.width;
  const L = (n) => map.layers.find((l) => l.name === n);
  const at = (n, c, r, v) => { L(n).data[r * cols + c] = v; };
  at("furniture-below", 29, 15, 0);
  at("collision", 29, 15, 0);
}

function vis() {
  const was = running;
  running = !document.hidden && onScreen;
  if (running && !was) { last = 0; rafId = requestAnimationFrame(frame); }
}

/* ═══════════════ the API a driver uses ═══════════════ */

export const API = {
  /** state: idle | on | flag | block | done */
  setSeat(id, state, note) {
    const p = people[id];
    if (!p) return;
    /* Reaching a verdict is what sends an auditor to the VP — neither driver
     * has to ask for it, they just report the state they always reported. */
    if (state && state !== p.st) {
      p.at = simNow;
      if (FILES_WITH_VP.has(state) && !FILES_WITH_VP.has(p.st)) API.submit(id);
    }
    if (state) p.st = state;
    if (note != null) p.note = note;
    if (id === selected && onSelect) onSelect(id);
  },
  /* "<icon> <target>" over a seat: what it is touching right now. */
  tool(id, kind, target, ms = 2600) {
    const p = people[id];
    if (!p) return;
    p.tool = (TOOL_ICONS[kind] || TOOL_DEFAULT) + " " + target;
    p.toolUntil = simNow + ms;
  },
  say(id, text, ms = 3200) {
    const p = people[id];
    if (!p || !text) return;
    /* only two voices at a time — three overlapping boxes is not a conversation */
    const talking = ORDER.filter((k) => people[k].bubble && k !== id)
      .sort((a, b) => people[a].said - people[b].said);
    while (talking.length >= 2) { const q = people[talking.shift()]; q.bubble = null; }
    p.said = simNow;
    p.bubbleAt = simNow;
    p.bubble = String(text).slice(0, 56);
    p.bubbleUntil = simNow + ms;
  },
  hush() { ORDER.forEach((k) => { people[k].bubble = null; }); },
  /** an envelope crossing the floor */
  note(fromId, toId, kind) {
    const a = people[fromId], b = people[toId];
    if (!a || !b) return;
    notes.push({ from: a, to: b, t: 0, kind: kind || "claim" });
  },
  /* A toast is for something that happened once and matters. Three on screen
   * at a time, newest wins — fifteen seats reporting at once was a smear. */
  toast(id, text) {
    const p = people[id] || { x: W / 2, y: H - 40 };
    toasts.push({ x: p.x, y: p.y - 34, text, t: 0 });
    while (toasts.length > 3) toasts.shift();
  },
  /* the cheap acknowledgement: the seat's terminal blinks, nothing is written */
  flash(id) { if (people[id]) people[id].flash = simNow; },
  dissent(id, on = true) { if (people[id]) people[id].dissent = on; },
  /** send seats to the boardroom table; call with no argument to send them home */
  /* Sit them in the boardroom's own chairs — alternating sides of the table so
   * the people who are arguing are looking at each other. Standing in a row on
   * one side, or worse inside the table, is not a meeting. */
  convene(ids) {
    if (!boardSeats.length) return;
    board.length = 0;
    (ids || []).slice(0, boardSeats.length).forEach((k, i) => {
      const p = people[k];
      if (!p) return;
      if (p.break) { cafeSpots[p.break.idx].taken = null; p.break = null; }
      board.push(k);
      p.sitFace = boardSeats[i].face;
      takeSeat(p, boardSeats[i]);
    });
  },
  /* Whoever has the floor walks to the table. Four chairs, oldest gives one up —
   * this is how a live deliberation convenes without anyone scripting it. */
  callToBoard(id) {
    const p = people[id];
    if (p && p.break) { cafeSpots[p.break.idx].taken = null; p.break = null; }
    if (!p || !boardSeats.length || board.includes(id)) return;
    if (board.length >= boardSeats.length) {
      const out = board.shift();
      people[out].sitFace = null;
      walkTo(people[out], people[out].home);
    }
    const seat = boardSeats[board.length];
    board.push(id);
    p.sitFace = seat.face;
    takeSeat(p, seat);
  },
  disperse() {
    board.length = 0;
    ORDER.forEach((k) => { people[k].sitFace = null; people[k].sitBehind = false; });
    ORDER.forEach((k) => { const q = people[k]; if (q.break) { cafeSpots[q.break.idx].taken = null; q.break = null; } });
    /* "seated" is NOT "at home" — a boardroom chair and the VP's guest stool
     * both seat you. Anyone not physically at their own desk walks back;
     * checking `seated` here stranded conveners at the table across acts, and
     * the next walker phased straight through them. */
    ORDER.forEach((k) => { const p = people[k]; if (!atHome(p)) walkTo(p, { x: p.home.x, y: p.home.y }); });
  },
  /** 'await' brings the analyst out to be shown the work; 'signed' sends her back */
  gate(status) {
    if (status === "await") { signer.want = "floor"; if (signer.phase === "office") signer.phase = "coming"; }
    else if (status === "signed") { signer.phase = "signing"; signer.until = simNow + 2200; API.toast(null, "✓ approved"); }
    else { signer.want = null; if (signer.phase !== "office") signer.phase = "going"; }
  },
  /** hand this seat's findings to the VP; queued, three deep at most */
  submit(id) {
    if (!vpSeat || !people[id]) return;
    if ((filing && filing.id === id) || submitQ.indexOf(id) !== -1) return;
    submitQ.push(id);
    while (submitQ.length > 3) submitQ.shift();
  },
  select(id) { if (people[id]) { selected = id; if (onSelect) onSelect(id); } },
  selected() { return selected; },
  chatter(on) { chatter = !!on; },
  /* `hard` places everyone instantly and is only for a fresh mount. Any other
   * reset walks them home: snapping fifteen sprites back across the floor is
   * what made the loop jump when one act handed over to the next. */
  reset(hard) {
    ORDER.forEach((k) => {
      const p = people[k];
      p.st = "idle"; p.note = ""; p.dissent = false; p.bubble = null; p.tool = null;
      p.sitFace = null; p.carry = false; p.sitBehind = false;
      if (p.break) { cafeSpots[p.break.idx].taken = null; p.break = null; }
      if (hard) {
        p.path = null; p.cup = false;
        p.x = p.home.x; p.y = p.home.y; p.seated = true; p.face = p.homeFace || "up";
      } else if (!atHome(p)) {
        walkTo(p, p.home);
      }
    });
    notes.length = 0; toasts.length = 0; board.length = 0;
    submitQ.length = 0; filing = null;
    cafeSpots.forEach((c) => { c.taken = null; });
    if (!hard) return;
    cleanMugs = MUGS;
    signer.phase = "office"; signer.want = null; signer.path = null;
    signer.x = stations["desk-ceo"].x; signer.y = stations["desk-ceo"].y + TILE - 1;
  },
  seatState(id) { return people[id] ? people[id].st : "idle"; },
  mugs() { return cleanMugs; },
  isReady() { return ready; },
};

/* The break area, built from the map's own spawn points. Seats first so the
 * partner indices are stable, then the standing spots, which face the first
 * adjacent piece of furniture — the appliance they are using. Two seats that
 * share a table are the ones in the same column, two tiles apart. Theirs, in
 * OfficeFloor.tsx. */
/* The map draws the boardroom chairs as furniture on both sides of the table:
 * gid 257 along the north edge and 274 along the south. Sitting in them means
 * facing the table, so the two sides look at each other. */
function buildBoardSeats(fb) {
  const north = [], south = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const g = GID(fb[r][c]);
    if (g === 257) north.push({ c, r });
    else if (g === 274) south.push({ c, r });
  }
  /* The two sides are built differently and must be sat in differently.
   * North (257) is a whole chair in one tile, facing the viewer: you sit on its
   * cushion, at the bottom of its own tile. South is TWO tiles — the back panel
   * (258) lives in the layer ABOVE, one row up, with only a 2px foot (274) in
   * the tile the map marks. Sitting at that tile's floor line leaves you
   * standing thirteen pixels in front of the chair, which is why the south side
   * never looked seated. Sit just above the panel instead and the depth sort
   * draws it across your back, leaving head and shoulders showing. */
  const mid = (list, face, sit) => list.map((t) => ({
    at: { x: t.c * TILE + TILE / 2, y: t.r * TILE + TILE - 1 }, sit: sit(t.r), face,
  }));
  /* Deepest chair first. The north bench is entered from its west end, so if
   * the first convener takes the near seat, everyone after them has to shuffle
   * through an occupied chair to get past. Filling from the far end means each
   * arrival only ever walks past empty seats — how people actually fill a pew. */
  const n = mid(north.reverse(), "down", (r) => r * TILE + TILE - 1);
  const so = mid(south.reverse(), "up", (r) => r * TILE - 4);
  /* Alternate sides AND step along the table, so the four end up in a zigzag
   * looking at each other across it. Seating a north and a south chair in the
   * SAME column stacks two 32px sprites 29px apart, and the near one's head
   * lands on the far one's chair — which is what made the north side stop
   * looking seated. Four is the meeting; `callToBoard` rotates within it. */
  boardSeats = [];
  for (let i = 0; i < Math.max(n.length, so.length) && boardSeats.length < 4; i++) {
    const side = i % 2 === 0 ? n : so;
    if (side[i]) boardSeats.push(side[i]);
  }
  /* A chair is furniture. Open up EVERY chair tile, not only the four we seat
   * people in: the north row is reached by walking along it, so leaving the
   * unused chairs solid walls off the seats beyond them and the walk silently
   * fails — the auditor just stays at their desk. */
  north.concat(south).forEach((t) => { if (solid[t.r]) solid[t.r][t.c] = false; });
}

/* The guest stool on the far side of the VP's desk — the map draws one, two
 * tiles south of where she sits, and that is where findings get handed over. */
function buildVpSeat() {
  vpSeat = null;
  const ceo = stations["desk-ceo"];
  if (!ceo) return;
  const s = tileOf(ceo.x, ceo.y);
  for (let d = 2; d <= 4; d++) {
    const r = s.y + d;
    if (r < ROWS && !solid[r][s.x]) {
      vpSeat = { at: { x: s.x * TILE + TILE / 2, y: r * TILE + TILE - 1 }, face: "up" };
      return;
    }
  }
}

/* Walk over, sit down, hand the work across, walk back. The VP has to be at her
 * desk to be handed anything, so this waits while she is out signing. */
/* Where you go to hand her something. At her desk that is the guest stool
 * opposite her; out on the floor with the bundle it is whatever tile you can
 * stand on beside her. Only while she is actually walking is there nowhere. */
function vpTarget() {
  if (signer.phase === "office") return vpSeat;
  if (signer.phase === "coming" || signer.phase === "going") return null;
  const t = tileOf(signer.x, signer.y);
  const sides = [[0, 1, "up"], [1, 0, "left"], [-1, 0, "right"], [0, -1, "down"]];
  for (const [dx, dy, face] of sides) {
    const x = t.x + dx, y = t.y + dy;
    if (grid.isWalkable(x, y)) return { at: { x: x * TILE + TILE / 2, y: y * TILE + TILE - 1 }, face };
  }
  return null;
}

function stepFiling(now) {
  if (!vpSeat) return;
  if (!filing) {
    if (!submitQ.length) return;
    const to = vpTarget();
    if (!to) return;
    const id = submitQ.shift();
    const p = people[id];
    if (!p || board.indexOf(id) !== -1) return;
    if (p.break) { cafeSpots[p.break.idx].taken = null; p.break = null; }
    p.carry = true;
    p.sitFace = to.face;
    walkTo(p, to.at);
    filing = { id, phase: "walk", until: 0 };
    return;
  }
  const p = people[filing.id];
  if (!p) { filing = null; return; }
  if (filing.phase === "walk") {
    /* the council called them to the table on the way — the filing can wait */
    if (board.indexOf(filing.id) !== -1) { p.carry = false; filing = null; return; }
    if (p.path) return;
    filing.phase = "hand";
    filing.until = now + 2400;
    API.tool(filing.id, "TodoWrite", "findings", 2400);
  } else if (filing.phase === "hand") {
    if (now < filing.until) return;
    p.carry = false;
    vpStampUntil = now + 1600;
    filing.phase = "back";
    walkTo(p, p.home);
  } else if (!p.path) {
    /* keep trying until they are actually home — a walk that could not start
     * (someone standing in the way of the search) must not strand the filer on
     * the stool while the next filer is sent to the same spot */
    if (atHome(p)) filing = null;
    else walkTo(p, p.home);
  }
}

/* Walk to the seat's tile, but finish at the seat's own sit line — a chair whose
 * art straddles two tiles is not sat in at its tile's floor. */
function takeSeat(p, seat) {
  walkTo(p, seat.at);
  p.sitBehind = seat.sit !== seat.at.y;
  if (p.path && p.sitBehind) p.path[p.path.length - 1] = { x: seat.at.x, y: seat.sit };
}

function buildCafeSpots() {
  const faceFurniture = (t) => {
    const solidAt = (x, y) => !(x >= 0 && y >= 0 && x < COLS && y < ROWS) || solidRaw[y][x];
    if (solidAt(t.x + 1, t.y)) return "right";
    if (solidAt(t.x - 1, t.y)) return "left";
    if (solidAt(t.x, t.y - 1)) return "up";
    return "down";
  };
  cafeSpots = [];
  ["cafe-seat-1", "cafe-seat-2", "cafe-seat-3", "cafe-seat-4"].forEach((n) => {
    const pt = stations[n];
    if (pt) cafeSpots.push({ at: seatPoint(pt), face: facingForSeat(tileOf(pt.x, pt.y)), kind: "table", seated: true, partner: -1, taken: null });
  });
  for (let i = 0; i < cafeSpots.length; i++) {
    for (let j = i + 1; j < cafeSpots.length; j++) {
      const a = cafeSpots[i].at, b = cafeSpots[j].at;
      if (a.x === b.x && Math.abs(a.y - b.y) === TILE * 2) { cafeSpots[i].partner = j; cafeSpots[j].partner = i; }
    }
  }
  [["cafe-stand-coffee", "coffee"], ["cafe-stand-vending", "vending"]].forEach(([n, kind]) => {
    const pt = stations[n];
    if (pt) cafeSpots.push({ at: seatPoint(pt), face: faceFurniture(tileOf(pt.x, pt.y)), kind, seated: false, partner: -1, taken: null });
  });
}

const pick = (a) => a[(Math.random() * a.length) | 0];

/* Send an idle auditor on a break: walk over, say something, walk back. If the
 * auditor across the table is already there, they trade a two-beat exchange —
 * which is what makes lingering read as purposeful rather than as drift. */
function sendOnBreak(now) {
  const free = cafeSpots.map((s, i) => [s, i]).filter(([s]) => !s.taken);
  if (!free.length) return;
  const idle = ORDER.filter((k) => {
    const q = people[k];
    return q.st === "idle" && q.seated && !q.path && !q.break;
  });
  if (!idle.length) return;

  let who = pick(idle);
  const carriers = idle.filter((k) => people[k].cup);
  const coffee = free.filter(([sp]) => sp.kind === "coffee");
  let chosen = pick(free);
  if (carriers.length && coffee.length && Math.random() < 0.6) {
    who = pick(carriers); chosen = coffee[0];        /* go and wash it */
  }
  const [spot, idx] = chosen;
  const p = people[who];
  spot.taken = who;
  p.break = { idx, phase: "going", until: 0 };
  walkTo(p, spot.at);
}

function stepBreaks(now) {
  if (chatter && now >= nextBreakAt) { sendOnBreak(now); nextBreakAt = now + 6000 + Math.random() * 8000; }

  ORDER.forEach((k) => {
    const p = people[k];
    if (!p.break) return;
    const spot = cafeSpots[p.break.idx];
    if (p.break.phase === "going") {
      if (p.path) return;
      p.face = spot.face;
      p.break.phase = "there";
      p.break.until = now + 7000 + Math.random() * 5000;
      const mate = spot.partner >= 0 ? cafeSpots[spot.partner].taken : null;
      if (spot.kind === "coffee" && p.cup) {
        p.cup = false; cleanMugs++;
        API.say(k, "washed it. back on the rack", 3200);
      } else if (spot.kind === "coffee" && cleanMugs <= 0) {
        API.say(k, "rack is dry. everyone's mug is on a desk", 3600);
      } else if (spot.kind === "coffee") {
        cleanMugs--; p.cup = true;
        API.say(k, pick(BREAK_LINES.coffee), 3400);
      } else if (mate && people[mate] && people[mate].break && people[mate].break.phase === "there") {
        const [a, b] = pick(BREAK_EXCHANGES);
        API.say(mate, a, 3400);
        p.break.reply = { at: now + 1900, text: b };
      } else {
        API.say(k, pick(BREAK_LINES[spot.kind] || BREAK_LINES.table), 3600);
      }
    } else if (p.break.phase === "there") {
      if (p.break.reply && now >= p.break.reply.at) { API.say(k, p.break.reply.text, 3200); p.break.reply = null; }
      if (now >= p.break.until) {
        p.break.phase = "home";
        walkTo(p, { x: p.home.x, y: p.home.y });
      }
    } else if (p.break.phase === "home" && !p.path) {
      spot.taken = null;
      p.break = null;
    }
  });
}

/* Pair each monitor block the map painted with the auditor whose desk it is.
 * Runs after the seats exist, which is why it is not part of readFurniture. */
function pairScreens(fb, fa) {
  screens = [];
  for (const grid of [fb, fa]) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (GID(grid[r][c]) !== MONITOR_OFF_TOPLEFT_GID) continue;
      const x = c * TILE, y = r * TILE;
      let seat = null, best = 40;
      ORDER.forEach((k) => {
        const d = Math.hypot(x + TILE - people[k].home.x, y + TILE * 1.5 - people[k].home.y);
        if (d < best) { best = d; seat = k; }
      });
      screens.push({ col: c, row: r, x, y, seat });
    }
  }
}

/* A Tiled point sits at the tile's top-left; a sprite is anchored at its feet.
 * Standing someone on the spawn y puts them a full tile high — on top of their
 * own desk instead of in the chair. Feet go on the tile's bottom edge. */
function seatPoint(pt) {
  const t = tileOf(pt.x, pt.y);
  return { x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE - 1 };
}

/* Face a seated auditor toward their desk — the adjacent piece of furniture.
 * Theirs, verbatim in behaviour: a standard desk puts the monitor to the north
 * and the chair to the south, so the auditor faces up and you see their back,
 * like a real worker. (OfficeFloor.tsx, facingForSeat.) */
function facingForSeat(t) {
  const solidAt = (x, y) => !(x >= 0 && y >= 0 && x < COLS && y < ROWS) || solidRaw[y][x];
  if (solidAt(t.x, t.y - 1)) return "up";
  if (solidAt(t.x, t.y + 1)) return "down";
  if (solidAt(t.x - 1, t.y)) return "left";
  if (solidAt(t.x + 1, t.y)) return "right";
  return "up";
}

/* ═══════════════ furniture ═══════════════
 * Their map places 304 furniture tiles across two layers and we cannot ship the
 * tileset that draws them (LimeZu, non-commercial), so the tile ids are read as
 * a placement map instead: each object announces itself with a known first tile,
 * and we draw our own in the room's palette at their coordinates. Anything not
 * recognised is left out rather than guessed at with a mystery box.
 *
 * below = under everyone (desks, tables, counters, plants)
 * above = over everyone (monitors, chair backs), which is what tucks a seated
 *         auditor behind their own desk exactly as their renderer does.
 */
const PROP = {
  2:    { kind: "desk",    w: 3, h: 3 },
  38:   { kind: "table",   w: 3, h: 2 },
  191:  { kind: "vending", w: 2, h: 3 },
  468:  { kind: "plant",   w: 1, h: 2 },
  470:  { kind: "plant",   w: 1, h: 1 },
  471:  { kind: "plant",   w: 1, h: 1 },
  472:  { kind: "plant",   w: 1, h: 1 },
  451:  { kind: "plant",   w: 1, h: 1 },
  452:  { kind: "plant",   w: 1, h: 1 },
  327:  { kind: "art",     w: 2, h: 2 },
  1026: { kind: "counter", w: 4, h: 3 },
  1041: { kind: "counter", w: 3, h: 2 },
  266:  { kind: "shelf",   w: 1, h: 2 },
  281:  { kind: "shelf",   w: 2, h: 2 },
  297:  { kind: "shelf",   w: 2, h: 1 },
};
const GID = (v) => v & 0x1fffffff;   /* strip Tiled's flip flags */
let propsBelow = [], propsAbove = [], screens = [];

/* The office tileset ships every desk PC twice: dark and switched off at
 * 365/366 + 381/382, which is what the map paints, and the SAME monitor with a
 * lit desktop at 367/368 + 383/384 directly to its right in the atlas. Their
 * DeskScreen overlays the lit pair while an agent is seated; so does this.
 * (scene/office/DeskScreen.ts) */
const MONITOR_OFF_TOPLEFT_GID = 365;
const MONITOR_ON = [[367, 0, 0], [368, 1, 0], [383, 0, 1], [384, 1, 1]];
/* The screen interior of the 2×2 block, in local pixels. Their DeskScreen
 * carries {x:3,y:5,w:25,h:12}, which belongs to a different theme's monitor —
 * against this art it spills across the desk. Measured off office-tileset.png:
 * the monitor occupies x0..18,y8..29 of the block and its lit screen is this. */
const SCREEN_RECT = { x: 2, y: 11, w: 12, h: 7 };

function readFurniture(fb, fa) {
  propsBelow = []; propsAbove = []; screens = [];
  const scan = (grid, into) => {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const gid = GID(grid[r][c]);
      const spec = PROP[gid];
      /* the atlases draw the real thing; these are only for gids they lack */
      if (!spec || !gaps.has(gid)) continue;
      const o = { kind: spec.kind, x: c * TILE, y: r * TILE, w: spec.w * TILE, h: spec.h * TILE };
      into.push(o);
    }
  };
  scan(fb, propsBelow);
  scan(fa, propsAbove);

}

function drawProp(o) {
  const { x, y, w, h } = o;
  const ink = () => { ctx.strokeStyle = C.ink; ctx.lineWidth = 1; };
  switch (o.kind) {
    case "desk": {
      const dy = y + 14, dh = 20;
      ctx.fillStyle = C.cast; ctx.fillRect(x + 3, dy + dh - 2, w - 6, 4);
      ctx.fillStyle = C.woodLeg; ctx.fillRect(x + 4, dy + dh - 3, 4, 6); ctx.fillRect(x + w - 8, dy + dh - 3, 4, 6);
      ctx.fillStyle = C.wood; ctx.fillRect(x + 1, dy, w - 2, dh);
      ctx.fillStyle = C.woodEdge; ctx.fillRect(x + 1, dy + dh - 6, w - 2, 6);
      ink(); ctx.strokeRect(x + 1.5, dy + 0.5, w - 3, dh - 1);
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(x + 5, dy + 4, 8, 6);
      ink(); ctx.strokeRect(x + 5.5, dy + 4.5, 7, 5);
      ctx.fillStyle = "#B3372C"; ctx.fillRect(x + w - 11, dy + 5, 5, 5);
      break;
    }
    case "table":
      ctx.fillStyle = C.cast; ctx.fillRect(x + 4, y + h - 8, w - 8, 4);
      ctx.fillStyle = C.wood; ctx.fillRect(x + 2, y + 3, w - 4, h - 12);
      ctx.fillStyle = C.woodEdge; ctx.fillRect(x + 2, y + h - 14, w - 4, 4);
      ink(); ctx.strokeRect(x + 2.5, y + 3.5, w - 5, h - 13);
      break;
    case "counter":
      ctx.fillStyle = C.cast; ctx.fillRect(x + 2, y + h - 7, w - 4, 4);
      ctx.fillStyle = C.metal; ctx.fillRect(x, y + 3, w, h - 10);
      ctx.fillStyle = C.wood; ctx.fillRect(x, y + 3, w, 5);
      ctx.fillStyle = C.metalEdge; ctx.fillRect(x, y + h - 11, w, 4);
      ink(); ctx.strokeRect(x + 0.5, y + 3.5, w - 1, h - 11);
      for (let i = 1; i < w / TILE; i++) { ctx.beginPath(); ctx.moveTo(x + i * TILE + 0.5, y + 9); ctx.lineTo(x + i * TILE + 0.5, y + h - 8); ctx.stroke(); }
      ctx.fillStyle = C.stand;
      for (let i = 0; i < w / TILE; i++) ctx.fillRect(x + i * TILE + 6, y + h - 14, 5, 2);
      break;
    case "vending":
      ctx.fillStyle = C.cast; ctx.fillRect(x + 1, y + h - 6, w - 2, 4);
      ctx.fillStyle = "#2E7D52"; ctx.fillRect(x, y + 1, w, h - 7);
      ctx.fillStyle = C.screen; ctx.fillRect(x + 3, y + 5, w - 11, h - 18);
      ctx.fillStyle = "#7FBF9A"; ctx.fillRect(x + 4, y + 6, w - 13, 4);
      ctx.fillStyle = C.metalEdge; ctx.fillRect(x + w - 7, y + 6, 4, 10);
      ink(); ctx.strokeRect(x + 0.5, y + 1.5, w - 1, h - 8);
      break;
    case "plant": {
      const k = x + 8, base = y + h - 3;
      ctx.fillStyle = C.cast; ctx.fillRect(k - 7, base - 1, 14, 3);
      ctx.fillStyle = C.leaf;
      ctx.fillRect(k - 2, base - 20, 4, 12);
      ctx.fillRect(k - 8, base - 17, 6, 4); ctx.fillRect(k + 2, base - 19, 6, 4);
      ctx.fillRect(k - 6, base - 12, 5, 4); ctx.fillRect(k + 1, base - 13, 5, 4);
      ctx.fillStyle = C.leafHi; ctx.fillRect(k - 1, base - 20, 2, 5); ctx.fillRect(k + 3, base - 19, 2, 3);
      ctx.fillStyle = C.pot; ctx.fillRect(k - 6, base - 9, 12, 9);
      ctx.fillStyle = "#A85F38"; ctx.fillRect(k - 6, base - 9, 12, 3);
      ink(); ctx.strokeRect(k - 5.5, base - 8.5, 11, 8);
      break;
    }
    case "art":
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(x + 2, y + 2, w - 4, h - 8);
      ink(); ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 9);
      ctx.fillStyle = C.rugEdge; ctx.fillRect(x + 5, y + 5, w - 10, h - 15);
      ctx.fillStyle = C.leaf; ctx.fillRect(x + 5, y + h - 14, w - 10, 3);
      break;
    case "shelf": {
      ctx.fillStyle = C.cast; ctx.fillRect(x + 2, y + h - 5, w - 4, 3);
      ctx.fillStyle = C.metal; ctx.fillRect(x + 1, y + 2, w - 2, h - 6);
      ink(); ctx.strokeRect(x + 1.5, y + 2.5, w - 3, h - 7);
      const rows = Math.max(1, Math.round((h - 6) / TILE));
      for (let i = 0; i < rows; i++) {
        const ry = y + 5 + i * TILE;
        ctx.fillStyle = C.metalEdge; ctx.fillRect(x + 3, ry + 9, w - 6, 2);
        ctx.fillStyle = C.stand; ctx.fillRect(x + w / 2 - 3, ry + 3, 6, 2);
      }
      break;
    }
  }
}

/* ═══════════════ movement ═══════════════ */

const tileOf = (px, py) => ({ x: Math.floor(px / TILE), y: Math.floor(py / TILE) });

/* Walk, or stay put. This used to fall back to setting the position directly
 * when BFS found no route, which teleported people into whatever furniture the
 * caller had aimed at — the auditor standing inside the boardroom table. If the
 * goal is unreachable we walk to the nearest tile that is, and if even that
 * fails we simply do not move. */
function walkTo(p, dest) {
  p.goTo = null;          /* a fresh order cancels any pending sidestep resume */
  p.tries = 0;            /* and starts the give-way escalation over */
  const from = tileOf(p.x, p.y);
  let goal = tileOf(dest.x, dest.y);
  let path = null;
  if (grid.isWalkable(goal.x, goal.y)) {
    /* Plan around whoever is standing about — above all the analyst, who parks
     * in the middle of the floor for a whole gate. The search only knows about
     * furniture, so without this the route goes straight through her and the
     * give-way logic ends up shoving her aside every single time. */
    const marks = blockBodies(p, goal);
    path = findPath(grid, from, goal);
    unblockBodies(marks);
    /* if they are the only way through, go through and give way instead */
    if (!path) path = findPath(grid, from, goal);
  }
  if (!path) {
    const near = nearestWalkable(goal, from);
    if (!near) return;
    goal = near;
    path = findPath(grid, from, goal);
    if (!path) return;
    /* A destination just outside the walkable tile is a SIT LINE — the south
     * boardroom chairs park you 4px into the table's tile so the chair back
     * drapes over you. Keep the exact point when it is within a tile of where
     * we can walk; only a genuinely unreachable goal gets replaced. */
    const nc = { x: goal.x * TILE + TILE / 2, y: goal.y * TILE + TILE / 2 };
    if (Math.abs(dest.x - nc.x) > TILE || Math.abs(dest.y - nc.y) > TILE) {
      dest = { x: nc.x, y: goal.y * TILE + TILE - 1 };
    }
  }
  p.path = path.map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 }));
  p.path.push({ x: dest.x, y: dest.y });
  p.seated = false;
}

/* Treat everyone standing still as furniture for the length of one search.
 * Walkers are left out — they will have moved on by the time anyone gets there,
 * and the give-way rules handle them. The goal tile is never blocked: it is
 * often the very person being walked over to. */
function blockBodies(mover, goal) {
  const marks = [];
  const add = (q) => {
    if (q === mover || q.path) return;
    const t = tileOf(q.x, q.y);
    if ((t.x === goal.x && t.y === goal.y) || !solid[t.y] || solid[t.y][t.x]) return;
    solid[t.y][t.x] = true; marks.push(t);
  };
  ORDER.forEach((k) => add(people[k]));
  add(signer);
  return marks;
}

function unblockBodies(marks) { marks.forEach((t) => { solid[t.y][t.x] = false; }); }

const atHome = (p) => !p.path && Math.abs(p.x - p.home.x) < 2 && Math.abs(p.y - p.home.y) < 2;

/* the closest walkable tile to `goal`, preferring one near `from` */
function nearestWalkable(goal, from) {
  let best = null, bestD = Infinity;
  for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) {
    const x = goal.x + c, y = goal.y + r;
    if (!grid.isWalkable(x, y)) continue;
    const d = Math.abs(c) + Math.abs(r) + 0.01 * (Math.abs(x - from.x) + Math.abs(y - from.y));
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

/* Nobody may stand where somebody already is. The path grid only knows about
 * furniture, so without this two auditors heading down the same aisle slide
 * straight through each other, and a walker ends up standing in an occupied
 * chair. Everyone who is not the mover — the analyst included — is an obstacle. */
const BODY = 11;

/* Only people who are STANDING STILL take up space. Two walkers brushing past
 * each other resolves itself in half a second and reads as squeezing by; making
 * walkers yield to walkers gridlocked the boardroom door — four auditors
 * converging on one doorway all gave way to one another forever. The bugs worth
 * stopping are walking through someone seated at a desk, through the analyst
 * mid-read, or ending up standing in an occupied chair — all stationary. */
function occupied(mover, nx, ny) {
  for (let i = 0; i < ORDER.length; i++) {
    const q = people[ORDER[i]];
    if (q === mover || q.path) continue;
    if (Math.abs(q.x - nx) < BODY && Math.abs(q.y - ny) < BODY) return true;
  }
  return signer !== mover && !signer.path && Math.abs(signer.x - nx) < BODY && Math.abs(signer.y - ny) < BODY;
}

/* Held up long enough that waiting is not working: re-run the search with the
 * people on the floor treated as walls, so they go around instead of standing
 * there. The goal tile itself stays open — that is often the very person we are
 * walking over to. */
/* Where this walk is really headed: once someone has stepped aside, the end of
 * p.path is only the tile they stepped to, so the errand lives in p.goTo. */
function errand(p) { return p.goTo || p.path[p.path.length - 1]; }

function repathAround(p) {
  const dest = errand(p);
  p.goTo = null;
  const from = tileOf(p.x, p.y), goal = tileOf(dest.x, dest.y);
  const marks = blockBodies(p, goal);
  const path = grid.isWalkable(goal.x, goal.y) ? findPath(grid, from, goal) : null;
  unblockBodies(marks);
  if (!path || !path.length) return false;
  p.path = path.map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 }));
  p.path.push({ x: dest.x, y: dest.y });
  return true;
}

/* Last resort before walking through somebody: get out of the aisle. Take one
 * free tile to the side, then carry on to where you were going. This is what
 * two people actually do in a corridor, and it means nothing ever has to phase. */
function sidestep(p) {
  const t = tileOf(p.x, p.y);
  const dest = errand(p);
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < sides.length; i++) {
    const x = t.x + sides[i][0], y = t.y + sides[i][1];
    if (!grid.isWalkable(x, y)) continue;
    const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
    if (occupied(p, cx, cy)) continue;
    p.path = [{ x: cx, y: cy }];
    p.goTo = dest;
    return true;
  }
  return false;
}

function stepWalk(p, dt) {
  if (!p.path) return;
  const t = p.path[0];
  const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
  if (reduced) {                      /* their spec: walks become instant */
    const last = p.path[p.path.length - 1];
    p.x = last.x; p.y = last.y;
    p.path = null; p.seated = true;
    p.face = p.sitFace || p.homeFace || "up";
    p.sitFace = null;
    return;
  }
  const spd = dt * 0.08;   /* their spec: 80px/sec */
  const nx = d <= spd ? t.x : p.x + (dx / d) * spd;
  const ny = d <= spd ? t.y : p.y + (dy / d) * spd;
  if (occupied(p, nx, ny)) {
    /* Stand and wait rather than walk through them. The timeout is the release
     * valve: two people meeting head-on in a one-tile aisle would otherwise
     * hold each other there forever, so after a second someone gives way. */
    p.wait = (p.wait || 0) + dt;
    if (p.wait < 600) { p.step = 0; return; }
    p.wait = 0;
    p.tries = (p.tries || 0) + 1;
    if (p.tries === 1 && repathAround(p)) return;
    if (p.tries <= 3 && sidestep(p)) return;
  } else {
    p.wait = 0;
  }
  if (d <= spd) {
    p.x = t.x; p.y = t.y;
    p.path.shift();
    if (!p.path.length) {
      p.path = null;
      /* Stepped aside to let someone by — now resume the errand. The give-way
       * count deliberately carries over: it used to reset on any free step, so
       * two people could step aside for each other forever and neither ever
       * arrived. Carrying it means the standoff escalates and always resolves. */
      if (p.goTo) { const g = p.goTo, t = p.tries; p.goTo = null; walkTo(p, g); p.tries = t; return; }
      p.seated = true;
      p.face = p.sitFace || p.homeFace || "up";
      p.sitFace = null;
    }
    return;
  }
  p.x = nx; p.y = ny;
  p.step += dt;
  p.face = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "up" : "down") : (dx < 0 ? "left" : "right");
}

/* She used to read the bundle at (256,300) — the tile just inside the entrance.
 * Everyone filing findings with her queued up there too, so the doorway grew a
 * crowd. The central corridor is open the whole width of the floor and is
 * reachable from every desk. */
const READING_SPOT = { x: 16 * TILE + TILE / 2, y: 15 * TILE + TILE - 1 };

function stepSigner(now, dt) {
  /* She is always on the floor now — the corner office is hers, and people file
   * their findings there. Fading her out left the room without its point. */
  signer.alpha = 1;
  if (signer.phase === "office") { signer.face = "down"; return; }
  if (signer.phase === "coming") {
    if (!signer.path) walkTo(signer, READING_SPOT);
    stepWalk(signer, dt);
    if (!signer.path) signer.phase = "reading";
  } else if (signer.phase === "reading") {
    signer.face = "up";
  } else if (signer.phase === "signing") {
    if (now >= signer.until) signer.phase = "going";
  } else if (signer.phase === "going") {
    if (!signer.path) walkTo(signer, seatPoint(stations["desk-ceo"]));
    stepWalk(signer, dt);
    if (!signer.path) { signer.phase = "office"; signer.path = null; }
  }
}

/* At most four floating labels at once — the four most recent changes. Fifteen
 * seats all reporting "cleared" is a wall of text, not a floor you can read. */
let recentTags = [];
function refreshTags(now) {
  recentTags = ORDER
    .filter((k) => people[k].st !== "idle" && now - people[k].at < 3200)
    .sort((a, b) => people[b].at - people[a].at)
    .slice(0, 4);
}

function tick(now, dt) {
  refreshTags(now);
  ORDER.forEach((k) => { people[k].screen += dt * 0.012; stepWalk(people[k], dt); });
  stepSigner(now, dt);
  stepFiling(now);
  stepBreaks(now);
  if (chatter && now >= nextNoteAt) {
    const live = ORDER.filter((k) => BUSY.has(people[k].st) || people[k].st === "flag" || people[k].st === "flagged");
    if (live.length >= 2) {
      const a = live[(Math.random() * live.length) | 0];
      let b; do { b = live[(Math.random() * live.length) | 0]; } while (b === a);
      API.note(a, b, /flag/.test(people[a].st) ? "flag" : "claim");
    }
    nextNoteAt = now + 2400 + Math.random() * 2400;
  }
}

/* ═══════════════ drawing ═══════════════ */

/* The room never changes, so it is painted once into an offscreen canvas and
 * blitted each frame. Before this every frame repainted ~750 floor tiles, every
 * wall edge and every prop, which is what made the motion stutter. */
/* Pixel art hates being resampled. The canvas used to render at a fixed 2× and
 * let CSS squash it to whatever the column was wide — a 0.77 downscale, which
 * drops pixels unevenly and makes every 1px outline shimmer as things move.
 * Now the backing store is the size the canvas is actually displayed at, so the
 * room is drawn crisp at that scale and nothing is resampled on the way out. */
function resize() {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const shown = cv.getBoundingClientRect().width || W;
  const next = Math.max(1, Math.min(3, (shown * dpr) / W));
  if (Math.abs(next - SS) < 0.01 && staticCv) return;
  SS = next;
  cv.width = Math.round(W * SS);
  cv.height = Math.round(H * SS);
  buildStatic();
  if (ready) draw(simNow);
}

function buildStatic() {
  const real = ctx;

  staticCv = document.createElement("canvas");
  staticCv.width = cv.width; staticCv.height = cv.height;
  ctx = staticCv.getContext("2d");
  ctx.setTransform(SS, 0, 0, SS, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2B2A33";
  ctx.fillRect(0, 0, W, H);
  paintLayers(ctx, mapData, tilesets, ["floor", "walls", "furniture-below"]);
  propsBelow.forEach(drawProp);
  drawDoorway();
  drawZoneLabels();

  ctx = real;
}

function draw(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(staticCv, 0, 0);
  ctx.setTransform(SS, 0, 0, SS, 0, 0);

  /* Everything that can occlude anything else, sorted back to front: the people
   * and every furniture-above tile. A monitor north of an auditor is behind
   * them; a chair south of them is in front. Painting the layer flat on top was
   * what made heads vanish and people look like they walked through props. */
  const ents = [];
  ORDER.forEach((k) => ents.push({ y: people[k].y, draw: () => drawPerson(people[k], frames[k], now) }));
  ents.push({ y: signer.y, draw: () => drawSigner(simNow) });
  aboveTiles.forEach((t) => ents.push({ y: t.sortY, draw: () => drawRaw(ctx, mapData, tilesets, t.raw, t.x, t.y) }));
  propsAbove.forEach((o) => ents.push({ y: o.y + o.h - 2, draw: () => drawProp(o) }));
  screens.forEach((o) => ents.push({ y: o.y + 30, draw: () => drawScreen(o, now) }));
  ents.sort((a, b) => a.y - b.y);
  ents.forEach((e) => e.draw());

  drawLensTag();
  drawNotes();
  drawToasts();
  ORDER.forEach((k) => drawBubble(people[k], now));
  drawThought(now);
  drawMarker(now);
}

/* A desk PC that is switched off tells you nothing. Their DeskScreen lights the
 * lit tile variant while the agent is seated and animates scrolling lines and a
 * cursor inside the screen rect; ours does the same, and tints the glow with
 * whatever the auditor is actually doing. */
function drawScreen(o, now) {
  const seat = o.seat ? people[o.seat] : null;
  const away = seat && (!seat.seated || seat.path);
  if (away) return;                       /* nobody there — the map's dark PC shows */

  for (const [gid, dx, dy] of MONITOR_ON) {
    drawGid(ctx, mapData, tilesets, gid, (o.col + dx) * TILE, (o.row + dy) * TILE);
  }

  const R = SCREEN_RECT;
  const sx = o.x + R.x, sy = o.y + R.y;
  const st = seat ? seat.st : "idle";
  const lit = seat && simNow - seat.flash < 460;

  /* the state wash — a lit desktop that also says what this seat is doing */
  if (st !== "idle" || lit) {
    ctx.globalAlpha = lit ? 0.85 : reduced ? 0.6 : 0.5;
    ctx.fillStyle = lit ? "#FFFFFF" : (STATE_DOT[st] || "#8B8272");
    ctx.fillRect(sx, sy, R.w, R.h);
    ctx.globalAlpha = 1;
  }

  /* screen life: lines scrolling up, and a cursor that blinks */
  const t = now / 1000;
  ctx.save();
  ctx.beginPath(); ctx.rect(sx, sy, R.w, R.h); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const speed = reduced ? 0 : BUSY.has(st) ? 9 : 2.5;
  for (let i = 0; i < 4; i++) {
    const ly = sy + R.h - ((t * speed + i * 3.6 + (seat ? seat.screen : 0)) % (R.h + 4));
    const lw = 6 + ((i * 7 + o.col) % 12);
    if (ly > sy - 1 && ly < sy + R.h) ctx.fillRect(sx + 2, Math.round(ly), lw, 1);
  }
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(sx + 2, sy + R.h - 3, 3, 2);
  }
  ctx.restore();

  if (st === "flagged" || st === "blocked" || st === "flag" || st === "block") {
    ctx.strokeStyle = STATE_DOT[st]; ctx.lineWidth = 1;
    ctx.strokeRect(sx - 0.5, sy - 0.5, R.w + 1, R.h + 1);
  }
}

/* the lens of whoever is being inspected, on their desk */
function drawLensTag() {
  const p = people[selected], seat = BY_ID[selected];
  if (!p || !seat) return;
  const x = Math.round(p.home.x), y = Math.round(p.home.y);
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(seat.tag).width + 8;
  ctx.fillStyle = seat.color; ctx.fillRect(x - w / 2, y + 20, w, 9);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 - 0.5, y + 19.5, w + 1, 10);
  ctx.fillStyle = C.ink; ctx.fillText(seat.tag, x, y + 25);
}



/* The map leaves the doorway in the bottom wall untiled — their camera never
 * looks at it. Ours does, so it gets a threshold and a mat. */
function drawDoorway() {
  const e = stations["entrance"];
  if (!e) return;
  const x = Math.floor(e.x / TILE) * TILE, y = (ROWS - 1) * TILE;
  ctx.fillStyle = "#C9C2AE"; ctx.fillRect(x - TILE, y, TILE * 3, TILE);
  ctx.fillStyle = "#8E8878"; ctx.fillRect(x - TILE, y, TILE * 3, 3);
  ctx.fillStyle = "#A8A08C"; ctx.fillRect(x - 6, y + 5, 28, 8);
  ctx.strokeStyle = "#6C6656"; ctx.lineWidth = 1; ctx.strokeRect(x - 5.5, y + 5.5, 27, 7);
}

/* A room label belongs on the room's floor, not on its back wall — over the
 * wall it covers the boardroom's two windows, which is the one thing that tells
 * you it is the good room. Each label goes on the clear strip of floor inside
 * its own room. */
function drawZoneLabels() {
  const b = zones.boardroom, c = zones.cafeteria, e = stations["entrance"];
  const vp = stations["desk-ceo"];
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (b) roomLabel("BOARDROOM", b.x + b.width / 2, b.y + b.height - 10);
  if (c) roomLabel("CAFETERIA", c.x + c.width / 2, c.y + 6);
  if (e) roomLabel("ENTRANCE", e.x, e.y - 10);
  if (vp) roomLabel("VP", vp.x + 40, vp.y + 54);
}

/* their RoomLabel: a plank with an ink outline, not floating text */
function roomLabel(text, x, y) {
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "#F4EEDC"; ctx.fillRect(x - w / 2, y - 6, w, 12);
  ctx.strokeStyle = "#1E1A14"; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - 5.5, w - 1, 11);
  ctx.fillStyle = "#5A5142"; ctx.fillText(text, x, y);
}

function chair(x, y) {
  ctx.fillStyle = C.cast; ctx.fillRect(x - 6, y + 4, 12, 3);
  ctx.fillStyle = C.chair; ctx.fillRect(x - 7, y - 5, 14, 10);
  ctx.fillStyle = C.chairHi; ctx.fillRect(x - 5, y - 3, 10, 3);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x - 6.5, y - 4.5, 13, 9);
}


/* A 32px character on a 16px chair hides the chair completely, so sitting down
 * looked identical to standing on it. Two things fix it: lift them onto the
 * seat, then repaint the front of the seat tile over their legs, so the chair
 * closes around them the way it does in the source art. */
const SIT_LIFT = 3;
const SEAT_FRONT = 7;

function seatFront(p) {
  if (!fbRaw) return;
  const t = tileOf(p.x, p.y);
  const raw = fbRaw[t.y * COLS + t.x];
  if (!raw) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x * TILE, t.y * TILE + SEAT_FRONT, TILE, TILE - SEAT_FRONT);
  ctx.clip();
  drawRaw(ctx, mapData, tilesets, raw, t.x * TILE, t.y * TILE);
  ctx.restore();
}

function drawPerson(p, fr, now) {
  const walking = !!p.path;
  const sitting = p.seated && !walking;
  const phase = walking ? [0, 1, 0, 2][Math.floor(p.step / 125) % 4] : 0;
  const img = (p.face === "up" ? fr.back : fr.front)[phase];
  const bob = walking && !reduced ? Math.round(Math.sin(p.step / 1000 * 8 * Math.PI)) : 0;
  const x = Math.round(p.x), y = Math.round(p.y) + bob - (sitting ? SIT_LIFT : 0);

  /* No drawn chair back: every seat in this map already has one in the art, so
   * ours only boxed people in — worst of all around the boardroom table. */
  /* and no floor shadow while sitting — the chair is holding them up */
  if (!sitting) { ctx.fillStyle = "rgba(30,26,20,0.16)"; ctx.fillRect(x - 6, y - 2, 12, 3); }
  ctx.save();
  if (p.face === "left") { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
  if (sitting && p.face === "down") { ctx.beginPath(); ctx.rect(x - 10, y - SCENE_H, 20, SCENE_H - 9); ctx.clip(); }
  ctx.drawImage(img, x - 9, y - SCENE_H);
  ctx.restore();
  /* sitBehind seats already have their chair painted over the sitter by the
   * depth sort, so a second copy would only draw it twice */
  if (sitting && !p.sitBehind) seatFront(p);

  const stuck = p.st === "block" || p.st === "blocked" || p.dissent;
  if (p.carry) drawFolder(x - 4, y - 15, p.st);
  if (p.cup) drawMug(x + (p.face === "left" ? -12 : 10), y - 13);
  const worth = stuck || p.id === selected || recentTags.indexOf(p.id) !== -1;
  if (worth && p.st !== "idle" && !p.bubble) {
    statusTag(x, y - SCENE_H - 3 - (ORDER.indexOf(p.id) % 2) * 13,
      p.dissent ? "dissent" : STATE_TAG[p.st], p.dissent ? "#8A6200" : STATE_DOT[p.st]);
  }
}

function statusTag(x, y, text, color) {
  if (!text) return;
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 13;
  const bx = clampX(x, w), by = Math.round(y - 11);
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(bx, by, w, 11);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, 10);
  ctx.fillStyle = color; ctx.fillRect(bx + 3, by + 4, 4, 4);
  ctx.fillStyle = C.ink; ctx.fillText(text, bx + 10, by + 6);
  ctx.textAlign = "center";
}

function drawSigner(now) {
  const walking = !!signer.path;
  const phase = walking ? [0, 1, 0, 2][Math.floor(signer.step / 125) % 4] : 0;
  const img = (signer.face === "up" ? signerFrames.back : signerFrames.front)[phase];
  const sitting = signer.phase === "office";
  const x = Math.round(signer.x), y = Math.round(signer.y) - (sitting ? SIT_LIFT : 0);
  ctx.save();
  ctx.globalAlpha = signer.alpha;
  if (!sitting) { ctx.fillStyle = "rgba(30,26,20,0.16)"; ctx.fillRect(x - 6, y - 2, 12, 3); }
  if (signer.face === "left") { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
  /* at her desk she is sitting at it, so her legs are behind it like everyone else */
  if (sitting) { ctx.beginPath(); ctx.rect(x - 10, y - SCENE_H, 20, SCENE_H - 9); ctx.clip(); }
  ctx.drawImage(img, x - 9, y - SCENE_H);
  ctx.restore();
  if (sitting) seatFront(signer);
  if (now < vpStampUntil) statusTag(x, y - SCENE_H - 4, "filed", "#246B45");
  /* the bundle in her hands — their paper token, carried until it is signed */
  if (signer.phase !== "office") {
    const bx = x - 4, by = y - 15;
    ctx.globalAlpha = signer.alpha;
    ctx.fillStyle = "#FFFDF5"; ctx.fillRect(bx, by, 8, 6);
    ctx.fillStyle = signer.phase === "signing" ? "#246B45" : "#8B8272";
    ctx.fillRect(bx + 1, by + 1, 6, 1); ctx.fillRect(bx + 1, by + 3, 4, 1);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, 7, 5);
    ctx.globalAlpha = 1;
  }
  if (signer.phase === "reading" || signer.phase === "signing") {
    thoughtCloud(x, y - SCENE_H - 6, signer.phase === "signing" ? "signing" : "reading the bundle");
  }
}

function drawNotes() {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.t += 0.016;
    if (n.t >= 1) { notes.splice(i, 1); continue; }
    const a = { x: n.from.x, y: n.from.y - 20 }, b = { x: n.to.x, y: n.to.y - 20 };
    const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 26 };
    const u = 1 - n.t;
    const px = u * u * a.x + 2 * u * n.t * mid.x + n.t * n.t * b.x;
    const py = u * u * a.y + 2 * u * n.t * mid.y + n.t * n.t * b.y;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(px - 5, py - 4, 10, 8);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(px - 4.5, py - 3.5, 9, 7);
    ctx.strokeStyle = n.kind === "flag" ? "#B3372C" : "#246B45";
    ctx.beginPath(); ctx.moveTo(px - 4, py - 3); ctx.lineTo(px, py); ctx.lineTo(px + 4, py - 3); ctx.stroke();
  }
}

function drawToasts() {
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    t.t += 16;
    if (t.t > 2400) { toasts.splice(i, 1); continue; }
    ctx.globalAlpha = t.t < 250 ? t.t / 250 : t.t > 2000 ? (2400 - t.t) / 400 : 1;
    bubbleBox(t.x, t.y - t.t * 0.005, [t.text], { radius: 4, fill: "#FFFDF5", text: "#246B45" });
    ctx.globalAlpha = 1;
  }
}

/* their fade state machine: 0.15s in, 0.3s out, so nothing pops */
function bubbleAlpha(now, from, until) {
  const inT = Math.min((now - from) / 150, 1);
  const outT = Math.min(Math.max(until - now, 0) / 300, 1);
  return Math.max(0, Math.min(inT, outT));
}

function drawBubble(p, now) {
  if (p.tool && now < p.toolUntil) {
    ctx.globalAlpha = bubbleAlpha(now, p.toolUntil - 2600, p.toolUntil);
    /* the inspected seat says what it is touching; the rest just show the icon,
     * which is enough to see the floor working without reading fifteen labels */
    if (p.id === selected) toolBubble(p.x, p.y - SCENE_H - 4, p.tool);
    else toolChip(p.x, p.y - SCENE_H - 4, p.tool.charAt(0));
    ctx.globalAlpha = 1;
  } else if (p.tool) p.tool = null;

  if (!p.bubble || now >= p.bubbleUntil) { p.bubble = null; return; }
  /* Only the auditor you are inspecting is quoted. Everyone else murmurs, so
   * you can see the floor is arguing without having to read four boxes at once
   * — click one and it starts talking to you. */
  ctx.globalAlpha = bubbleAlpha(now, p.bubbleAt, p.bubbleUntil);
  if (p.id === selected) speechBubble(p.x, p.y - SCENE_H - 6 - (p.tool ? 16 : 0), p.bubble);
  else murmur(p.x, p.y - SCENE_H - 4, now);
  ctx.globalAlpha = 1;
}

/* the findings, in hand: a sheet with a coloured band for the verdict it carries */
function drawFolder(x, y, st) {
  ctx.fillStyle = "#FFFDF5"; ctx.fillRect(x, y, 8, 6);
  ctx.fillStyle = STATE_DOT[st] || "#8B8272";
  ctx.fillRect(x + 1, y + 1, 6, 1); ctx.fillRect(x + 1, y + 3, 4, 1);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 7, 5);
}

/* a mug: white body, dark rim, little handle — 5px of storytelling */
function drawMug(x, y) {
  ctx.fillStyle = "#FFFDF5"; ctx.fillRect(x, y, 5, 6);
  ctx.fillStyle = "#6B4A32"; ctx.fillRect(x, y, 5, 2);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 4, 5);
  ctx.fillStyle = C.ink; ctx.fillRect(x + 5, y + 2, 1, 2);
}

/* What the inspected auditor is doing, as their thought cloud. With no note to
 * show, a thinking seat cycles their dots rather than showing an empty cloud. */
function drawThought(now) {
  const p = people[selected];
  if (!p || p.bubble || p.tool || p.st === "idle") return;
  const text = p.note || [".", "..", "..."][Math.floor(now / 450) % 3];
  thoughtCloud(p.x, p.y - SCENE_H - 12, text);
}

/* Their floor has two different bubbles and they mean different things
 * (ThoughtBubble.ts / ToolBubble.ts):
 *
 *   a light cream CLOUD with two trailing puffs = what this agent is doing
 *   a dark near-opaque SPEECH bubble            = what it just said
 *
 * Both are round-cornered, 1px ink outline, word-wrapped, and clamped to stay
 * inside the room. Their constants: padding 6×3, radius 5 / 4, cream-50 fill on
 * the cloud with ink-700 text, ink-900 at 0.95 on the speech bubble with
 * cream-50 text. */
/* ToolBubble.ts's icon map, verbatim. A tool bubble reads "<icon> <target>" —
 * "$ SQL + reducer", "< brief.md ¶14" — which is a different fact from what the
 * seat is thinking, so it gets its own bubble. */
const TOOL_ICONS = {
  Read: "<", Edit: ">", Write: ">", Bash: "$", Grep: "?", Glob: "?",
  WebFetch: "@", WebSearch: "@", TodoWrite: "=", MCP: "*",
};
const TOOL_DEFAULT = "*";

const BUBBLE_FONT = "11px 'Pixelify Sans', 'Press Start 2P', monospace";

function bubbleBox(x, y, lines, opts) {
  ctx.font = BUBBLE_FONT;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  let tw = 0;
  lines.forEach((l) => { tw = Math.max(tw, ctx.measureText(l).width); });
  const w = Math.round(tw + 12);
  const h = lines.length * 12 + 6;
  const bx = clampX(x, w);
  const by = Math.round(Math.max(2, y - h));
  ctx.beginPath();
  ctx.roundRect(bx + 0.5, by + 0.5, w - 1, h - 1, opts.radius);
  ctx.fillStyle = opts.fill;
  ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = opts.text;
  lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 9 + i * 12));
  return { bx, by, w, h };
}

/* a comic thought cloud: the box, then two shrinking puffs trailing toward the
 * head below — their cue for "thinking" rather than "speaking" */
function thoughtCloud(x, y, text) {
  const box = bubbleBox(x, y, wrap(String(text), 22), {
    radius: 5, fill: "#FFFDF5", text: "#3D2E4A",
  });
  const px = box.bx + box.w * 0.32;
  const puff = (cx, cy, r) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFDF5"; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  };
  puff(px, box.by + box.h + 4, 3);
  puff(px - 5, box.by + box.h + 9, 2);
}

/* the tool bubble: same dark shell, but the icon is kept hard against the left
 * so a column of them reads as a column */
function toolBubble(x, y, text) {
  const box = bubbleBox(x, y, [String(text).slice(0, 26)], {
    radius: 4, fill: "#1A1320", alpha: 0.95, text: "#A8E6E0",
  });
  return box;
}

/* Someone is talking, but not the one you are reading: a small cloud with three
 * cycling dots. Presence without another wall of text. */
function murmur(x, y, now) {
  const w = 17, h = 10;
  const bx = Math.round(clampX(x, w)), by = Math.round(y - h);
  ctx.beginPath();
  ctx.roundRect(bx + 0.5, by + 0.5, w - 1, h - 1, 4);
  ctx.fillStyle = "#FFFDF5"; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  const lit = Math.floor(now / 260) % 3;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i <= lit ? "#3D2E4A" : "#CFC8B4";
    ctx.fillRect(bx + 4 + i * 4, by + 4, 2, 2);
  }
  ctx.beginPath();
  ctx.moveTo(bx + 5, by + h - 1); ctx.lineTo(bx + 10, by + h - 1); ctx.lineTo(bx + 6, by + h + 4);
  ctx.closePath();
  ctx.fillStyle = "#FFFDF5"; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.stroke();
}

/* one glyph in the tool bubble's shell: "this seat is running something" */
function toolChip(x, y, icon) {
  const w = 12, h = 12;
  const bx = Math.round(clampX(x, w)), by = Math.round(y - h);
  ctx.beginPath();
  ctx.roundRect(bx + 0.5, by + 0.5, w - 1, h - 1, 4);
  ctx.fillStyle = "#1A1320"; ctx.globalAlpha *= 0.95; ctx.fill(); ctx.globalAlpha /= 0.95;
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = BUBBLE_FONT;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#A8E6E0";
  ctx.fillText(icon, bx + w / 2, by + h / 2 + 1);
  ctx.textAlign = "left";
}

function speechBubble(x, y, text) {
  const box = bubbleBox(x, y, wrap(String(text), 24), {
    radius: 4, fill: "#1A1320", alpha: 0.95, text: "#FFFDF5",
  });
  /* a small tail so it reads as speech and points at who said it */
  const tx = Math.max(box.bx + 4, Math.min(box.bx + box.w - 10, x - 3));
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#1A1320";
  ctx.beginPath();
  ctx.moveTo(tx, box.by + box.h - 1);
  ctx.lineTo(tx + 6, box.by + box.h - 1);
  ctx.lineTo(tx + 2, box.by + box.h + 5);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > max && line) { out.push(line); line = word; }
    else line = next;
  }
  if (line) out.push(line);
  if (out.length > 3) { out.length = 3; out[2] = out[2].slice(0, max - 1) + "…"; }
  return out;
}

/* keep a label inside the room — a tag half off the canvas reads as a smear */
function clampX(x, w) { return Math.round(Math.max(2, Math.min(W - w - 2, x - w / 2))); }

function label(text, x, y) {
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = C.soft;
  ctx.fillText(text, x, y);
}

function drawMarker(now) {
  const p = people[selected];
  if (!p) return;
  /* their glowColor: a soft pool of the seat's own lens colour under whoever is
   * being inspected, so the marker is not the only thing tying them together */
  const seat = BY_ID[selected];
  if (seat) {
    const g = ctx.createRadialGradient(p.x, p.y - 2, 1, p.x, p.y - 2, 16);
    g.addColorStop(0, seat.color + "cc");
    g.addColorStop(1, seat.color + "00");
    ctx.fillStyle = g;
    ctx.fillRect(p.x - 16, p.y - 12, 32, 20);
  }
  const bob = Math.floor(now / 320) % 2;
  const x = Math.round(p.x), y = Math.round(p.y) - SCENE_H - 12 - bob;
  ctx.fillStyle = "#F6C94B";
  ctx.beginPath();
  ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke();
}

/* ═══════════════ loop + input ═══════════════ */

function frame(ts) {
  if (!running) { last = 0; return; }
  const dt = last ? Math.min(ts - last, 50) : 16;
  last = ts; simNow = ts;
  tick(ts, dt);
  draw(ts);
  rafId = requestAnimationFrame(frame);
}

function hitTest(e) {
  const r = cv.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (W / r.width);
  const my = (e.clientY - r.top) * (H / r.height);
  let best = null, bestD = 1e9;
  ORDER.forEach((k) => {
    const p = people[k];
    const m = Math.min(Math.hypot(mx - p.x, my - (p.y - 12)), Math.hypot(mx - p.home.x, my - p.home.y));
    if (m < 22 && m < bestD) { best = k; bestD = m; }
  });
  if (best) API.select(best);
}
