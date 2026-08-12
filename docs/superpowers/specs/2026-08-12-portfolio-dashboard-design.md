# Portfolio Dashboard — design

Date: 2026-08-12
Status: approved

## What we are adding

`C:\Users\work\Documents\GitHub\Portfolio_Dashboard_Source` is a product portfolio
simplification dashboard. The business case: a printer ink maker consolidating four
legacy SKUs into two new generation SKUs across five retailers, tracked weekly from
2022-11-06 to 2026-07-12.

The app surfaces:

- Weekly trend of rated pages, sales units, and new generation mix, with prior period comparison
- Retailer level breakdown and legacy inventory drawdown
- Weeks of supply per retailer, split black vs color
- A Sankey of the legacy to new SKU mapping
- Click through detail drawers per week, per retailer, per inventory position
- A second mode that profiles any XLSX the visitor uploads

Stack as delivered: React 19, Next 16 on vinext (Cloudflare), Drizzle and D1 wired but
unused by the render path, a 53KB hand written stylesheet adapted from the MIT licensed
Horizon UI and TailAdmin templates, and 1.6MB of precomputed case data.

It becomes the twelfth project on the portfolio, named **Portfolio Dashboard**, living at
`/portfolio-dashboard/`.

## Constraint that shapes everything

The portfolio is zero build static HTML served from the repo root by Cloudflare Pages.
The source is a Next app that builds to a Cloudflare Worker. Those are incompatible.

They do not have to be. `app/page.tsx` is `"use client"` and nothing in the render path
imports a Next API. `app/chatgpt-auth.ts` is the only file that touches `next/headers`
and `next/navigation`, and nothing imports it. So the app compiles to a plain client
bundle with no server, no Worker, and no change to how the site deploys.

## Build

Source and build tooling live in `portfolio-dashboard/_src/`. Built output lands one
level up in `portfolio-dashboard/`.

```
portfolio-dashboard/
  index.html          hand written, back-bar + #root
  app.js              esbuild bundle
  app.css             tailwind v4 CLI output
  case-data.json      copied from source public/
  favicon.svg
  fonts/              DM Sans 400/500/700 woff2, latin
  _src/
    build.mjs
    entry.tsx         mounts <Page/> into #root
    page.tsx, generic-dashboard.tsx, sankey-chart.tsx, info-tip.tsx
    case-workbook.ts, generic-workbook.ts
    globals.css
    package.json
    node_modules/     gitignored
```

Decisions:

- **esbuild** for the JS bundle. One entry, minified, no code splitting except the one
  dynamic import below.
- **Tailwind v4 CLI** compiles `globals.css`. The stylesheet opens with
  `@import "tailwindcss"` and the JSX uses hand named classes, not utilities, so the
  import is there for preflight. Running the real CLI means preflight comes through
  intact and the rendering does not drift from the original.
- **`xlsx` is dynamic imported.** It is the heaviest dependency at roughly 430KB
  minified and only the upload path needs it. `case-workbook.ts` and
  `generic-workbook.ts` switch from a top level `import * as XLSX` to an awaited
  `import("xlsx")` inside their parse functions. Both parse functions are already async
  callers, so this is contained.
- **`react-icons`** tree shakes to the twelve `Md*` icons actually used.
- **DM Sans** self hosted from `@fontsource`, three weights, latin woff2 only. No
  external font request at runtime for the dashboard itself.

Rebuild command, documented in the repo README:

```
cd portfolio-dashboard/_src && npm install && node build.mjs
```

## Changes to the ported source

Kept to the minimum that a subpath static host requires:

1. `fetch("/case-data.json")` becomes `fetch("./case-data.json")` so it resolves under
   `/portfolio-dashboard/` rather than the site root.
2. `cache: "no-store"` dropped from that fetch. The file is static and 1.6MB; there is
   no reason to pull it again on every visit.
3. `xlsx` top level imports become dynamic imports, per above.
4. `layout.tsx` and `chatgpt-auth.ts` are not ported. The layout's metadata, fonts, and
   favicon move into the hand written `index.html`; the auth helpers are dead code here.

Everything else, including all of `globals.css`, ports unchanged.

## The back-bar

A slim strip above the dashboard carrying the site's window chrome vocabulary: three
dots, `portfolio-dashboard.exe` set in Press Start 2P, and a `← Projects` link back to
`/work.html`.

It does **not** link `/shared/pixel.css`. That stylesheet sets body background, type
rules, and box sizing that would bleed into the dashboard and fight its own reset. The
bar's styles are written inline in `index.html`, scoped under a single class, using the
same paper and ink token values the shared sheet defines. The bar borrows the
vocabulary; the dashboard below keeps its own world.

Press Start 2P loads from Google Fonts, matching how every other project page does it.

## The work.html card

One new `<article class="window exp">` following the existing pattern exactly: accent
color pair, pixel SVG mark in the established 24x24 stroked style, `<h2>`, role line,
meta line, description, stack chips via `data-stack`, the `↳ How it fits` tie, and
`Live Run` plus `Source` buttons.

Copy follows the site's writing rule: human voice, no em dashes, no en dashes, no dash
pauses in visible prose. Technical hyphens are fine. The `—` the app prints for a null
table cell stays, since that is a typographic placeholder and not a dash pause.

No other card is touched. No shell styling or copy is touched.

## Source branch

The source folder pushes to `lab/portfolio-dashboard` on `ThinkingSpade/hello-world`,
matching the other projects' `Source ↗` targets. The file list gets shown and confirmed
before the push, since it is a public publish.

No Claude attribution in any commit in this repo.

## Verification

Serve the repo root, then at 390, 768, and 1280 wide:

- Console clean, no failed network requests
- Real numbers render, not just a page skeleton. Check a known value against
  `case-data.json`: the 2026-07-12 week should show 14,556 sales units and 93.7% new mix.
- The trend metric toggle, retailer and color filters, and reset all respond
- A detail drawer opens and closes
- The XLSX upload path loads its chunk and parses
- Back-bar navigates to `/work.html`, and the new card renders there

## Known limits

- The source ships without `node_modules` and its build scripts are Linux only
  (`flock`, GNU `timeout`), so the original app cannot be stood up locally to diff
  against. The port can be verified to render and behave correctly on its own terms.
  Pixel identity with the original is not a claim this process can support.
- Committing generated JS is new for this repo. Abacus vendoring sql.js is the nearest
  precedent. `build.mjs` is checked in beside the output and the rebuild command is
  documented so the artifact is reproducible.
- Page weight is roughly 250KB gzipped of data plus roughly 180KB of JS before the
  optional xlsx chunk. That sits in the same range as Abacus and Atlas.
