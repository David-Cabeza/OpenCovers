import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import RoadmapPage from "./RoadmapPage";
import "./index.css";

const root = document.getElementById("root")!;
const page = (
  <StrictMode>
    <RoadmapPage />
  </StrictMode>
);

// The production build ships the page already rendered (see scripts/prerender.mjs).
if (root.hasChildNodes()) {
  hydrateRoot(root, page);
} else {
  createRoot(root).render(page);
}
