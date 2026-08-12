import { useRef, useState, type FormEvent } from "react";
import { PortfolioMark } from "./page";

/**
 * A soft gate, not a security boundary.
 *
 * This app is served as static files, so the code below ships to the browser in
 * readable form and the underlying case-data.json is fetchable on its own. This
 * screen keeps casual visitors out of a privately shared dashboard; it does not
 * protect the data. Real access control belongs in front of the origin, e.g. a
 * Cloudflare Access policy on /portfolio-dashboard/*.
 */
const ACCESS_CODE = "1139";
const STORAGE_KEY = "portfolio-dashboard.unlocked";

export function isUnlocked() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private browsing or storage disabled. The unlock still holds for this
    // render; it just will not survive a reload.
  }
}

export function CodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value === ACCESS_CODE) {
      remember();
      onUnlock();
      return;
    }
    setError(true);
    setValue("");
    input.current?.focus();
  };

  return (
    <div className="gate-screen">
      <div className="source-brand">
        <PortfolioMark />
        <strong>Portfolio Dashboard</strong>
      </div>
      <form className={`gate-panel ${error ? "error" : ""}`} onSubmit={submit}>
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
          aria-label="Access code"
          aria-invalid={error}
          aria-describedby={error ? "gate-error" : undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, "").slice(0, 4));
            setError(false);
          }}
        />
        <button className="gate-submit" type="submit" disabled={value.length < 4}>
          Unlock
        </button>
        <p className="gate-error" id="gate-error" role="alert">
          {error ? "That code is not right. Try again." : " "}
        </p>
      </form>
    </div>
  );
}
