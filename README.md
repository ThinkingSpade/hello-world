# Huy Nguyen — Personal Site

A small, single-page personal site for **Huy Nguyen** — data analyst & agentic
experience designer based in Houston, Texas.

Hover over any **highlighted phrase** and it springs to life with a little
animation and a burst of themed emoji ✨

## Stack

Plain HTML, CSS, and JavaScript — no build step, no dependencies.

| File | What it does |
|------|--------------|
| `index.html` | Page structure & content |
| `styles.css` | Layout, palette, highlight + particle animations |
| `script.js`  | Nav tracking, hover wiggles, emoji bursts |

## Run it

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Make it yours

- **Links:** update the LinkedIn and résumé `href="#"` placeholders and the
  `mailto:` address in `index.html` (search for `TODO`).
- **Work:** the three project cards are samples — swap in your real projects.
- **Highlights:** each `<mark class="hl ...">` takes a `data-anim`
  (`wave` · `bounce` · `pop` · `jelly`) and a `data-emoji` list that flies out
  on hover. Mix and match.
- **Colors:** tweak the palette variables at the top of `styles.css`.

Respects `prefers-reduced-motion` and works down to mobile widths.
