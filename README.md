# Huy Nguyen — Portfolio

This repository is Huy Nguyen's static portfolio: a pixel-window site for
browser-native data, machine-learning, retrieval, and operations demos. It is
built with plain HTML, CSS, and JavaScript; there is no build step.

The live site is [hello-world-bp7.pages.dev](https://hello-world-bp7.pages.dev).

## Project demos

- **Aether Intelligence** (`/aether/`) — runs a high-fidelity competitive
  intelligence swarm simulation with a living force-directed graph, source and
  alert ledgers, entity resolution, and autonomous-agent telemetry. The Vite,
  React, and TypeScript source lives in `aether-intelligence/`; its production
  build is committed directly to the static `aether/` route.
- **Abacus** (`/abacus/`) — compiles constrained analysis plans to SQL and runs
  them over SQLite-WASM in the browser.
- **Atlas** (`/atlas/`) — searches two shipped document corpora with hybrid
  ranking and returns extractive answers with citations.
- **Churn Radar** (`/churn/`) — scores IBM Telco records client-side with shipped
  logistic-regression coefficients and a held-out model card.
- **Conductor** (`/conductor/`) — replays recorded data-pipeline failures,
  diagnoses, repair proposals, approval gates, and verification steps.
- **Helmsman** (`/helmsman/`) — replays Kubernetes incident fixtures with staged
  rollback and a human gate before repair commands.
- **Oracle** (`/oracle/`) — plays scripted multi-model debate sessions as an
  inspectable timeline with confidence changes and a final verdict.
- **Portfolio Dashboard** (external) — tracks a product portfolio simplification
  across five retailers, with drill-down detail and an upload slot that profiles
  any workbook into a dashboard of its own. It is a server-rendered app behind an
  access code, so it runs as its own Cloudflare Worker rather than from this
  repository; the projects page links out to it.
- **Pulse** (`/pulse/`) — fetches public macroeconomic feeds in the browser and
  turns the returned values into charts and a sourced morning brief.

## Site structure

- `index.html`, `work.html`, and `about.html` are the portfolio pages.
- `styles.css` and `script.js` provide the root layout and interactions.
- `shared/pixel.css` is the shared pixel-interface design system used by demos.
- `shared/icons.svg` is the reusable SVG icon sprite.
- Each project directory is a self-contained static demo.
- `aether-intelligence/` is the editable Vite source for Aether; `aether/` is
  its generated static portfolio route.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. Serving over HTTP is required for demos that
fetch local JSON, SQLite, or WebAssembly assets.

To work on Aether itself, run `npm install && npm run dev` from
`aether-intelligence/`. Run `npm run build` there to refresh the checked-in
`aether/` route.

## Deployment

Cloudflare Pages serves the repository root directly. Root-relative project
URLs such as `/abacus/` therefore map to their directories without a generated
site or package build.
