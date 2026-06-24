# Huy Nguyen — Personal Site

A retro / pixel-art personal site for **Huy Nguyen** — data analyst & agentic
experience designer based in Houston, Texas.

A pixel custom cursor, chunky "window" UI, and a hand-drawn SVG hover effect on
every highlight — built in plain HTML/CSS/JS, no build step.

## Pages

| File | Page |
|------|------|
| `index.html` | Home — the intro statement with cursive highlights |
| `work.html`  | Projects — featured projects as retro window cards |
| `about.html` | About — bio with hover-reveal pop cards + portrait |
| `styles.css` | Design system, layout, effect keyframes |
| `script.js`  | Pixel cursor, SVG icon library + the hover effects engine |

## Run it

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000   # http://localhost:8000
```

## The interactions

Each highlight has a `data-fx` that fires its own animation — every particle is
a hand-drawn SVG (rocket, robot, bolt, bulb, cap, book, chart, star…) that
sweeps across the page and fades in/out smoothly:

| `data-fx` | Animation |
|-----------|-----------|
| `confetti` | pieces + shapes erupt and rain down |
| `data`     | charts / arrows / %·numbers flow up and out |
| `sparks`   | electric outward zap |
| `rocket`   | rockets blast off the top |
| `pulse`    | expanding rings + floating bulbs |
| `caps`     | graduation-cap toss |
| `binary`   | matrix rain |
| `orbit`    | icons spiral out and circle the word |

- **Pixel cursor** — a rasterised pixel-art arrow replaces the native cursor
  (falls back to native on touch / coarse pointers).
- **Pop cards** (About) — hover a dashed term to reveal a little window card.
- Everything respects `prefers-reduced-motion`.

## Make it yours

- Set your **GitHub** URL and **LinkedIn** link, and the `mailto:` address
  (search `TODO` in `index.html`).
- `work.html` holds **sample projects** — swap in your own titles, blurbs, links.
- Drop a real photo into the `about.html` portrait window.
- Mix effects by changing any `data-fx="…"`; tweak the drawings in the `ICON`
  map or the palette/shadows in the `:root` block of `styles.css`.
