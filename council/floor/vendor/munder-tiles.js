/* ─────────────────────────────────────────────────────────────────────────────
 * munder-tiles.js — the Tiled tile-layer renderer, on a canvas.
 *
 * A port of Munder Difflin v0.4.3 · src/renderer/src/scene/office/TiledMapRenderer.ts
 * from Pixi to a 2D context. Their own header says it is itself a trimmed port
 * of shahar061/the-office (office/engine/TiledMapRenderer.ts).
 *   https://github.com/chaitanyagiri/munder-difflin   (MIT)
 *   https://github.com/shahar061/the-office            (ISC)
 *
 * MIT License · Copyright (c) Chaitanya Giri — full notice in munder-people.js.
 *
 * The gid decode, the flip-flag handling and the tileset resolution are theirs,
 * line for line; only the drawing calls changed (Sprite → drawImage) and the
 * layers are flattened into two canvases instead of Pixi containers, because a
 * static room only needs painting once.
 *
 * ── ART LICENCE ────────────────────────────────────────────────────────────
 * The tilesets under ./tilesets/ are LimeZu pixel art under the LimeZu FREE
 * VERSION licence: usable and editable in NON-COMMERCIAL projects only, never
 * resold. This portfolio is a personal, non-commercial site, which is the same
 * basis Munder Difflin uses them on (see their assets/ATTRIBUTION.md). If this
 * site is ever commercialised these files must be removed or a paid LimeZu
 * licence obtained.
 * ───────────────────────────────────────────────────────────────────────────── */

const FLIPPED_H_FLAG = 0x80000000;
const FLIPPED_V_FLAG = 0x40000000;
const FLIPPED_D_FLAG = 0x20000000;
const TILE_ID_MASK = 0x1fffffff;

/* Their themeRegistry.ts supplies the metadata for the two external tilesets;
 * the first one carries its own inside the map. */
const EXTERNAL = {
  513:  { file: "a5-office-floors-walls.png", columns: 16, tilewidth: 16, tileheight: 16 },
  1025: { file: "interiors.png",              columns: 16, tilewidth: 16, tileheight: 16 },
};

const load = (url) => new Promise((res) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);      /* a missing atlas must not take the room down */
  img.src = url;
});

/** Resolve every tileset the map references to a loaded image, or null. */
export async function loadTilesets(map, baseUrl) {
  const out = [];
  for (const ts of map.tilesets) {
    const meta = EXTERNAL[ts.firstgid];
    const file = ts.image ? ts.image.split("/").pop() : meta && meta.file;
    out.push({
      firstgid: ts.firstgid,
      columns: ts.columns || (meta && meta.columns) || 16,
      tilewidth: ts.tilewidth || (meta && meta.tilewidth) || map.tilewidth,
      tileheight: ts.tileheight || (meta && meta.tileheight) || map.tileheight,
      img: file ? await load(new URL("tilesets/" + file, baseUrl).href) : null,
    });
  }
  return out;
}

/* theirs, reversed so the highest matching firstgid wins */
function resolve(tilesets, gid) {
  for (let i = tilesets.length - 1; i >= 0; i--) {
    if (gid >= tilesets[i].firstgid) return tilesets[i];
  }
  return null;
}

/** Which gids the atlases cannot draw — the caller can substitute for these. */
export function missingGids(map, tilesets, layerNames) {
  const out = new Set();
  for (const name of layerNames) {
    const layer = map.layers.find((l) => l.name === name && l.type === "tilelayer");
    if (!layer) continue;
    for (const raw of layer.data) {
      const gid = raw & TILE_ID_MASK;
      if (!gid) continue;
      const ts = resolve(tilesets, gid);
      if (!ts || !ts.img) out.add(gid);
    }
  }
  return out;
}

/** Blit a single gid at world coordinates — used to overlay the lit monitor
 *  variant the atlas carries beside each switched-off one. */
