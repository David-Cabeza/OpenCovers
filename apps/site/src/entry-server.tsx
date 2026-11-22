import { renderToString } from "react-dom/server";
import App, { faqs } from "./App";
import { faqJsonLdScript } from "./faq-jsonld";

export function render(): string {
  return renderToString(<App />);
}

export function renderFaqJsonLd(): string {
  return faqJsonLdScript(faqs);
}
