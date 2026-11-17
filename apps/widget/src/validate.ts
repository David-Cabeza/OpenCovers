import type { MessageId } from "./messages";

// A first check in the browser, so a typo is caught before a challenge is spent. The engine normalizes and
// decides (REQ-G2); this only refuses what it would certainly refuse.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]+$/;

export function contactLooksValid(value: string): boolean {
  const contact = value.trim();
  if (contact.length === 0 || contact.length > 254) return false;
  if (contact.includes("@")) return EMAIL.test(contact);
  const digits = contact.replace(/\D/g, "").length;
  return PHONE.test(contact) && digits >= 6 && digits <= 15;
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
