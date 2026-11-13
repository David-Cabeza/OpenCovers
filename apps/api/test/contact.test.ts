import { describe, expect, it } from "vitest";
import { normalizeContact, venueCountry } from "../src/lib/contact";

describe("contact normalization", () => {
  it.each([
    ["eva@example.com", "eva@example.com"],
    ["  Eva@Example.COM \n", "eva@example.com"],
    ["eva.garcia+mesa@example.com", "eva.garcia+mesa@example.com"],
    ["E.V.A@Gmail.com", "e.v.a@gmail.com"],
    ["José@example.com", "josé@example.com"],
    ["JOSÉ@example.com", "josé@example.com"],
  ])("normalizes the email %j", (raw, expected) => {
    expect(normalizeContact(raw, "ES")).toEqual({ kind: "email", value: expected });
  });

  it.each(["@", "eva@", "@example.com", "eva @example.com", "eva@exa mple.com", "a@b@c"])(
    "rejects the malformed email %j",
    (raw) => {
      expect(normalizeContact(raw, "ES")).toBeNull();
    },
  );

  it.each([
    ["+34 600 123 456", "ES", "+34600123456"],
    ["+34600123456", null, "+34600123456"],
    ["600 123 456", "ES", "+34600123456"],
    ["600-12-34-56", "ES", "+34600123456"],
    ["0034 600 123 456", "ES", "+34600123456"],
    ["06 12 34 56 78", "FR", "+33612345678"],
    ["(415) 555-2671", "US", "+14155552671"],
    ["+1 415 555 2671", "ES", "+14155552671"],
  ])("normalizes the phone %j in %s", (raw, country, expected) => {
    expect(normalizeContact(raw, country as "ES" | "FR" | "US" | null)).toEqual({
      kind: "phone",
      value: expected,
    });
  });

  it.each([
    ["600 123 456", null],
    ["(415) 555-2671", "ES"],
    ["1234", "ES"],
    ["call me", "ES"],
    ["call me at 600123456", "ES"],
    ["", "ES"],
    ["   ", "ES"],
    ["+999 123", "ES"],
  ])("does not normalize %j in %s", (raw, country) => {
    expect(normalizeContact(raw, country as "ES" | null)).toBeNull();
  });

  it("uses the venue country, then the country of its time zone", () => {
    expect(venueCountry({ phoneCountry: "FR", timezone: "Europe/Madrid" })).toBe("FR");
    expect(venueCountry({ phoneCountry: null, timezone: "Europe/Madrid" })).toBe("ES");
    expect(venueCountry({ phoneCountry: null, timezone: "America/Mexico_City" })).toBe("MX");
    expect(venueCountry({ phoneCountry: null, timezone: "UTC" })).toBeNull();
  });
});
