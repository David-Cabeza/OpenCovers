// Lists the places in the staff app's source where text for people is written in English instead of coming from the
// catalog: JSX text, string attributes that people read, toasts, error messages and validation messages.
// A heuristic, not a parser: it finds what is almost always a miss, and `// i18n-ok` at the end of a line silences it.
//   node scripts/i18n-audit.mjs [files or folders]   (default: src, tests and the ui folder excluded)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
const args = process.argv.slice(2);
const targets = args.length ? args : [ROOT];

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) walk(join(path, name), out);
  } else if (/\.(tsx?)$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.includes("/i18n/") && !path.includes("/components/ui/")) out.push(path);
  return out;
}

const WORD = /[A-Za-z]{3,}/;
// Text that reads as words: starts with a letter, may hold spaces and punctuation.
const SUSPECT_ATTR = /\b(placeholder|title|aria-label|alt|label|description|helperText|hint|legend)=("|')([^"'{}]*?[A-Za-z]{3,}[^"'{}]*?)\2/g;
const SUSPECT_CALL = /\b(toast\.(?:success|error|info|warning|message)|errorMessage|authErrorMessage|setServerError|setError)\(\s*(?:[^"'`)]*,\s*)?("|')([^"']*[A-Za-z]{3,}[^"']*)\2/g;
const SUSPECT_PROP = /\b(message|required|label|title|description|text|name):\s*("|')([^"'{}]*?[A-Za-z]{3,}[^"'{}]*?)\2/g;

const findings = [];
for (const root of targets) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inJsxText = false;
    lines.forEach((line, i) => {
      if (/\/\/ i18n-ok/.test(line)) return;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("import ")) return;
      const report = (kind, text) => findings.push(`${file.replace(ROOT, "")}:${i + 1}  ${kind}  ${text.trim().slice(0, 90)}`);
      // JSX text on a line of its own, or between tags: >Some words<
      for (const m of line.matchAll(/>([^<>{}=;]*[A-Za-z]{3,}[^<>{}=;]*)</g)) {
        if (/^\s*[A-Za-z]{3,}\s*$/.test(m[1]) && /[=:(]/.test(line.slice(0, m.index))) continue;
        if (!/\s/.test(m[1].trim()) && /^[a-z]/.test(m[1].trim())) continue; // a single lower-case token is code
        report("jsx-text", m[1]);
      }
      if (/^[A-Z][A-Za-z0-9 ,.'’!?:;()&/\-—–]*[a-z][A-Za-z0-9 ,.'’!?:;()&/\-—–]*$/.test(trimmed) && !/[{}=;]/.test(trimmed) && /\s/.test(trimmed)) report("jsx-text-line", trimmed);
      for (const m of line.matchAll(SUSPECT_ATTR)) report("attr", `${m[1]}="${m[3]}"`);
      for (const m of line.matchAll(SUSPECT_CALL)) report("call", `${m[1]}("${m[3]}")`);
      for (const m of line.matchAll(SUSPECT_PROP)) {
        if (/^(name|label|title|description|text)$/.test(m[1]) && !/\s|^[A-Z]/.test(m[3])) continue; // a code identifier
        report("prop", `${m[1]}: "${m[3]}"`);
      }
    });
  }
}
console.log(findings.join("\n"));
console.error(`${findings.length} suspect line${findings.length === 1 ? "" : "s"}`);
process.exit(findings.length ? 1 : 0);
