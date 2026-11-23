#!/usr/bin/env node
// Derives the counts that docs restate by hand (conformance status, MCP tools,
// widget languages) from their sources, and fails when a guarded file states
// another number next to its keyword. Plain Node, no dependencies.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// ---- Sources ----
const status = read("docs/contract/conformance-status.md");
const count = { PASS: 0, PARTIAL: 0, GAP: 0, BLOCKED: 0 };
for (const m of status.matchAll(/^\| C\d+[a-z]? [^|]*\| \*\*([A-Z]+)\*\*/gm)) {
  if (m[1] in count) count[m[1]]++;
}
const cases = Object.values(count).reduce((a, b) => a + b, 0);

const mcpSrc = read("apps/mcp/src/index.ts");
const tools = (mcpSrc.match(/\.registerTool\(/g) ?? []).length;

const locSrc = read("apps/api/src/lib/online-booking.ts");
const locMatch = locSrc.match(/export const LOCALES = \[([^\]]*)\]/);
if (!locMatch) throw new Error("check-docs: LOCALES array not found in apps/api/src/lib/online-booking.ts");
const locales = (locMatch[1].match(/"[a-z-]+"/gi) ?? []).length;

const errors = [];
if (!cases || !tools || !locales) {
  errors.push(`sources gave a zero count (cases ${cases}, tools ${tools}, locales ${locales}); the source format changed, update scripts/check-docs.mjs`);
}
// The MCP catalog table must agree with the registered tools.
{
  const mcpDoc = read("docs/contract/mcp.md");
  const table = mcpDoc.split(/^## /m)[0];
  const rows = (table.match(/^\| `[A-Za-z_.]+` \|/gm) ?? []).length;
  if (rows !== tools) errors.push(`docs/contract/mcp.md: catalog table lists ${rows} tools, apps/mcp/src/index.ts registers ${tools}`);
}

// ---- Number words (en, es) ----
const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const NUM = `(\\d+|${Object.keys(WORDS).join("|")})`;
const DIGITS = "(\\d+)";
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);

// Each rule: a regex whose capture groups are numbers, and the expected values.
const rules = [
  { name: "MCP tools", re: new RegExp(`\\b${DIGITS}[ -](?:tools?|herramientas)\\b`, "gi"), expect: [tools], source: "apps/mcp/src/index.ts" },
  { name: "languages", re: new RegExp(`\\b${NUM} (?:languages|idiomas)\\b`, "gi"), expect: [locales], source: "LOCALES in apps/api/src/lib/online-booking.ts" },
  { name: "conformance total", re: /\b(\d+) conformance cases\b/gi, expect: [cases], source: "conformance-status.md" },
  { name: "pass and partial", re: /\b(\d+) conformance cases, (\d+) pass and (\d+) are partial/gi, expect: [cases, count.PASS, count.PARTIAL], source: "conformance-status.md" },
  { name: "pass and partial", re: /\b(\d+) of the (\d+) conformance cases pass and (\d+) are partial/gi, expect: [count.PASS, cases, count.PARTIAL], source: "conformance-status.md" },
];

const files = [
  "README.md",
  "apps/site/public/llms.txt",
  "apps/site/public/en/index.html",
  "docs/contract/mcp.md",
  "ROADMAP.md",
  "apps/site/src/roadmap.ts",
];

let checked = 0;
for (const file of files) {
  const lines = read(file).split("\n");
  lines.forEach((line, i) => {
    for (const rule of rules) {
      for (const m of line.matchAll(rule.re)) {
        const got = m.slice(1).map(toNum);
        checked++;
        if (got.some((g, k) => g !== rule.expect[k])) {
          errors.push(`${file}:${i + 1}: "${m[0]}" states ${got.join("/")} for ${rule.name}, ${rule.source} gives ${rule.expect.join("/")}`);
        }
      }
    }
  });
}

if (errors.length) {
  console.error("check-docs failed:\n" + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
console.log(`check-docs ok: ${checked} statements match (${cases} cases: ${count.PASS} pass, ${count.PARTIAL} partial, ${count.GAP} gap; ${tools} tools; ${locales} languages)`);
// An ADR rule ("Nothing in this record is built" on an Accepted ADR) would plug in here, reading docs/adr/*.md.
