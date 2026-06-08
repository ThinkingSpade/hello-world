# Huy Nguyen — Personal Site

A retro / pixel-art personal site for **Huy Nguyen** — data analyst & agentic
experience designer based in Houston, Texas.

Pixelated custom cursor, hover-reveal pop cards, emoji bursts, and chunky
"window" UI — built in plain HTML/CSS/JS, no build step.

## Pages

| File | Page |
|------|------|
| `index.html` | Home — the intro statement with cursive highlights |
| `work.html`  | Work — experience entries as retro window cards |
| `about.html` | About — bio with hover-reveal pop cards + portrait |
| `styles.css` | Design system, layout, animations |
| `script.js`  | Pixel cursor + reticle, emoji bursts, nav |

## Run it

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000   # http://localhost:8000
```

## The interactions

- **Pixel cursor** — a rasterised pixel-art arrow replaces the native cursor; a
  targeting reticle *pops in* (and tints to match) over anything interactive.
- **Highlights** (home) — cursive phrases spring on hover and burst themed emoji
  (`data-emoji` on each `<mark>`).
- **Pop cards** (about) — hover a dashed term to reveal a little window card.
- Everything respects `prefers-reduced-motion`; the cursor falls back to native
  on touch / coarse pointers.

## Make it yours

- Replace the LinkedIn / résumé `href="#"` placeholders and the `mailto:`
  address (search `TODO`).
- `work.html` entries are **sample placeholders** — swap in real roles, dates,
  logos, and links.
- Drop a real photo into the `about.html` portrait window.
- Palette + shadows live in the `:root` block of `styles.css`.
