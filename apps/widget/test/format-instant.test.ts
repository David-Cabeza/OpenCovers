import { describe, expect, it } from "vitest";
import { formatInstant } from "../src/dates";

// 06:30 on the machine's own clock, whatever its zone, so the test does not depend on TZ.
const iso = new Date(2026, 10, 22, 6, 30).toISOString();
const evening = new Date(2026, 10, 22, 18, 5).toISOString();

describe("formatInstant", () => {
  it("is 24-hour in English, like the booking time beside it", () => {
    expect(formatInstant(iso, "en")).toMatch(/\b06:30$/);
    expect(formatInstant(iso, "en")).not.toMatch(/AM|PM/i);
    expect(formatInstant(evening, "en")).toMatch(/\b18:05$/);
  });

  it.each(["es", "ca", "fr", "de", "it", "pt"])("is 24-hour in %s", (locale) => {
    const text = formatInstant(evening, locale);
    expect(text).toMatch(/18[:.]05/);
    expect(text).not.toMatch(/AM|PM/i);
  });
});
