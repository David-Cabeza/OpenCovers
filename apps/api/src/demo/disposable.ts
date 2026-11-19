// Disposable email domains the demo refuses (ADR-0022, decision 8). A short list kept in the repository on
// purpose: it stops the common throwaway inboxes, not a determined person. Add a domain when one shows up.
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "trashmail.com",
  "trashmail.net",
  "trash-mail.com",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "mytemp.email",
  "emailondeck.com",
  "burnermail.io",
  "spamgourmet.com",
  "moakt.com",
  "mohmal.com",
  "tmpmail.org",
  "tmpmail.net",
  "discard.email",
  "discardmail.com",
  "mailcatch.com",
  "inboxbear.com",
  "33mail.com",
  "dropmail.me",
  "emailfake.com",
  "fakemail.net",
  "mail.tm",
  "tempr.email",
  "spambox.us",
  "mailforspam.com",
]);

/** True when the address's domain, or a parent of it (`a.mailinator.com`), is on the deny list. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (domain === "") return false;
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
