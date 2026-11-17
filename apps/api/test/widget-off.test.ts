import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

// A production API without WIDGET_ADDRESS serves no widget file at all (ADR-0017, Q1), even with a build present.
const saved = vi.hoisted(() => {
  const before = { NODE_ENV: process.env.NODE_ENV, WIDGET_ADDRESS: process.env.WIDGET_ADDRESS };
  process.env.NODE_ENV = "production";
  delete process.env.WIDGET_ADDRESS;
  return before;
});

afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

import app from "../src/app";

it("answers the page, its assets and embed.js with 404 on every host", async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-off-"));
  mkdirSync(path.join(dist, ".vite"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, ".vite", "manifest.json"), JSON.stringify({ "src/main.tsx": { file: "assets/main-A1.js" } }));
  writeFileSync(path.join(dist, "assets", "main-A1.js"), "");
  writeFileSync(path.join(dist, "embed.js"), "/* embed */");
  process.env.WIDGET_DIST = dist;

  for (const url of [
    "http://book.example.com/w/embed.js",
    "http://app.example.com/w/embed.js",
    "http://book.example.com/w/assets/main-A1.js",
    "http://book.example.com/w/pk_AAAAAAAAAAAAAAAAAAAAAA",
    "http://book.example.com/r",
  ]) {
    expect((await app.request(url)).status, url).toBe(404);
  }
});
