import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// The founding-venues block and the ten commitments moved to the roadmap page. Old links to them land there.
if (/^#(locales-fundadores|c([1-9]|10))$/.test(location.hash)) {
  location.replace(`/hoja-de-ruta/${location.hash}`);
}

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The production build ships the page already rendered (see scripts/prerender.mjs).
if (root.hasChildNodes()) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
