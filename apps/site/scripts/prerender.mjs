// Puts the rendered page into dist/index.html so crawlers that do not run
// JavaScript see the text. Runs after `vite build` and `vite build --ssr`.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const htmlPath = path.join(root, "dist/index.html");
const ssrDir = path.join(root, "dist-ssr");
const marker = '<div id="root"></div>';

const { render } = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
const html = await readFile(htmlPath, "utf8");
if (!html.includes(marker)) {
  throw new Error(`prerender: ${marker} not found in dist/index.html`);
}
await writeFile(htmlPath, html.replace(marker, () => `<div id="root">${render()}</div>`));
await rm(ssrDir, { recursive: true, force: true });
console.log("prerender: dist/index.html now contains the rendered page");
