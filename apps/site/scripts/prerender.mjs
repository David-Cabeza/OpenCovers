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

// The demo link of the English page and llms.txt. apps/site/demo.json holds the one switch: empty, no page links
// to the demo. The Spanish page reads the same file in App.tsx.
const { url: demoUrl } = JSON.parse(await readFile(path.join(root, "demo.json"), "utf8"));
if (demoUrl !== "" && !/^https:\/\/[a-z0-9.-]+\/?$/.test(demoUrl)) {
  throw new Error(`prerender: demo.json url must be empty or an https origin. Got "${demoUrl}".`);
}
const enPath = path.join(root, "dist/en/index.html");
const llmsPath = path.join(root, "dist/llms.txt");
const enMarker = "<!--demo-link-->";
const en = await readFile(enPath, "utf8");
if (!en.includes(enMarker)) throw new Error(`prerender: ${enMarker} not found in dist/en/index.html`);
const enLink = demoUrl
  ? `<p><a class="demo" href="${demoUrl}">Try the demo</a> <span class="muted">Sign in with your email and get a sandbox restaurant of your own.</span></p>`
  : "";
await writeFile(enPath, en.replace(enMarker, () => enLink));
if (demoUrl) {
  const anchor = "## Start here\n\n";
  const llms = await readFile(llmsPath, "utf8");
  if (!llms.includes(anchor)) throw new Error("prerender: '## Start here' not found in dist/llms.txt");
  const entry = `- [Try the demo](${demoUrl}): a hosted sandbox restaurant for each visitor, no setup.\n`;
  await writeFile(llmsPath, llms.replace(anchor, () => anchor + entry));
}
console.log(`prerender: demo link ${demoUrl ? `on (${demoUrl})` : "off"}`);
console.log("prerender: dist/index.html now contains the rendered page");
