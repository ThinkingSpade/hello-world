/* ============================================================
   Huy Nguyen — retro interactions
   - pixelated custom cursor + pop-in targeting reticle
   - emoji burst on highlight hover
   - nav backdrop on scroll
   ============================================================ */

(function () {
  "use strict";

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine   = matchMedia("(pointer: fine)").matches;

  /* ---------- nav backdrop ---------- */
  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", scrollY > 20);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- pixel cursor ---------- */
  if (fine) initCursor();

  // build a crisp pixel-art arrow by rasterising a polygon onto a grid
  function pixelArrowSVG() {
    const W = 12, H = 18, S = 2.4;
    const poly = [[0,0],[0,16],[4,12],[6,17],[8,16],[6,11],[11,11]];
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    const fillGrid = [], outGrid = [];
    for (let y = 0; y < H; y++) {
      fillGrid[y] = [];
      for (let x = 0; x < W; x++) fillGrid[y][x] = inside(x + 0.5, y + 0.5) ? 1 : 0;
    }
    for (let y = 0; y < H; y++) {
      outGrid[y] = [];
      for (let x = 0; x < W; x++) {
        if (fillGrid[y][x]) { outGrid[y][x] = 0; continue; }
        let near = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W && fillGrid[ny][nx]) near = true;
          }
        outGrid[y][x] = near ? 1 : 0;
      }
    }
    let rects = "";
    const px = (x, y, c) => `<rect x="${x}" y="${y}" width="1.03" height="1.03" fill="${c}"/>`;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (outGrid[y][x])  rects += px(x, y, "#fff");
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fillGrid[y][x]) rects += px(x, y, "#1c1a17");
    return `<svg width="${W * S}" height="${H * S}" viewBox="-1 -1 ${W + 1} ${H + 1}" shape-rendering="crispEdges">${rects}</svg>`;
  }

  // pixel targeting reticle (four corner brackets)
  function reticleSVG() {
    const r = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    return `<svg width="42" height="42" viewBox="0 0 16 16" shape-rendering="crispEdges" fill="currentColor">
      ${r(0,0,5,2)}${r(0,0,2,5)} ${r(11,0,5,2)}${r(14,0,2,5)}
      ${r(0,14,5,2)}${r(0,11,2,5)} ${r(11,14,5,2)}${r(14,11,2,5)}</svg>`;
  }

  function initCursor() {
    document.body.classList.add("cursor-on");

    const cur = document.createElement("div");
    cur.className = "cursor"; cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = pixelArrowSVG();

    const ring = document.createElement("div");
    ring.className = "cursor-ring"; ring.setAttribute("aria-hidden", "true");
    ring.innerHTML = "<i>" + reticleSVG() + "</i>";

    document.body.append(cur, ring);

    const SEL = 'a, button, .hl, .term, .exp-logo, .btn, .social, .logo, [data-cursor]';
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my, lastHit = null;
    const k = reduce ? 1 : 0.22;

    addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      cur.style.opacity = ring.style.opacity = "1";
      const hit = e.target.closest ? e.target.closest(SEL) : null;
      if (hit !== lastHit) {
        lastHit = hit;
        ring.classList.toggle("show", !!hit);
        const accent = hit ? getComputedStyle(hit).getPropertyValue("--cur").trim() : "";
        if (accent) ring.style.setProperty("--cur-accent", accent);
        else ring.style.removeProperty("--cur-accent");
      }
    }, { passive: true });

    addEventListener("mousedown", () => cur.classList.add("down"));
    addEventListener("mouseup",   () => cur.classList.remove("down"));
    document.addEventListener("mouseleave", () => { cur.style.opacity = ring.style.opacity = "0"; });

    (function loop() {
      rx += (mx - rx) * k; ry += (my - ry) * k;
      cur.style.transform  = `translate3d(${mx}px, ${my}px, 0)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- per-highlight hover effects (custom SVG art) ---------- */
  const INK = "#1c1a17";
  const fills = ["var(--coral-bg)", "var(--blue-bg)", "var(--gold-bg)", "var(--green-bg)", "var(--violet-bg)", "var(--peach-bg)"];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // every icon is hand-drawn (32-grid) to match the site: ink outline, flat
  // pastel fills, plus inner detail lines / highlights for a richer illustration
  const wrap = (inner) =>
    `<svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;
  const ICON = {
    star:   (c) => wrap(`<path d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z" fill="${c}"/><circle cx="16" cy="16" r="2.2" fill="#fff"/>`),
    badge:  (c) => wrap(`<path d="M16 2.5 L19.6 11.4 L29.5 12.2 L22 18.6 L24.3 28.2 L16 23 L7.7 28.2 L10 18.6 L2.5 12.2 L12.4 11.4 Z" fill="${c}"/><circle cx="16" cy="15.5" r="2.4" fill="#fff"/>`),
    dot:    (c) => wrap(`<circle cx="16" cy="16" r="10" fill="${c}"/><path d="M10.5 12.5 A6.5 6.5 0 0 1 16 9.5" stroke="#fff" stroke-width="2.2" fill="none"/>`),
    square: (c) => wrap(`<rect x="5.5" y="5.5" width="21" height="21" rx="5" fill="${c}"/><rect x="9.5" y="9.5" width="6.5" height="6.5" rx="2" fill="#fff" stroke="none"/>`),
    tri:    (c) => wrap(`<path d="M16 4 L28 26 L4 26 Z" fill="${c}"/><circle cx="16" cy="20.5" r="2" fill="#fff" stroke="none"/>`),
    bolt:   (c) => wrap(`<path d="M19 3 L7 17.5 H14.5 L12 29 L25.5 13 H17 Z" fill="${c}"/><path d="M17.5 7.5 L11.5 15 H15.5" stroke="#fff" stroke-width="1.6" fill="none"/>`),
    robot:  (c) => wrap(`<path d="M16 3 V6.5"/><circle cx="16" cy="2.4" r="2" fill="var(--coral-bg)"/><rect x="6" y="6.5" width="20" height="16" rx="4.5" fill="${c}"/><rect x="9.5" y="10" width="13" height="9" rx="2.2" fill="#fff"/><circle cx="13" cy="14.5" r="1.9" fill="${INK}"/><circle cx="19" cy="14.5" r="1.9" fill="${INK}"/><path d="M13 17.6 Q16 19.2 19 17.6" stroke-width="1.5"/><rect x="3.3" y="12" width="2.7" height="6" rx="1.2" fill="var(--gold-bg)"/><rect x="26" y="12" width="2.7" height="6" rx="1.2" fill="var(--gold-bg)"/><path d="M12.5 22.5 V25 M19.5 22.5 V25" stroke-width="2"/><rect x="9" y="25" width="14" height="5.5" rx="2.2" fill="${c}"/><circle cx="16" cy="27.7" r="1.4" fill="var(--coral-bg)"/>`),
    rocket: () => wrap(`<path d="M16 2 C22 7 23.5 15 22.4 21 L9.6 21 C8.5 15 10 7 16 2 Z" fill="#fff"/><path d="M16 2 C19.4 4.6 20.9 8.6 21.3 12 L10.7 12 C11.1 8.6 12.6 4.6 16 2 Z" fill="var(--coral-bg)"/><circle cx="16" cy="13.5" r="3.3" fill="var(--blue-bg)"/><path d="M13.8 11.8 A3.3 3.3 0 0 1 16.8 11.1" stroke="#fff" stroke-width="1.4" fill="none"/><path d="M9.8 17.6 H22.2" stroke-width="1.4"/><path d="M9.6 16.5 L4 24 L9.8 21.4 Z" fill="var(--coral-bg)"/><path d="M22.4 16.5 L28 24 L22.2 21.4 Z" fill="var(--coral-bg)"/><rect x="11.3" y="21" width="9.4" height="3.2" rx="1.2" fill="var(--gold-bg)"/><path d="M12.8 24.2 Q16 32 19.2 24.2 Z" fill="var(--gold-bg)"/><path d="M14.2 24.2 Q16 29.6 17.8 24.2 Z" fill="var(--peach-bg)"/><circle cx="10.5" cy="28" r="1.1" fill="var(--gold-bg)"/><circle cx="21.5" cy="28" r="1.1" fill="var(--gold-bg)"/>`),
    bulb:   (c) => wrap(`<path d="M16 3.5 A8 8 0 0 1 21 18.5 L11 18.5 A8 8 0 0 1 16 3.5 Z" fill="${c}"/><path d="M12.8 12.5 L14.7 15.5 L16 12 L17.3 15.5 L19.2 12.5" stroke-width="1.4" fill="none"/><path d="M11.5 18.5 H20.5 M12.5 21.5 H19.5" stroke-width="1.9"/><path d="M14.3 24.3 H17.7" stroke-width="1.9"/><path d="M16 1 V2.6 M6.8 6.8 L8 8 M25.2 6.8 L24 8 M4.5 14.5 H6.2 M25.8 14.5 H27.5" stroke-width="1.5"/>`),
    cap:    (c) => wrap(`<path d="M16 6 L29.5 11 L16 16 L2.5 11 Z" fill="${c}"/><path d="M16 8.7 L23.4 11.4 L16 14.1 L8.6 11.4 Z" stroke="#fff" stroke-width="1.2" fill="none"/><circle cx="16" cy="11" r="1.3" fill="${INK}"/><path d="M8 13 V18 C8 21 24 21 24 18 V13" fill="${c}"/><path d="M29.5 11 V19.3" stroke-width="1.9"/><path d="M27.9 19.8 L29.5 24.2 L31.1 19.8 Z" fill="var(--gold-bg)"/><circle cx="29.5" cy="19.1" r="1.3" fill="var(--gold-bg)"/>`),
    book:   (c) => wrap(`<path d="M8 5 H23 A2 2 0 0 1 25 7 V27 H10 A2 2 0 0 1 8 25 Z" fill="${c}"/><path d="M12 5 V25" stroke-width="1.6"/><path d="M8 25 A2 2 0 0 1 10 23 H25" stroke-width="1.5" fill="none"/><path d="M15 11 H21 M15 14.5 H21 M15 18 H19" stroke-width="1.5"/><path d="M20 5 V14 L18 12 L16 14 V5 Z" fill="var(--coral-bg)"/>`),
    chart:  (c) => wrap(`<path d="M6 5 V26 H28" stroke-width="2.2"/><rect x="9" y="18" width="4.5" height="8" fill="${c}"/><rect x="15.5" y="13" width="4.5" height="13" fill="${c}"/><rect x="22" y="8" width="4.5" height="18" fill="${c}"/><path d="M9 16 L17 11 L24.5 6" stroke-width="1.4" stroke-dasharray="2.4 2.4"/><circle cx="24.5" cy="6" r="1.5" fill="var(--coral-bg)"/>`),
    arrow:  () => wrap(`<path d="M5 22 L13 14 L18 19 L27 9" stroke-width="2.4"/><path d="M20 9 H27 V16" stroke-width="2.4"/>`)
  };

  // spawn one particle (SVG art, styled box, or pixel glyph); auto-removes when done
  function mk(cls, o) {
    const e = document.createElement("span");
    e.className = "fx " + cls;
    if (o.svg) { e.classList.add("fx-svg"); e.style.width = o.size + "px"; e.style.height = o.size + "px"; e.innerHTML = o.svg; }
    else { if (o.text != null) e.textContent = o.text; if (o.size) e.style.fontSize = o.size + "px"; }
    e.style.left = o.x + "px";
    e.style.top = o.y + "px";
    if (o.w) e.style.width = o.w + "px";
    if (o.h) e.style.height = o.h + "px";
    if (o.bg) e.style.background = o.bg;
    if (o.color) e.style.color = o.color;
    if (o.dur) e.style.animationDuration = o.dur + "s";
    if (o.delay) e.style.animationDelay = o.delay + "s";
    for (const k in (o.vars || {})) e.style.setProperty(k, o.vars[k]);
    document.body.appendChild(e);
    const kill = () => e.remove();
    e.addEventListener("animationend", kill);
    setTimeout(kill, ((o.delay || 0) + (o.dur || 1.3) + 0.4) * 1000); // safety net
    return e;
  }

  // distances scale to the viewport so each burst sweeps across the whole page
  const VW = () => window.innerWidth, VH = () => window.innerHeight;

  const FX = {
    // celebratory confetti: pieces + drawn shapes erupt and rain across the page
    confetti(r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, vw = VW(), vh = VH();
      const shapes = ["square", "dot", "tri", "star", "badge"];
      for (let i = 0; i < 30; i++) {
        const c = pick(fills);
        const base = {
          x: cx + rand(-r.width / 2, r.width / 2), y: cy, dur: rand(1.4, 2.2),
          vars: { "--dx": rand(-vw * 0.45, vw * 0.45).toFixed(0) + "px", "--up": rand(-vh * 0.42, -vh * 0.12).toFixed(0) + "px",
                  "--fall": rand(vh * 0.4, vh * 0.8).toFixed(0) + "px", "--spin": (rand(-720, 720) | 0) + "deg" }
        };
        if (i % 4 === 0) mk("fx-toss fx-piece", { ...base, w: rand(8, 13), h: rand(11, 18), bg: c });
        else mk("fx-toss", { ...base, size: rand(17, 27), svg: ICON[pick(shapes)](c) });
      }
    },
    // bar chart shoots up + trend arrows fly off across the page
    bars(r) {
      const n = 9, vw = VW(), vh = VH();
      for (let i = 0; i < n; i++) {
        const h = rand(30, 120);
        mk("fx-bar", { x: r.left + (i + .5) / n * r.width, y: r.bottom - h, w: rand(8, 13), h,
          bg: i % 2 ? "var(--blue-tx)" : "var(--blue-bg)", dur: rand(.9, 1.3), delay: i * .05 });
      }
      for (let i = 0; i < 6; i++)
        mk("fx-spark", { svg: ICON.arrow(), x: r.left + rand(0, r.width), y: r.top, size: rand(22, 32),
          dur: rand(1.1, 1.7), vars: { "--dx": rand(vw * 0.08, vw * 0.34).toFixed(0) + "px", "--dy": rand(-vh * 0.34, -vh * 0.1).toFixed(0) + "px", "--r": "0deg" } });
    },
    // electric zap of robots / bolts / stars radiating out across the page
    sparks(r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, reach = Math.min(VW(), VH());
      const kinds = [() => ICON.robot(pick(fills)), () => ICON.bolt("var(--gold-bg)"), () => ICON.star(pick(fills)), () => ICON.dot(pick(fills))];
      for (let i = 0; i < 18; i++) {
        const a = rand(0, Math.PI * 2), d = rand(reach * 0.12, reach * 0.46);
        mk("fx-spark", { svg: pick(kinds)(), x: cx, y: cy, size: rand(20, 32), dur: rand(.9, 1.5),
          vars: { "--dx": (Math.cos(a) * d).toFixed(0) + "px", "--dy": (Math.sin(a) * d).toFixed(0) + "px", "--r": (rand(-120, 120) | 0) + "deg" } });
      }
    },
    // rocket(s) blast up and off the top of the page with a drawn exhaust trail
    rocket(r) {
      const cx = r.left + r.width / 2, baseY = r.bottom, vw = VW(), vh = VH();
      mk("fx-spark", { svg: ICON.badge("var(--gold-bg)"), x: cx, y: r.top, size: 26, dur: 1, vars: { "--dx": "0px", "--dy": (-vh * 0.12).toFixed(0) + "px", "--r": "0deg" } });
      for (let s = 0; s < 3; s++) {
        const x = cx + rand(-vw * 0.14, vw * 0.14);
        mk("fx-rocket", { svg: ICON.rocket(), x, y: baseY, size: rand(28, 42), dur: rand(1.2, 1.7),
          vars: { "--dx": rand(-vw * 0.05, vw * 0.05).toFixed(0) + "px", "--up": (-rand(vh * 0.7, vh * 1.05)).toFixed(0) + "px", "--rot": (rand(-12, 12) | 0) + "deg" } });
        for (let t = 0; t < 7; t++)
          mk("fx-puff", { svg: (t % 2 ? ICON.dot("var(--peach-bg)") : ICON.star("var(--gold-bg)")), x: x + rand(-10, 10), y: baseY - t * 10,
            size: rand(11, 18), dur: rand(.6, .95), delay: t * .06, vars: { "--rise": (-rand(vh * 0.06, vh * 0.2)).toFixed(0) + "px" } });
      }
    },
    // idea pulse: big expanding rings + bulbs / stars flung across the page
    pulse(r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, reach = Math.min(VW(), VH());
      const kinds = [() => ICON.bulb("var(--gold-bg)"), () => ICON.star(pick(fills)), () => ICON.robot("var(--violet-bg)")];
      for (let i = 0; i < 3; i++) mk("fx-ring", { x: cx, y: cy, w: 30, h: 30, dur: rand(1.0, 1.5), delay: i * .16, vars: { "--c": "var(--violet-tx)", "--s": rand(8, 16).toFixed(1) } });
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), d = rand(reach * 0.1, reach * 0.4);
        mk("fx-spark", { svg: pick(kinds)(), x: cx, y: cy, size: rand(19, 28), dur: rand(.85, 1.4),
          vars: { "--dx": (Math.cos(a) * d).toFixed(0) + "px", "--dy": (Math.sin(a) * d).toFixed(0) + "px", "--r": "0deg" } });
      }
    },
    // graduation-cap toss: caps + books fountain high and rain across the page
    caps(r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, vw = VW(), vh = VH();
      for (let i = 0; i < 16; i++)
        mk("fx-toss", { svg: (i % 3 ? ICON.cap("var(--violet-bg)") : ICON.book("var(--peach-bg)")),
          x: cx + rand(-r.width / 3, r.width / 3), y: cy, size: rand(22, 34), dur: rand(1.3, 2.0),
          vars: { "--dx": rand(-vw * 0.34, vw * 0.34).toFixed(0) + "px", "--up": rand(-vh * 0.46, -vh * 0.2).toFixed(0) + "px",
                  "--fall": rand(vh * 0.35, vh * 0.72).toFixed(0) + "px", "--spin": (rand(-720, 720) | 0) + "deg" } });
    },
    // binary / matrix rain: pixel 0s & 1s + chart blocks raining down the page
    binary(r) {
      const cx = r.left + r.width / 2, vw = VW(), vh = VH();
      for (let i = 0; i < 26; i++) {
        const block = i % 6 === 5;
        const base = { x: cx + rand(-vw * 0.2, vw * 0.2), y: r.top - rand(0, 40), dur: rand(1.1, 2.0),
          delay: rand(0, .35), vars: { "--dx": rand(-vw * 0.05, vw * 0.05).toFixed(0) + "px", "--fall": rand(vh * 0.4, vh * 0.82).toFixed(0) + "px" } };
        if (block) mk("fx-bin", { ...base, svg: ICON.chart("var(--blue-bg)"), size: 22 });
        else mk("fx-bin", { ...base, text: Math.random() < .5 ? "0" : "1", size: rand(14, 22), color: "var(--blue-tx)" });
      }
    }
  };

  document.querySelectorAll("[data-fx]").forEach((el) => {
    let last = 0;
    const fire = () => {
      const now = performance.now();
      if (now - last < 240) return;
      last = now;
      if (reduce) return;
      (FX[el.dataset.fx] || FX.confetti)(el.getBoundingClientRect(), el);
    };
    el.addEventListener("mouseenter", fire);
    el.addEventListener("focus", fire);
  });
})();
