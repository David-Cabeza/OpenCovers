import type { MessageId } from "./messages";

// A first check in the browser, so a typo is caught before a challenge is spent. The engine normalizes and
// decides (REQ-G2); this only refuses what it would certainly refuse.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]+$/;

export function emailLooksValid(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL.test(email);
}

export function contactLooksValid(value: string): boolean {
  const contact = value.trim();
  if (contact.length === 0 || contact.length > 254) return false;
  if (contact.includes("@")) return EMAIL.test(contact);
  const digits = contact.replace(/\D/g, "").length;
  return PHONE.test(contact) && digits >= 6 && digits <= 15;
}

/**
 * The errors without the one for a field the guest has just changed, so a message about a typo goes away as soon as the
 * typo is edited and not only at the next submit.
 */
export function withoutError<E extends object>(errors: E, field: keyof E): E {
  const { [field]: _gone, ...rest } = errors;
  return rest as E;
}

export interface DetailErrors {
  name?: MessageId;
  contact?: MessageId;
}

export function checkDetails(name: string, contact: string): DetailErrors {
  const errors: DetailErrors = {};
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) errors.name = "validate.name";
  if (!contactLooksValid(contact)) errors.contact = "validate.contact";
  return errors;
}

export interface WaitlistErrors {
  name?: MessageId;
  email?: MessageId;
  window?: MessageId;
}

/** `HH:MM`, 24 hours, as `<input type="time">` gives it and the contract's `window` writes it. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The waitlist form's first check (ADR-0021 section 3). The contact is an email only: a phone gets its own message,
 * because the join sends an email. The window is both ends or neither, `from` before `to`, so it never crosses midnight.
 */
export function checkWaitlist(name: string, email: string, from: string, to: string): WaitlistErrors {
  const errors: WaitlistErrors = {};
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) errors.name = "validate.name";
  if (!emailLooksValid(email)) {
    errors.email = email.trim() !== "" && !email.includes("@") && contactLooksValid(email) ? "waitlist.phoneRefused" : "validate.email";
  }
  if (from || to) {
    if (!from || !to || !CLOCK.test(from) || !CLOCK.test(to)) errors.window = "waitlist.window.pair";
    else if (from >= to) errors.window = "waitlist.window.order";
  }
  return errors;
}
