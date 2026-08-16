# Vendored code and art

Everything in this directory came from somewhere else. Licences, in full, and what
each thing is used for.

## Munder Difflin — MIT

<https://github.com/chaitanyagiri/munder-difflin> · Copyright (c) Chaitanya Giri

| File | Their source | What it does here |
|---|---|---|
| `munder-people.js` | `src/renderer/src/scene/office/portraitArt.ts` | Draws the cast. Nine hair styles, six garments, facial hair, builds, four skin tones — all procedural, no image assets. Transpiled from TypeScript with esbuild; their `RECIPES` table swapped for an API that takes a recipe, so Council's fifteen can live in `../cast.js`. |
| `munder-tiles.js` | `src/renderer/src/scene/office/TiledMapRenderer.ts` | Renders the Tiled tile layers. Ported from Pixi to a 2D canvas: the gid decode, flip-flag handling and tileset resolution are theirs unchanged. |
| `munder-pathfinding.js` | `src/renderer/src/scene/office/pathfinding.ts` | BFS over the walkability grid, so people walk around furniture instead of through it. |
| `cth-tokens.css` | `src/renderer/src/design/tokens.css` | The design tokens the office UI is built on. |

The full MIT notice is at the head of `munder-people.js`.

## The floor plan — ISC

`munder-office.tmj` is `office.tmj` from <https://github.com/shahar061/the-office>,
which is where Munder Difflin got it too. 34×22 tiles: walls, collision, the
boardroom and cafeteria zones, 24 spawn points and 304 pieces of furniture across
two layers. Council's fifteen auditors sit at the desks the map already defines.

## The pixel art — LimeZu FREE VERSION · **NON-COMMERCIAL ONLY**

`tilesets/*.png` are LimeZu assets. The licence, verbatim, is in
`tilesets/LIMEZUASSETS-LICENSE.txt`:

- **CAN** use, and edit, **in non-commercial projects**.
- **CAN'T** use, or edit, in commercial projects. **CAN'T** resell.

This site is a personal, non-commercial portfolio, which is the same basis Munder
Difflin uses these on — see their `src/renderer/src/assets/ATTRIBUTION.md`.

> **If this site is ever commercialised, `tilesets/` must be deleted or a paid
> LimeZu licence obtained.** Nothing else here depends on it: `munder-tiles.js`
> skips any tile it has no atlas for, and `office.js` falls back to drawing those
> objects in code.

The characters are *not* affected — they are drawn from code by `munder-people.js`,
not recoloured from LimeZu sheets.
