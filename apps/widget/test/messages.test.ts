import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bookingKeyFrom, selfServiceUrl } from "../src/api";
import { explain } from "../src/errors";
import { formatDate } from "../src/dates";
import { CATALOGS, localeOf, supportedLocale, translator } from "../src/messages";
import { contactLooksValid } from "../src/validate";

// Every public error code of docs/contract/errors.md a widget call can get.
const PUBLIC_CODES = [
  "invalid_request",
  "venue_not_found",
  "rate_limited",
  "slot_taken",
  "no_suitable_table",
  "outside_hours",
  "lead_time_violation",
  "beyond_booking_horizon",
  "date_blocked",
  "party_size_too_large",
  "party_size_too_small",
  "guest_booking_limit",
  "online_booking_limit",
  "booking_declined",
];

describe("error messages", () => {
  it("gives every public error code a message in every locale", () => {
    for (const code of PUBLIC_CODES) {
      const { message } = explain({ kind: "error", code, retryable: false });
      for (const catalog of Object.values(CATALOGS)) expect(catalog[message]).toBeTruthy();
    }
    expect(explain({ kind: "network" }).message).toBe("error.network");
  });

  it("answers a declined contact exactly as an unexpected failure, so blocking is not revealed", () => {
    const declined = explain({ kind: "error", code: "booking_declined", retryable: false });
    expect(declined).toEqual(explain({ kind: "error", code: "something_new", retryable: false }));
    expect(declined).toEqual(explain({ kind: "error", code: "unknown", retryable: true }));
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog[declined.message]).not.toMatch(/bloque|block|declin|rechaz|lista|list/i);
    }
  });

  it("sends the guest back to the times when the chosen time is gone", () => {
    for (const code of ["slot_taken", "outside_hours", "lead_time_violation", "date_blocked"]) {
      expect(explain({ kind: "error", code, retryable: false }).back).toBe("time");
    }
  });
});

describe("message catalog", () => {
  it("holds the same ids with the same slots in every locale", () => {
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const ids = Object.keys(CATALOGS.es);
    for (const catalog of Object.values(CATALOGS)) {
      expect(Object.keys(catalog).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        expect(slots(catalog[id as keyof typeof catalog])).toEqual(slots(CATALOGS.es[id as keyof typeof CATALOGS.es]));
      }
    }
  });

  it("picks the locale from <html lang> and fills slots", () => {
    expect(localeOf("en")).toBe("en");
    expect(localeOf("en-GB")).toBe("en");
    expect(localeOf("fr")).toBe("fr");
    expect(localeOf("PT-br")).toBe("pt");
    expect(translator("en")("times.none", { n: 4 })).toBe("No free times left that day for 4 guests. Try another day.");
  });
});

describe("locale fallback", () => {
  it("falls back from an unknown lang to the venue locale, then to es", () => {
    // main.tsx reads <html lang>, which the API set from a supported `?lang=`, else the venue's locale.
    const choose = (lang: string | null, venue: string | null) =>
      supportedLocale(lang) ?? supportedLocale(venue) ?? "es";
    expect(choose("de", "fr")).toBe("de");
    expect(choose("xx", "fr")).toBe("fr");
    expect(choose("xx", "yy")).toBe("es");
    expect(choose(null, null)).toBe("es");
    expect(localeOf("xx")).toBe("es");
    expect(localeOf("")).toBe("es");
    expect(localeOf(undefined)).toBe("es");
    expect(localeOf("constructor")).toBe("es");
  });

  it("formats dates with Intl in the locale's own language", () => {
    for (const locale of Object.keys(CATALOGS)) expect(formatDate("2026-12-25", locale)).toMatch(/25/);
    expect(formatDate("2026-12-25", "de")).toMatch(/Freitag/);
    expect(formatDate("2026-12-25", "fr")).toMatch(/vendredi/);
  });
});

describe("guest-facing rules", () => {
  it("reads the booking key from the page path", () => {
    expect(bookingKeyFrom("/w/pk_AAAAAAAAAAAAAAAAAAAAAA")).toBe("pk_AAAAAAAAAAAAAAAAAAAAAA");
    expect(bookingKeyFrom("/w/")).toBeNull();
    expect(bookingKeyFrom("/r")).toBeNull();
  });

  it("puts the self-service token in the fragment, never in the path or query", () => {
    const url = new URL(selfServiceUrl("https://book.example.com", "abc.def"));
    expect(url.pathname).toBe("/r");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#abc.def");
  });

  it("checks a contact as an email or a phone before spending a challenge", () => {
    for (const ok of ["ana@example.com", "+34 600 123 456", "(91) 555-12-34"]) expect(contactLooksValid(ok)).toBe(true);
    for (const bad of ["", "ana", "ana@", "12345", "call me", "+34 600 123 456 789 012 3"]) {
      expect(contactLooksValid(bad)).toBe(false);
    }
  });

  it("writes nothing to the console and asks for no allergy field", () => {
    const dir = path.resolve(import.meta.dirname, "../src");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/console\.|localStorage|sessionStorage|document\.cookie/);
    }
    expect(JSON.stringify(CATALOGS)).not.toMatch(/"field\.allerg|"field\.diet/);
  });
});
