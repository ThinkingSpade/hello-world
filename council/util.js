/* util.js — Council shared primitives (CONTRACT.md §1). Owner: spine.
 *
 * Every other module imports U. Two rules govern this file:
 *   1. Deterministic by construction — nothing here reads the clock, the
 *      network, or Math.random. Same input, same bytes out, forever.
 *   2. No dependencies, no side effects on import. Runs from file://.
 *
 * sha256Hex prefers crypto.subtle (as the contract specifies) and falls back
 * to a pure-JS SHA-256 when subtle is absent (insecure origins, workers
 * without crypto). Both paths produce identical digests, so IDs are stable
 * across environments — which is the whole point of stableId.
 */
"use strict";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

function toU8(input) {
  if (input == null) return new Uint8Array(0);
  if (typeof input === "string") return ENC.encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("util: expected ArrayBuffer | Uint8Array | string");
}

const HEXD = "0123456789abcdef";
function hex(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += HEXD[u8[i] >> 4] + HEXD[u8[i] & 15];
  return s;
}

/* ---------------- SHA-256 (pure JS, byte-identical to WebCrypto) --------- */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

function sha256Bytes(bytes) {
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  const bits = len * 8;
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

const sha256HexSync = (input) => hex(sha256Bytes(toU8(input)));

async function sha256Hex(input) {
  const bytes = toU8(input);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    try {
      return hex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
    } catch { /* insecure origin / disabled crypto — fall through */ }
  }
  return sha256HexSync(bytes);
}

/* stableId is SYNCHRONOUS on purpose. The contract writes it without `await`
 * in several places (`specHash`, `runId`); a promise-returning version would
 * silently stringify to "[object Promise]" at those call sites. `await
 * U.stableId(...)` still works and yields the same string. */
function stableId(prefix, ...parts) {
  const seed = parts.map((p) => (p == null ? "" : String(p))).join(" ");
  return `${prefix}_${sha256HexSync(seed).slice(0, 12)}`;
}

/* ---------------- numeric + hashing helpers ----------------------------- */

function closeTo(a, b, tol = 1e-9) {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const d = Math.abs(a - b);
  return d <= tol || d <= tol * Math.max(Math.abs(a), Math.abs(b));
}

// classic FNV-1a, 32-bit, over UTF-8 bytes. Parity target for any port.
function fnv1a32(str) {
  const b = ENC.encode(String(str));
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ---------------- raw DEFLATE ------------------------------------------- */

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const count = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Int32Array(17);
  for (let i = 1; i <= 15; i++) offs[i + 1] = offs[i] + count[i];
  const symbol = new Int32Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

let FIXED_LIT = null, FIXED_DIST = null;
function fixedTables() {
  if (FIXED_LIT) return;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  FIXED_LIT = huffman(l);
  FIXED_DIST = huffman(new Uint8Array(30).fill(5));
}

// puff-style raw inflate; used when DecompressionStream is unavailable.
function inflateRawSync(src) {
  fixedTables();
  let bp = 0, bb = 0, bn = 0;
  let out = new Uint8Array(Math.max(4096, src.length * 5)), op = 0;
  const need = (extra) => {
    if (op + extra <= out.length) return;
    let cap = out.length;
    while (cap < op + extra) cap *= 2;
    const n = new Uint8Array(cap);
    n.set(out.subarray(0, op));
    out = n;
  };
  const bits = (n) => {
    while (bn < n) {
      if (bp >= src.length) throw new Error("inflate: input truncated");
      bb |= src[bp++] << bn;
      bn += 8;
    }
    const v = bb & ((1 << n) - 1);
    bb >>>= n; bn -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const cnt = h.count[len];
      if (code - first < cnt) return h.symbol[index + (code - first)];
      index += cnt;
      first = (first + cnt) << 1;
      code <<= 1;
    }
    throw new Error("inflate: bad code");
  };
  for (;;) {
    const last = bits(1), type = bits(2);
    if (type === 0) {
      bb = 0; bn = 0;
      if (bp + 4 > src.length) throw new Error("inflate: truncated stored block");
      const len = src[bp] | (src[bp + 1] << 8);
      bp += 4;
      if (bp + len > src.length) throw new Error("inflate: truncated stored data");
      need(len);
      out.set(src.subarray(bp, bp + len), op);
      op += len; bp += len;
    } else if (type === 1 || type === 2) {
      let lit = FIXED_LIT, dist = FIXED_DIST;
      if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const clen = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) clen[CLORDER[i]] = bits(3);
        const ch = huffman(clen);
        const lengths = new Uint8Array(nlen + ndist);
        for (let i = 0; i < lengths.length;) {
          const sym = decode(ch);
          if (sym < 16) lengths[i++] = sym;
          else if (sym === 16) {
            const prev = i ? lengths[i - 1] : 0;
            let r = 3 + bits(2);
            while (r-- && i < lengths.length) lengths[i++] = prev;
          } else if (sym === 17) {
            let r = 3 + bits(3);
            while (r-- && i < lengths.length) lengths[i++] = 0;
          } else {
            let r = 11 + bits(7);
            while (r-- && i < lengths.length) lengths[i++] = 0;
          }
        }
        lit = huffman(lengths.subarray(0, nlen));
        dist = huffman(lengths.subarray(nlen));
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { need(1); out[op++] = sym; continue; }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= LBASE.length) throw new Error("inflate: bad length code");
        const length = LBASE[li] + bits(LEXT[li]);
        const di = decode(dist);
        if (di >= DBASE.length) throw new Error("inflate: bad distance code");
        const d = DBASE[di] + bits(DEXT[di]);
        if (d > op) throw new Error("inflate: distance beyond output");
        need(length);
        let from = op - d;
        for (let i = 0; i < length; i++) out[op++] = out[from++];
      }
    } else {
      throw new Error("inflate: reserved block type");
    }
    if (last) break;
  }
  return out.slice(0, op);
}