export function drawGid(ctx, map, tilesets, gid, dx, dy) {
  const ts = resolve(tilesets, gid);
  if (!ts || !ts.img) return;
  const localId = gid - ts.firstgid;
  const sx = (localId % ts.columns) * ts.tilewidth;
  const sy = Math.floor(localId / ts.columns) * ts.tileheight;
  ctx.drawImage(ts.img, sx, sy, ts.tilewidth, ts.tileheight, dx, dy, ts.tilewidth, ts.tileheight);
}

/** Draw one raw (flag-carrying) tile value at world coordinates. Same decode
 *  and transform as paintLayers — used when a layer has to be depth-sorted with
 *  the characters instead of painted flat. */
export function drawRaw(ctx, map, tilesets, raw, dx, dy) {
  const flippedH = (raw & FLIPPED_H_FLAG) !== 0;
  const flippedV = (raw & FLIPPED_V_FLAG) !== 0;
  const flippedD = (raw & FLIPPED_D_FLAG) !== 0;
  const gid = raw & TILE_ID_MASK;
  const ts = resolve(tilesets, gid);
  if (!ts || !ts.img) return;
  const localId = gid - ts.firstgid;
  const sx = (localId % ts.columns) * ts.tilewidth;
  const sy = Math.floor(localId / ts.columns) * ts.tileheight;
  const size = map.tilewidth;
  if (!flippedH && !flippedV && !flippedD) {
    ctx.drawImage(ts.img, sx, sy, ts.tilewidth, ts.tileheight, dx, dy, ts.tilewidth, ts.tileheight);
    return;
  }
  ctx.save();
  ctx.translate(dx + size / 2, dy + size / 2);
  if (flippedD) {
    if (flippedH && !flippedV) ctx.rotate(Math.PI / 2);
    else if (!flippedH && flippedV) ctx.rotate(-Math.PI / 2);
    else if (flippedH && flippedV) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); }
    else { ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); }
  } else {
    ctx.scale(flippedH ? -1 : 1, flippedV ? -1 : 1);
  }
  ctx.drawImage(ts.img, sx, sy, ts.tilewidth, ts.tileheight,
    -ts.tilewidth / 2, -ts.tileheight / 2, ts.tilewidth, ts.tileheight);
  ctx.restore();
}

/**
 * Paint the named tile layers onto a 2D context already scaled to world units.
 * Flip and rotation handling is theirs, expressed as canvas transforms.
 */
export function paintLayers(ctx, map, tilesets, layerNames) {
  const size = map.tilewidth;
  ctx.imageSmoothingEnabled = false;
  for (const name of layerNames) {
    const layer = map.layers.find((l) => l.name === name && l.type === "tilelayer");
    if (!layer || !layer.data) continue;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const raw = layer.data[y * map.width + x];
        if (raw === 0) continue;

        const flippedH = (raw & FLIPPED_H_FLAG) !== 0;
        const flippedV = (raw & FLIPPED_V_FLAG) !== 0;
        const flippedD = (raw & FLIPPED_D_FLAG) !== 0;
        const gid = raw & TILE_ID_MASK;

        const ts = resolve(tilesets, gid);
        if (!ts || !ts.img) continue;

        const localId = gid - ts.firstgid;
        const sx = (localId % ts.columns) * ts.tilewidth;
        const sy = Math.floor(localId / ts.columns) * ts.tileheight;

        if (!flippedH && !flippedV && !flippedD) {
          ctx.drawImage(ts.img, sx, sy, ts.tilewidth, ts.tileheight,
            x * size, y * size, ts.tilewidth, ts.tileheight);
          continue;
        }
        ctx.save();
        ctx.translate(x * size + size / 2, y * size + size / 2);
        if (flippedD) {
          if (flippedH && !flippedV) ctx.rotate(Math.PI / 2);
          else if (!flippedH && flippedV) ctx.rotate(-Math.PI / 2);
          else if (flippedH && flippedV) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); }
          else { ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); }
        } else {
          ctx.scale(flippedH ? -1 : 1, flippedV ? -1 : 1);
        }
        ctx.drawImage(ts.img, sx, sy, ts.tilewidth, ts.tileheight,
          -ts.tilewidth / 2, -ts.tileheight / 2, ts.tilewidth, ts.tileheight);
        ctx.restore();
      }
    }
  }
}
