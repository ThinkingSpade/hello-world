import { useEffect, useRef, useState, type FormEvent } from "react";
import { PortfolioMark } from "./page";

/**
 * A soft gate, not a security boundary.
 *
 * This app is served as static files, so the code below ships to the browser in
 * readable form and the underlying case-data.json is fetchable on its own. This
 * screen keeps casual visitors out of a privately shared dashboard; it does not
 * protect the data. Real access control belongs in front of the origin, e.g. a
 * Cloudflare Access policy on /portfolio-dashboard/*.
 *
 * The lockout below is the same kind of thing: it slows someone tapping codes
 * into the form. It cannot stop scripted guessing, which would not use the form.
 */
const ACCESS_CODE = "1139";
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

/** Unlock is per browser session; the lockout deliberately outlives the tab. */
const UNLOCK_KEY = "portfolio-dashboard.unlocked";
const ATTEMPT_KEY = "portfolio-dashboard.gate";

type Attempts = { count: number; lockedUntil: number };
const CLEAR: Attempts = { count: 0, lockedUntil: 0 };

export function isUnlocked() {
  try {
    return window.sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    // Private browsing or storage disabled. The unlock still holds for this
    // render; it just will not survive a reload.
  }
}

function readAttempts(): Attempts {
  try {
    const raw = window.localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return CLEAR;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return CLEAR;
    const { count, lockedUntil } = parsed as Partial<Attempts>;
    return {
      count: Number.isFinite(count) ? Math.max(0, Number(count)) : 0,
      lockedUntil: Number.isFinite(lockedUntil) ? Math.max(0, Number(lockedUntil)) : 0,
    };
  } catch {
    // Unreadable or hand-edited. Start clean rather than lock someone out on it.
    return CLEAR;
  }
}

function writeAttempts(next: Attempts) {
  try {
    if (next.count === 0 && next.lockedUntil === 0) window.localStorage.removeItem(ATTEMPT_KEY);
    else window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable. The lockout then only lasts for this page view.
  }
}

function countdown(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [attempts, setAttempts] = useState(readAttempts);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const remaining = Math.max(0, attempts.lockedUntil - now);
  const locked = remaining > 0;

  // Tick only while the lock is running, so the countdown stays live without a
  // timer spinning for the rest of the session.
  useEffect(() => {
    if (!locked) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [locked]);

  // Once a lock expires, hand back a clean slate rather than a spent counter.
  useEffect(() => {
    if (attempts.lockedUntil && !locked) {
      setAttempts(CLEAR);
      writeAttempts(CLEAR);
      setMessage("");
      input.current?.focus();
    }
  }, [locked, attempts.lockedUntil]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;

    if (value === ACCESS_CODE) {
      setAttempts(CLEAR);
      writeAttempts(CLEAR);
      remember();
      onUnlock();
      return;
    }

    const count = attempts.count + 1;
    const next: Attempts =
      count >= MAX_ATTEMPTS ? { count: 0, lockedUntil: Date.now() + LOCK_MS } : { count, lockedUntil: 0 };
    const left = MAX_ATTEMPTS - count;

    setAttempts(next);
    writeAttempts(next);
    setNow(Date.now());
    setValue("");
    // The locked case is derived at render time instead, so it survives a reload.
    setMessage(
      next.lockedUntil
        ? ""
        : left <= 2
          ? `That code is not right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`
          : "That code is not right. Try again.",
    );
    input.current?.focus();
  };

  const notice = locked ? `Too many attempts. Locked for ${LOCK_MS / 60000} minutes.` : message;

  return (
    <div className="gate-screen">
      <div className="source-brand">
        <PortfolioMark />
        <strong>Portfolio Dashboard</strong>
      </div>
      <form className={`gate-panel ${notice ? "error" : ""}`} onSubmit={submit}>
        <h1>Access code</h1>
        <p>This dashboard is shared privately. Enter the code to continue.</p>
        <input
          ref={input}
          className="gate-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={4}
          disabled={locked}
          aria-label="Access code"
          aria-invalid={Boolean(notice)}
          aria-describedby="gate-message"
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, "").slice(0, 4));
            setMessage("");
          }}
        />
        <button className="gate-submit" type="submit" disabled={locked || value.length < 4}>
          {/* The countdown lives on the button rather than in the live region
              below, so it does not re-announce itself every second. */}
          {locked ? `Try again in ${countdown(remaining)}` : "Unlock"}
        </button>
        <p className="gate-error" id="gate-message" role="alert">
          {notice || " "}
        </p>
      </form>
    </div>
  );
}
