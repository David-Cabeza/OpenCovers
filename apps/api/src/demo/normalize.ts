// The one spelling of a visitor's address that the demo counts (ADR-0022, decision 8b): rate limits, the one sandbox
// per address rule and the daily caps all key on it.
//
// Rules: Unicode NFKC, trimmed, lower case. For gmail.com and googlemail.com the dots of the local part and the
// `+tag` are removed and the domain becomes gmail.com, because Google delivers all of those spellings to one inbox.
// A `+tag` on any other domain is kept: providers differ (some treat `+` as an ordinary character), so stripping it
// could merge two real people. Aliases on other providers stay bounded by the per-IP limit and the sandbox caps.
//
// An address with whitespace, a comma, a control character, an angle bracket or a quote is refused (null): those
// are how a list of recipients or a header injection hides in one field.

const GMAIL = new Set(["gmail.com", "googlemail.com"]);
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\s,;<>"'\\()[\]\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 254) return null;
  const text = raw.normalize("NFKC").trim().toLowerCase();
  if (text.length === 0 || text.length > 254 || FORBIDDEN.test(text)) return null;
  const parts = text.split("@");
  if (parts.length !== 2) return null;
  let [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length === 0 || !domain.includes(".")) return null;
  if (GMAIL.has(domain)) {
    local = local.split("+")[0]!.replace(/\./g, "");
    domain = "gmail.com";
    if (local.length === 0) return null;
  }
  return `${local}@${domain}`;
}
