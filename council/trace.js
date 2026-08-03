/* trace.js — the run console.
 *
 * The transcript shows what a seat concluded. This shows how it got there: the
 * checks it ran, the values it read, the test that decided the question. When a
 * seat says "inventory is a level, not a flow", the console is where you see
 * that it compared segment medians and got 1.016.
 *
 * Everything in here is a record of work that actually happened. No line is
 * written in advance, and no line reports a value the engines did not produce.
 * The console is append-only within a run and is carried in the run bundle, so
 * the reasoning replays with the numbers.
 */

const LEVELS = {
  step:   { sigil: "▸", cls: "t-step" },    // a seat begins a piece of work
  detail: { sigil: "·", cls: "t-detail" },  // an intermediate reading
  test:   { sigil: "?", cls: "t-test" },    // a check, with its outcome
  result: { sigil: "✓", cls: "t-result" },  // a conclusion reached
  say:    { sigil: "»", cls: "t-say" },     // the seat speaks
  warn:   { sigil: "!", cls: "t-warn" },
  error:  { sigil: "✗", cls: "t-error" },
  gate:   { sigil: "#", cls: "t-gate" },
};

let mount = null;
let lines = [];
let t0 = 0;
let follow = true;

function stamp(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;
}

export const Trace = {
  mount(el) {
    mount = el;
    t0 = performance.now();
    lines = [];
    if (mount) mount.innerHTML = "";
    // Stop auto-scrolling the moment the reader scrolls up to look at something.
    if (mount) {
      mount.addEventListener("scroll", () => {
        follow = mount.scrollHeight - mount.scrollTop - mount.clientHeight < 40;
      });
    }
  },

  reset() {
    lines = [];
    t0 = performance.now();
    follow = true;
    if (mount) mount.innerHTML = "";
  },

  line(scope, level, text, opts = {}) {
    const L = LEVELS[level] || LEVELS.detail;
    const at = performance.now() - t0;
    const rec = { at, scope, level, text: String(text) };
    lines.push(rec);
    if (!mount) return rec;

    const row = document.createElement("div");
    row.className = `t-row ${L.cls}`;
    if (opts.indent) row.style.paddingLeft = `${opts.indent * 14}px`;

    const ts = document.createElement("span");
    ts.className = "t-ts";
    ts.textContent = stamp(at);
    row.appendChild(ts);

    const sc = document.createElement("span");
    sc.className = "t-scope";
    sc.textContent = String(scope).slice(0, 13).padEnd(13, " ");
    row.appendChild(sc);

    const sg = document.createElement("span");
    sg.className = "t-sigil";
    sg.textContent = L.sigil;
    row.appendChild(sg);

    const tx = document.createElement("span");
    tx.className = "t-text";
    tx.textContent = String(text);
    row.appendChild(tx);

    mount.appendChild(row);
    if (follow) mount.scrollTop = mount.scrollHeight;
    return rec;
  },

  step(scope, text)   { return Trace.line(scope, "step", text); },
  detail(scope, text) { return Trace.line(scope, "detail", text, { indent: 1 }); },
  test(scope, text)   { return Trace.line(scope, "test", text, { indent: 1 }); },
  result(scope, text) { return Trace.line(scope, "result", text, { indent: 1 }); },
  say(scope, text)    { return Trace.line(scope, "say", text); },
  warn(scope, text)   { return Trace.line(scope, "warn", text); },
  error(scope, text)  { return Trace.line(scope, "error", text); },

  gate(text) {
    Trace.line("——", "gate", text);
  },

  rule(text) {
    if (!mount) return;
    const row = document.createElement("div");
    row.className = "t-rule";
    row.textContent = `── ${text} ${"─".repeat(Math.max(0, 60 - text.length))}`;
    mount.appendChild(row);
    if (follow) mount.scrollTop = mount.scrollHeight;
    lines.push({ at: performance.now() - t0, scope: "", level: "rule", text });
  },

  lines() { return [...lines]; },

  toText() {
    return lines.map((l) =>
      l.level === "rule"
        ? `\n── ${l.text} ──`
        : `${stamp(l.at)}  ${String(l.scope).padEnd(13)} ${(LEVELS[l.level] || LEVELS.detail).sigil} ${l.text}`
    ).join("\n");
  },
};

export default Trace;
