import { createRoot } from "react-dom/client";
import Home from "./page";

const container = document.getElementById("root");
if (!container) throw new Error("The dashboard needs a #root element to mount into.");

createRoot(container).render(<Home />);
