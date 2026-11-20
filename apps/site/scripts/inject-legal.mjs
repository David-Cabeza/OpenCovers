// Runs after the build. Replaces the legal tokens in dist/**/*.html. With REQUIRE_LEGAL=1 (the deploy workflow) a token
// left without a value fails the build, so the site never goes live with a placeholder where the controller belongs.
// A local build leaves the tokens visible. The values are never printed.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { injectLegal } from "./legal.mjs";

const dist = path.resolve(import.meta.dirname, "../dist");

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

const problems = [];
for await (const file of htmlFiles(dist)) {
  const before = await readFile(file, "utf8");
  const { html, missing } = injectLegal(before, process.env);
  if (html !== before) await writeFile(file, html);
  if (missing.length > 0) problems.push(`${path.relative(dist, file)}: ${missing.join(", ")}`);
}

if (problems.length > 0) {
  const message = `inject-legal: no value for ${problems.join("; ")}. Set the LEGAL_TAX_ID and LEGAL_ADDRESS secrets.`;
  if (process.env.REQUIRE_LEGAL === "1") throw new Error(message);
  console.warn(message);
}
