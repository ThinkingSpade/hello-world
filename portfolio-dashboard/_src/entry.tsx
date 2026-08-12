import { useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "./page";
import { CodeGate, isUnlocked } from "./code-gate";

function Root() {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  return unlocked ? <Home /> : <CodeGate onUnlock={() => setUnlocked(true)} />;
}

const container = document.getElementById("root");
if (!container) throw new Error("The dashboard needs a #root element to mount into.");

createRoot(container).render(<Root />);
