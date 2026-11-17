import { createHmac } from "node:crypto";
import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { ZONE_COUNTRIES } from "./zone-countries";

export type ContactKey =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string };

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function normalizeContact(
  raw: string,
  defaultCountry: CountryCode | null,
): ContactKey | null {
  if (raw.includes("@")) {
    const email = raw.trim().normalize("NFC").toLowerCase();
    return EMAIL.test(email) ? { kind: "email", value: email } : null;
  }
  const phone = parsePhoneNumberFromString(raw, {
    defaultCountry: defaultCountry ?? undefined,
    extract: false,
  });
  return phone?.isValid() ? { kind: "phone", value: phone.number } : null;
}

declare const blocklistHashBrand: unique symbol;
export type BlocklistHash = string & { readonly [blocklistHashBrand]: true };

export interface BlocklistKey {
  readonly id: string;
  readonly secret: Buffer;
}

export interface BlocklistDigest {
  kind: ContactKey["kind"];
  keyId: string;
  hash: BlocklistHash;
}

export function blocklistKey(secret: Buffer): BlocklistKey {
  const id = createHmac("sha256", secret)
    .update("opencovers-blocklist-key-id")
    .digest("hex")
    .slice(0, 16);
  return { id, secret };
}

/** ADR-0018: HMAC of the normalized contact under a key derived per venue. */
export function blocklistHash(
  key: BlocklistKey,
  venueId: string,
  contact: ContactKey,
): BlocklistDigest {
  const venueKey = createHmac("sha256", key.secret)
    .update(`opencovers-blocklist-v1:${venueId}`)
    .digest();
  const hash = createHmac("sha256", venueKey)
    .update(`${contact.kind}:${contact.value}`)
    .digest("hex") as BlocklistHash;
  return { kind: contact.kind, keyId: key.id, hash };
}

export function toCountryCode(value: unknown): CountryCode | null {
  return typeof value === "string" && isSupportedCountry(value) ? value : null;
}

export function venueCountry(venue: {
  phoneCountry: string | null;
  timezone: string;
}): CountryCode | null {
  return toCountryCode(venue.phoneCountry ?? ZONE_COUNTRIES[venue.timezone]);
}
