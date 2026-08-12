/**
 * Compiles the Portfolio Dashboard into the static assets served at /portfolio-dashboard/.
 *
 *   npm install && node build.mjs
 *
 * The app arrived as a Next 16 / vinext project that builds to a Cloudflare Worker.
 * Nothing in its render path touches a Next API, so it compiles to a plain client
 * bundle instead and the portfolio stays a zero-build static site.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets");
const fontsOut = join(out, "fonts");
const pageHtml = join(here, "..", "index.html");

const FONT_WEIGHTS = [400, 500, 700];

const hash = (contents) => createHash("sha256").update(contents).digest("hex").slice(0, 8);

async function bundleScripts() {
  const result = await esbuild.build({
    entryPoints: [join(here, "entry.tsx")],
    outdir: out,
    // Content-hashed so a deploy always lands on a new URL. The site is behind a
    // 4 hour browser cache TTL, so a stable app.js name would leave visitors on
    // a stale bundle until it expired.
    entryNames: "app-[hash]",
    chunkNames: "chunk-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["es2022", "chrome111", "firefox111", "safari16"],
    minify: true,
    sourcemap: false,
    jsx: "automatic",
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
  });

  const outputs = Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith(".js"))
    .map(([file, meta]) => [file.split(/[\\/]/).pop(), meta.bytes]);
  return outputs.sort((a, b) => b[1] - a[1]);
}

async function buildStyles() {
  // The stylesheet opens with `@import "tailwindcss"`. The JSX uses hand named
  // classes rather than utilities, so that import is there for preflight; running
  // the real compiler keeps the reset identical to the original app.
  const cli = join(here, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
  execFileSync(process.execPath, [cli, "--input", join(here, "globals.css"), "--output", join(out, "app.css"), "--minify"], {
    cwd: here,
    stdio: "inherit",
  });
}

async function copyFonts() {
  // DM Sans is self hosted so the dashboard makes no external font request.
  const dir = join(here, "node_modules", "@fontsource", "dm-sans", "files");
  const available = await readdir(dir);
  const faces = [];

  for (const weight of FONT_WEIGHTS) {
    const name = `dm-sans-latin-${weight}-normal.woff2`;
    if (!available.includes(name)) throw new Error(`@fontsource/dm-sans is missing ${name}`);
    await cp(join(dir, name), join(fontsOut, name));
    faces.push(
      `@font-face{font-family:'DM Sans';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${name}') format('woff2')}`,
    );
  }

  const cssPath = join(out, "app.css");
  const css = await readFile(cssPath, "utf8");
  const withFaces = `${faces.join("")}\n${css}`;

  // Hashed for the same reason as the JS bundle.
  const name = `app-${hash(withFaces)}.css`;
  await writeFile(cssPath, withFaces);
  await rename(cssPath, join(out, name));
  return { fontCount: faces.length, name, bytes: Buffer.byteLength(withFaces) };
}

/** Points index.html at whatever the current hashed filenames are. */
async function rewriteHtml(scriptName, styleName) {
  const html = await readFile(pageHtml, "utf8");
  const next = html
    .replace(/\.\/assets\/app[^"']*\.js/g, `./assets/${scriptName}`)
    .replace(/\.\/assets\/app[^"']*\.css/g, `./assets/${styleName}`);

  if (!next.includes(scriptName) || !next.includes(styleName)) {
    throw new Error("index.html has no ./assets/app*.js and ./assets/app*.css references to update.");
  }
  await writeFile(pageHtml, next);
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(fontsOut, { recursive: true });

  const scripts = await bundleScripts();
  await buildStyles();
  const styles = await copyFonts();

  const entry = scripts.find(([file]) => file.startsWith("app-"));
  if (!entry) throw new Error("esbuild produced no app-*.js entry bundle.");
  await rewriteHtml(entry[0], styles.name);

  console.log("\nBuilt into portfolio-dashboard/assets/");
  for (const [file, bytes] of scripts) {
    console.log(`  ${file.padEnd(24)} ${(bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`  ${styles.name.padEnd(24)} ${(styles.bytes / 1024).toFixed(1)} KB`);
  console.log(`  ${styles.fontCount} font files`);
  console.log(`\nindex.html now points at ${entry[0]} and ${styles.name}`);
}

await main();
