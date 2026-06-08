/* ============================================================
   Huy Nguyen — interactions
   - nav background + active-link tracking
   - hover wiggle + themed emoji particle burst on highlights
   ============================================================ */

(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- nav: translucent backdrop after scrolling ---------- */
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- nav: highlight the section you're looking at ---------- */
  const links = Array.from(document.querySelectorAll(".nav-links a"));
  const linkFor = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => l.classList.remove("active"));
        const active = linkFor.get(entry.target.id);
        if (active) active.classList.add("active");
      });
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );
  ["home", "work", "about"].forEach((id) => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  });

  /* ---------- hover: wiggle the highlight + burst emoji ---------- */
  const playful = document.querySelectorAll("[data-emoji]");

  playful.forEach((el) => {
    let last = 0;

    const trigger = () => {
      const now = performance.now();
      if (now - last < 280) return; // throttle rapid re-hovers
      last = now;

      const anim = el.dataset.anim;
      if (anim) {
        el.classList.remove("playing");
        void el.offsetWidth; // force reflow so the animation restarts
        el.classList.add("playing");
      }
      if (!reduceMotion) burst(el);
    };

    el.addEventListener("mouseenter", trigger);
    el.addEventListener("focus", trigger);
    el.addEventListener("animationend", () => el.classList.remove("playing"));
  });

  /* ---------- the emoji burst ---------- */
  function burst(el) {
    const emojis = (el.dataset.emoji || "✨").trim().split(/\s+/);
    const rect = el.getBoundingClientRect();
    const count = 9;

    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.textContent = emojis[(Math.random() * emojis.length) | 0];

      // launch from a random point along the highlight
      const x = rect.left + Math.random() * rect.width;
      const y = rect.top + rect.height * 0.35;
      p.style.left = x + "px";
      p.style.top = y + "px";

      // fan out upward with a little spread
      const angle = (-90 + (Math.random() * 70 - 35)) * (Math.PI / 180);
      const dist = 46 + Math.random() * 70;
      p.style.setProperty("--dx", (Math.cos(angle) * dist).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.sin(angle) * dist).toFixed(1) + "px");
      p.style.setProperty("--r", ((Math.random() * 140 - 70) | 0) + "deg");
      p.style.setProperty("--d", (0.7 + Math.random() * 0.5).toFixed(2) + "s");
      p.style.fontSize = ((15 + Math.random() * 12) | 0) + "px";

      document.body.appendChild(p);
      p.addEventListener("animationend", () => p.remove());
    }
  }
})();
