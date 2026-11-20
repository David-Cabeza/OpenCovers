import { describe, expect, it } from "vitest";
import {
  EMAIL_CATALOGS,
  FALLBACK_EMAIL_LOCALE,
  formatEmailDate,
  message,
  resolveEmailLocale,
  slotNames,
} from "../src/lib/email-messages";
import { buildEmail, buildLinkEmail } from "../src/lib/mailer";
import { LOCALES } from "../src/lib/online-booking";

// Adding a locale later is one entry in EMAIL_CATALOGS: these tests read the shipped set, never a fixed list.
const shipped = Object.keys(EMAIL_CATALOGS);
const unshipped = LOCALES.find((l) => !shipped.includes(l)) ?? "xx";

describe("email catalogs (ADR-0024)", () => {
  it("ship es, and only locales the API accepts", () => {
    expect(shipped).toContain("es");
    expect(LOCALES as readonly string[]).toEqual(expect.arrayContaining(shipped));
  });

  it.each(shipped)("%s has the ids and the slots of es", (locale) => {
    const es = EMAIL_CATALOGS.es;
    const catalog = EMAIL_CATALOGS[locale];
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(es).sort());
    for (const id of Object.keys(es) as (keyof typeof es)[]) {
      expect(catalog[id].trim(), `${locale} ${id}`).not.toBe("");
      expect(slotNames(catalog[id]), `${locale} ${id}`).toEqual(slotNames(es[id]));
    }
  });

  it.each(shipped)("%s has no long dash and no guest name slot outside the notice", (locale) => {
    for (const [id, text] of Object.entries(EMAIL_CATALOGS[locale])) {
      if (id.endsWith(".subject")) expect(text, id).not.toContain("—");
      if (!id.startsWith("notice.")) expect(slotNames(text), id).not.toContain("guestName");
    }
  });
});

describe("resolveEmailLocale", () => {
  it("takes the stored locale when it ships, else the venue's, else es", () => {
    for (const l of shipped) expect(resolveEmailLocale(l, "zz")).toBe(l);
    for (const l of shipped) expect(resolveEmailLocale(unshipped, l)).toBe(l);
    expect(resolveEmailLocale(unshipped, unshipped)).toBe(FALLBACK_EMAIL_LOCALE);
    expect(resolveEmailLocale(null, null)).toBe(FALLBACK_EMAIL_LOCALE);
    expect(resolveEmailLocale(undefined, undefined)).toBe(FALLBACK_EMAIL_LOCALE);
  });

  it("never throws on odd input", () => {
    for (const odd of ["", "__proto__", "constructor", "toString", "en-GB", "EN", "\u0000"]) {
      expect(resolveEmailLocale(odd, odd)).toBe(FALLBACK_EMAIL_LOCALE);
    }
  });

  it("builds emails for a locale without a catalog, in es", () => {
    const c = { date: "2026-12-24", time: "21:00", partySize: 4, guestName: "", service: "" };
    for (const kind of ["confirmation", "cancellation", "notice"] as const) {
      expect(() => buildEmail(kind, c, unshipped)).not.toThrow();
      expect(buildEmail(kind, c, unshipped)).toEqual(buildEmail(kind, c, "es"));
    }
    const lines = [{ date: "2026-12-24", time: "21:00", partySize: 4, url: "https://x.test/r#t" }];
    expect(buildLinkEmail(lines, "__proto__")).toEqual(buildLinkEmail(lines, "es"));
  });
});

describe("formatEmailDate", () => {
  it("keeps the calendar day, whatever the process timezone", () => {
    for (const locale of shipped) {
      const text = formatEmailDate("2026-03-01", locale);
      expect(text).toMatch(/\b1\b/);
      expect(text).toContain("2026");
      expect(formatEmailDate("2026-12-31", locale)).toMatch(/\b31\b/);
      expect(formatEmailDate("2026-01-01", locale)).toMatch(/\b1\b/);
    }
  });

  it("writes es dates in Spanish and never throws", () => {
    expect(formatEmailDate("2026-11-20", "es")).toBe("viernes, 20 de noviembre de 2026");
    expect(formatEmailDate("not a date", "es")).toBe("not a date");
    expect(formatEmailDate("2026-13-45", "es")).toBe("2026-13-45");
    expect(() => formatEmailDate("2026-11-20", "!!bad!!")).not.toThrow();
  });
});

describe("html", () => {
  const c = { date: "2026-12-24", time: "21:00", partySize: 4, guestName: "", service: "", venueName: "Casa" };

  it("carries the catalog heading and footer, and lang is the resolved locale", () => {
    for (const locale of shipped) {
      for (const kind of ["confirmation", "cancellation", "notice"] as const) {
        const { html } = buildEmail(kind, c, locale);
        expect(html).toContain(`<html lang="${locale}">`);
        expect(html).toContain(message(locale, `${kind}.heading`));
        expect(html).toContain(message(locale, "footer"));
      }
      const link = buildLinkEmail([{ date: "2026-12-24", time: "21:00", partySize: 2, url: "https://x.test/r#t" }], locale, "Casa");
      expect(link.html).toContain(`<html lang="${locale}">`);
      expect(link.html).toContain(message(locale, "link.button"));
    }
  });

  it("falls back to es markup for a locale without a catalog", () => {
    expect(buildEmail("confirmation", c, unshipped).html).toBe(buildEmail("confirmation", c, "es").html);
  });
});

describe("message", () => {
  it("fills slots and leaves unknown ones as written", () => {
    expect(message("es", "confirmation.text", { partySize: 2, date: "D", time: "T" })).toBe(
      "Hola, tu reserva para 2 personas el D a las T está confirmada.",
    );
    expect(message("es", "link.booking", { date: "D" })).toContain("{time}");
  });

  it("does not read a typed value as a slot", () => {
    expect(message("es", "notice.text", { partySize: 1, date: "D", time: "T", guestName: "{date}" })).toContain("({date})");
  });
});
