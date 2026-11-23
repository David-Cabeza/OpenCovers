// Fills the legal placeholders in the built pages. The controller's tax id and postal address are personal data of a
// sole trader and must not live in this public repository, so the pages carry tokens and the deploy supplies the
// values from private GitHub secrets (LEGAL_TAX_ID, LEGAL_ADDRESS).
export const TOKENS = { "{{LEGAL_TAX_ID}}": "LEGAL_TAX_ID", "{{LEGAL_ADDRESS}}": "LEGAL_ADDRESS" };

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Returns the page with every token whose value is set replaced (HTML-escaped), and the tokens still present. */
export function injectLegal(html, env) {
  const values = Object.fromEntries(Object.entries(TOKENS).map(([token, name]) => [token, (env[name] ?? "").trim()]));
  const pattern = new RegExp(Object.keys(TOKENS).map((t) => t.replace(/[{}]/g, "\\$&")).join("|"), "g");
  const out = html.replace(pattern, (token) => (values[token] !== "" ? escapeHtml(values[token]) : token));
  return { html: out, missing: Object.keys(TOKENS).filter((token) => out.includes(token) && values[token] === "") };
}

/** Drops HTML comments. The source pages keep open review notes in comments, which must not reach the live page. */
export const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
