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

  /* ---------- per-highlight hover effects ---------- */
  const palette = ['var(--coral-tx)', 'var(--blue-tx)', 'var(--gold-tx)', 'var(--green-tx)', 'var(--violet-tx)', 'var(--peach-tx)'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const emojiOf = (el, def) => (el && el.dataset.emoji ? el.dataset.emoji.trim().split(/\s+/) : def);

  // spawn one particle; auto-removes when its animation ends
  function mk(cls, o) {
    const e = document.createElement("span");
    e.className = "fx " + cls;
    if (o.text != null) e.textContent = o.text;
    e.style.left = o.x + "px";
    e.style.top = o.y + "px";
    if (o.size) e.style.fontSize = o.size + "px";
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

  const FX = {
    // celebratory confetti: colored pieces + emoji shoot up, then rain down
    confetti(r, el) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const emo = emojiOf(el, ["🎉", "✨", "🎊", "👋"]);
      for (let i = 0; i < 20; i++) {
        const piece = i % 5 !== 0;
        mk("fx-toss" + (piece ? " fx-piece" : ""), {
          text: piece ? null : pick(emo),
          x: cx + rand(-r.width / 2, r.width / 2), y: cy,
          size: piece ? null : rand(15, 26), w: piece ? rand(6, 10) : null, h: piece ? rand(9, 15) : null,
          bg: piece ? pick(palette) : null, dur: rand(1.0, 1.5),
          vars: { "--dx": rand(-120, 120).toFixed(0) + "px", "--up": rand(-140, -70).toFixed(0) + "px",
                  "--fall": rand(90, 210).toFixed(0) + "px", "--spin": (rand(-360, 360) | 0) + "deg" }
        });
      }
    },
    // bar chart growing upward + climbing arrows
    bars(r) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const h = rand(24, 72);
        mk("fx-bar", { x: r.left + (i + .5) / n * r.width, y: r.bottom - h, w: rand(7, 11), h,
          bg: i % 2 ? "var(--blue-tx)" : "var(--blue-bg)", dur: rand(.85, 1.15), delay: i * .05 });
      }
      for (let i = 0; i < 4; i++)
        mk("fx-spark", { text: pick(["📈", "📊", "🔢"]), x: r.left + rand(0, r.width), y: r.top, size: rand(15, 22),
          dur: 1, vars: { "--dx": rand(35, 80).toFixed(0) + "px", "--dy": rand(-90, -45).toFixed(0) + "px", "--r": "0deg" } });
    },
    // electric radial zap of robots / gears / bolts
    sparks(r, el) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const emo = emojiOf(el, ["🤖", "⚡", "⚙️", "✨"]);
      for (let i = 0; i < 15; i++) {
        const a = rand(0, Math.PI * 2), d = rand(46, 116);
        mk("fx-spark", { text: pick(emo), x: cx, y: cy, size: rand(15, 27), dur: rand(.6, 1),
          vars: { "--dx": (Math.cos(a) * d).toFixed(0) + "px", "--dy": (Math.sin(a) * d).toFixed(0) + "px", "--r": (rand(-90, 90) | 0) + "deg" } });
      }
    },
    // rocket(s) blast straight up with an exhaust trail (Space City!)
    rocket(r) {
      const cx = r.left + r.width / 2, baseY = r.bottom;
      mk("fx-spark", { text: "🤠", x: cx, y: r.top, size: 22, dur: .8, vars: { "--dx": "0px", "--dy": "-34px", "--r": "0deg" } });
      for (let s = 0; s < 2; s++) {
        const x = cx + (s ? rand(-70, 70) : 0);
        mk("fx-rocket", { text: "🚀", x, y: baseY, size: rand(22, 30), dur: rand(1, 1.35),
          vars: { "--dx": rand(-24, 24).toFixed(0) + "px", "--rot": (rand(-10, 10) | 0) + "deg" } });
        for (let t = 0; t < 7; t++)
          mk("fx-puff", { text: pick(["💨", "✨", "⭐", "🔥"]), x: x + rand(-9, 9), y: baseY - t * 6, size: rand(10, 17),
            dur: .7, delay: t * .06, vars: { "--rise": rand(-50, -18).toFixed(0) + "px" } });
      }
    },
    // idea pulse: expanding rings + radial sparkles
    pulse(r, el) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const emo = emojiOf(el, ["💡", "✨", "🤖", "⚡"]);
      for (let i = 0; i < 2; i++) mk("fx-ring", { x: cx, y: cy, w: 26, h: 26, dur: .9, delay: i * .14, vars: { "--c": "var(--violet-tx)" } });
      for (let i = 0; i < 11; i++) {
        const a = rand(0, Math.PI * 2), d = rand(40, 95);
        mk("fx-spark", { text: pick(emo), x: cx, y: cy, size: rand(15, 24), dur: rand(.7, 1),
          vars: { "--dx": (Math.cos(a) * d).toFixed(0) + "px", "--dy": (Math.sin(a) * d).toFixed(0) + "px", "--r": "0deg" } });
      }
    },
    // graduation-cap toss: caps + books fountain up and arc down
    caps(r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (let i = 0; i < 14; i++)
        mk("fx-toss", { text: i % 4 ? "🎓" : "📚", x: cx + rand(-r.width / 3, r.width / 3), y: cy, size: rand(16, 30), dur: rand(1.0, 1.6),
          vars: { "--dx": rand(-70, 70).toFixed(0) + "px", "--up": rand(-170, -110).toFixed(0) + "px",
                  "--fall": rand(110, 220).toFixed(0) + "px", "--spin": (rand(-540, 540) | 0) + "deg" } });
    },
    // binary / matrix rain falling down
    binary(r) {
      for (let i = 0; i < 18; i++) {
        const emoji = i % 6 === 5;
        mk("fx-bin", { text: emoji ? pick(["🔢", "📊"]) : (Math.random() < .5 ? "0" : "1"),
          x: r.left + rand(0, r.width), y: r.top - rand(0, 28), size: emoji ? 15 : rand(12, 19),
          color: "var(--blue-tx)", dur: rand(.8, 1.5), delay: rand(0, .3), vars: { "--fall": rand(80, 200).toFixed(0) + "px" } });
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
