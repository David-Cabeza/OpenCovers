// Disposable email domains the demo refuses (ADR-0022, decision 8b). The list is `disposable-domains.txt` next to
// this file, vendored from a maintained CC0 source with its commit and date in the header. It stops throwaway
// inboxes, not a determined person; the per-address, per-IP and sandbox limits do the rest.
import { readFileSync } from "node:fs";
import { normalizeEmail } from "./normalize";

const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(
  readFileSync(new URL("./disposable-domains.txt", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "" && !line.startsWith("#")),
);

/**
 * True when the address's domain, or a parent of it (`a.b.mailinator.com`), is on the list. The domain is read the way
 * the demo counts addresses (Unicode and trailing dot folded), so `MAILINATOR.com.` and an IDN spelling match too.
 */
export function isDisposableEmail(email: string): boolean {
  const domain = (normalizeEmail(email) ?? email.trim().toLowerCase()).split("@").pop() ?? "";
  if (domain === "") return false;
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