async function inflateRaw(u8) {
  const bytes = toU8(u8);
  if (!bytes.length) return new Uint8Array(0);
  if (typeof globalThis.DecompressionStream === "function") {
    try {
      const ds = new globalThis.DecompressionStream("deflate-raw");
      const w = ds.writable.getWriter();
      // corrupt input rejects BOTH sides of the stream; swallow the writer
      // side so it never surfaces as an unhandled rejection, and let the
      // reader below raise the error into the catch.
      w.write(bytes).catch(() => {});
      w.close().catch(() => {});
      const chunks = [];
      const r = ds.readable.getReader();
      let total = 0;
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    } catch { /* unsupported format name or corrupt tail — try the JS path */ }
  }
  return inflateRawSync(bytes);
}

/* ---------------- ZIP (central directory only) -------------------------- */

const SIG_EOCD = 0x06054b50, SIG_Z64_LOC = 0x07064b50, SIG_Z64_EOCD = 0x06064b50;
const SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

/* Walks the central directory — never scans for local headers, which breaks
 * on entries written with data descriptors (sizes are zero in the local
 * header there). Entries that fail to inflate are skipped, not fatal. */
async function unzip(arrayBuffer) {
  const u8 = toU8(arrayBuffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const files = new Map();
  if (u8.length < 22) return files;

  let eocd = -1;
  const floor = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("unzip: end-of-central-directory record not found");

  let count = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  let cdSize = dv.getUint32(eocd + 12, true);

  // ZIP64: the classic record carries sentinels; the real numbers live in the
  // ZIP64 EOCD pointed at by the locator that precedes the classic record.
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0 && i >= eocd - 4200; i--) {
      if (dv.getUint32(i, true) === SIG_Z64_LOC) { loc = i; break; }
    }
    if (loc >= 0) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (z64 >= 0 && z64 + 56 <= u8.length && dv.getUint32(z64, true) === SIG_Z64_EOCD) {
        count = Number(dv.getBigUint64(z64 + 32, true));
        cdSize = Number(dv.getBigUint64(z64 + 40, true));
        cdOff = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }
  if (cdOff < 0 || cdOff >= u8.length) throw new Error("unzip: central directory offset out of range");

  let p = cdOff;
  const end = Math.min(u8.length, cdSize ? cdOff + cdSize : u8.length);
  for (let i = 0; (count ? i < count : true) && p + 46 <= end; i++) {
    if (dv.getUint32(p, true) !== SIG_CEN) break;
    const method = dv.getUint16(p + 10, true);
    let cSize = dv.getUint32(p + 20, true);
    let uSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = DEC.decode(u8.subarray(p + 46, p + 46 + nameLen));

    if (cSize === 0xffffffff || uSize === 0xffffffff || local === 0xffffffff) {
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const hid = dv.getUint16(e, true), hsz = dv.getUint16(e + 2, true);
        if (hid === 0x0001) {
          let q = e + 4;
          if (uSize === 0xffffffff && q + 8 <= eEnd) { uSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (cSize === 0xffffffff && q + 8 <= eEnd) { cSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (local === 0xffffffff && q + 8 <= eEnd) { local = Number(dv.getBigUint64(q, true)); q += 8; }
          break;
        }
        e += 4 + hsz;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith("/")) continue;
    try {
      if (local + 30 > u8.length || dv.getUint32(local, true) !== SIG_LOC) continue;
      // local header name/extra lengths may differ from the central copy
      const lName = dv.getUint16(local + 26, true);
      const lExtra = dv.getUint16(local + 28, true);
      const start = local + 30 + lName + lExtra;
      const stop = Math.min(u8.length, start + (cSize || u8.length));
      const raw = u8.subarray(start, stop);
      if (method === 0) files.set(name, raw.slice());
      else if (method === 8) files.set(name, await inflateRaw(raw));
      // any other method (bzip2, lzma, …) is skipped by design
    } catch { /* one bad member must not destroy the archive */ }
  }
  return files;
}

/* ---------------- text + display ---------------------------------------- */

const textOf = (u8) => (typeof u8 === "string" ? u8 : DEC.decode(toU8(u8)));

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nf = (min, max, extra) => new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max, ...extra });

// RENDER ONLY. Never feed a formatted string back into a computation.
const fmt = {
  n(v, d = 0) { return isNum(v) ? nf(d, d).format(v) : "—"; },
  pct(v, d = 1) { return isNum(v) ? `${nf(d, d).format(v * 100)}%` : "—"; },
  money(v, currency = "USD", d = 0) {
    return isNum(v) ? nf(d, d, { style: "currency", currency }).format(v) : "—";
  },
  compact(v, d = 1) {
    return isNum(v) ? nf(0, d, { notation: "compact", compactDisplay: "short" }).format(v) : "—";
  },
};

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

function download(filename, mime, blobOrString) {
  const blob = blobOrString instanceof Blob
    ? blobOrString
    : new Blob([blobOrString], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export const U = {
  sha256Hex,
  sha256HexSync,
  stableId,
  closeTo,
  fnv1a32,
  inflateRaw,
  inflateRawSync,
  unzip,
  textOf,
  toU8,
  hex,
  fmt,
  escapeHtml,
  download,
};

export default U;
