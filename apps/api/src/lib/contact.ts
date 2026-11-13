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

export function toCountryCode(value: unknown): CountryCode | null {
  return typeof value === "string" && isSupportedCountry(value) ? value : null;
}

export function venueCountry(venue: {
  phoneCountry: string | null;
  timezone: string;
}): CountryCode | null {
  return toCountryCode(venue.phoneCountry ?? ZONE_COUNTRIES[venue.timezone]);
}
