# Aether Intelligence

**Aether Intelligence** is a high-fidelity, entirely client-side simulation of
an autonomous competitive-intelligence swarm. Research agents appear to monitor
competitor launches, hiring, funding, patents, technology choices, pricing, and
customer sentiment; resolve the evidence into entities; and maintain a living
knowledge graph.

The experience is deliberately convincing, but every company, event, metric,
and agent action is synthetic. It makes **no external AI, LLM, analytics, or
data API calls**.

## What is included

- Interactive force-directed context graph with six business domains,
  draggable nodes, zoom/pan controls, filters, tooltips, node inspection, and
  directional link particles
- A bounded, long-running simulation clock that adds and retires graph signals
  without leaking memory or visibly resetting
- Live browser date and time, fluctuating agent population, signal rate, entity
  match counts, graph density, relationship flow, and coverage metrics
- Continuously updating source and alert ledgers with realistic synthetic
  evidence
- Animated inference pipeline, agent task roster, entity-resolution heatmap,
  research-rate chart, shared-memory gauge, run matrix, and event toasts
- White-first command-center theme and a fully designed dark graph-native theme
- Pause/resume controls, reduced-motion support, responsive layouts, keyboard
  focus states, and semantic status announcements
- An intentional initialization sequence and a visible simulation disclosure

## Technology

- Vite
- React + TypeScript
- Tailwind CSS
- `react-force-graph-2d` / D3 force simulation
- Framer Motion
- Lucide icons
- Locally bundled Manrope and JetBrains Mono variable fonts
- Vitest and ESLint

The canvas graph is isolated in a lazy-loaded bundle. React owns the dashboard
and bounded business-event state, while the graph renderer owns frame-by-frame
positions. Stable cluster forces keep related entities together, a small sampled
set of links carries particles, and simulation history is capped so the page can
run for hours without unbounded growth.

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL, normally <http://localhost:5173>.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

## Portfolio deployment

This repository's portfolio is hosted as static files from its root. The Vite
build therefore writes the production application to the sibling `../aether/`
route:

```bash
npm run build
```

The generated page is then available at `/aether/`. The generated folder is a
deployable static artifact; the complete editable source remains here in
`aether-intelligence/`.

## Data and privacy

Aether does not fetch competitors, scrape websites, call a model provider, or
send telemetry. Refreshing the page creates a new local simulation session.
Browser storage is used only to remember the selected light or dark theme.

## Inspiration and originality

The project draws on general knowledge-graph interaction patterns found in
tools such as Obsidian and GitNexus, along with modern multi-agent operations
interfaces. Its simulation, information architecture, visual system, data,
components, and graph implementation were created independently. No GitNexus
source was copied; GitNexus uses the PolyForm Noncommercial license.

## License

The Aether Intelligence source in this directory is available under the MIT
License. See [LICENSE](LICENSE).
