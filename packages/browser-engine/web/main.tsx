import { createRoot } from "react-dom/client";

import { App } from "./components/App.tsx";
import { greet } from "./store/drive.ts";

/** Draws the page, then asks the server for the state it already holds. */
function mount(host: HTMLElement | null): void {
  if (host === null) {
    console.error("The document has no #root element.");
    return;
  }
  createRoot(host).render(<App />);
  void greet();
}

mount(document.getElementById("root"));
