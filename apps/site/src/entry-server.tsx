import { renderToString } from "react-dom/server";
import App, { faqs } from "./App";
import { faqJsonLdScript } from "./faq-jsonld";
import BrigadaPage from "./BrigadaPage";
import RoadmapPage from "./RoadmapPage";

export function render(): string {
  return renderToString(<App />);
}

export function renderRoadmap(): string {
  return renderToString(<RoadmapPage />);
}

export function renderBrigada(): string {
  return renderToString(<BrigadaPage />);
}

export function renderFaqJsonLd(): string {
  return faqJsonLdScript(faqs);
}
