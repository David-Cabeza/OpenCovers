import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import BrigadaPage from "./BrigadaPage";
import "./index.css";

const root = document.getElementById("root")!;
const page = (
  <StrictMode>
    <BrigadaPage />
  </StrictMode>
);

// The production build ships the page already rendered (see scripts/prerender.mjs).
if (root.hasChildNodes()) {
  hydrateRoot(root, page);
} else {
  createRoot(root).render(page);
}
