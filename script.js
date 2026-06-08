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

  /* ---------- emoji burst on hover ---------- */
  document.querySelectorAll("[data-emoji]").forEach((el) => {
    let last = 0;
    const fire = () => {
      const now = performance.now();
      if (now - last < 260) return;
      last = now;
      if (!reduce) burst(el);
    };
    el.addEventListener("mouseenter", fire);
    el.addEventListener("focus", fire);
  });

  function burst(el) {
    const emojis = (el.dataset.emoji || "✨").trim().split(/\s+/);
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.textContent = emojis[(Math.random() * emojis.length) | 0];
      p.style.left = (r.left + Math.random() * r.width) + "px";
      p.style.top  = (r.top + r.height * 0.35) + "px";
      const a = (-90 + (Math.random() * 70 - 35)) * (Math.PI / 180);
      const d = 46 + Math.random() * 70;
      p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.sin(a) * d).toFixed(1) + "px");
      p.style.setProperty("--r", ((Math.random() * 140 - 70) | 0) + "deg");
      p.style.setProperty("--d", (0.7 + Math.random() * 0.5).toFixed(2) + "s");
      p.style.fontSize = ((15 + Math.random() * 12) | 0) + "px";
      document.body.appendChild(p);
      p.addEventListener("animationend", () => p.remove());
    }
  }
})();
