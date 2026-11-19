import { describe, expect, it } from "vitest";
import { AREAS, CATALOG, type MessageKey } from "./catalog";
import type { Message } from "./define";
import { translateIn } from "./index";
import { detectLocale, isLocale } from "./locales";

const placeholders = (m: Message): string[] =>
  [...new Set(Object.values(typeof m === "string" ? { m } : m).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1] as string)))].sort();

describe("the catalog", () => {
  const areas = Object.entries(AREAS);

  it("has no key twice across the areas", () => {
    const seen = new Map<string, string>();
    for (const [area, { en }] of areas) {
      for (const key of Object.keys(en)) {
        expect(seen.get(key), `${key} is in ${seen.get(key)} and in ${area}`).toBeUndefined();
        seen.set(key, area);
      }
    }
  });

  it("starts each key with the name of its area", () => {
    for (const [area, { en }] of areas) {
      for (const key of Object.keys(en)) expect(key.startsWith(`${area}.`), `${key} in ${area}`).toBe(true);
    }
  });

  it("has the same keys in every language", () => {
    for (const [area, { en, es }] of areas) {
      expect(Object.keys(es).sort(), area).toEqual(Object.keys(en).sort());
    }
  });

  it("has no empty text, and the same placeholders and the same kind of message in every language", () => {
    for (const key of Object.keys(CATALOG.en) as MessageKey[]) {
      const en = CATALOG.en[key];
      const es = CATALOG.es[key];
      expect(typeof es, `${key}: a plural in one language is a plural in the other`).toBe(typeof en);
      for (const m of [en, es]) {
        for (const text of typeof m === "string" ? [m] : [m.one, m.other]) expect(text.trim(), key).not.toBe("");
      }
      expect(placeholders(es), `${key}: placeholders`).toEqual(placeholders(en));
    }
  });

  it("does not leave most of the Spanish identical to the English", () => {
    const same = (Object.keys(CATALOG.en) as MessageKey[]).filter((key) => {
      const en = CATALOG.en[key];
      const es = CATALOG.es[key];
      return JSON.stringify(en) === JSON.stringify(es) && /[a-z]{3,}/i.test(JSON.stringify(en));
    });
    // Some words are the same in both (Email, Pacing, Webhook). A pile of them means a screen was never translated.
    expect(same.length, same.join(", ")).toBeLessThan(Object.keys(CATALOG.en).length * 0.08);
  });
});

describe("translateIn", () => {
  it("fills placeholders and leaves an unknown one as written", () => {
    expect(translateIn("en", "common.partyOf", { count: 4 })).toBe("Party of 4");
    expect(translateIn("es", "common.partyOf", { count: 4 })).toBe("Grupo de 4");
    expect(translateIn("en", "common.partyOf")).toBe("Party of {count}");
  });

  it("picks the plural form of the language", () => {
    expect(translateIn("en", "common.guests", { count: 1 })).toBe("1 guest");
    expect(translateIn("en", "common.guests", { count: 3 })).toBe("3 guests");
    expect(translateIn("es", "common.guests", { count: 1 })).toBe("1 comensal");
    expect(translateIn("es", "common.guests", { count: 0 })).toBe("0 comensales");
    expect(translateIn("es", "common.guests", { count: 2 })).toBe("2 comensales");
  });

  it("falls back to English and then to the key, so a gap shows and does not crash", () => {
    expect(translateIn("es", "nope.nothing" as MessageKey)).toBe("nope.nothing");
  });
});

describe("the language to start in", () => {
  it("takes the first language of the browser that the app has", () => {
    expect(detectLocale(["en-GB", "es"])).toBe("en");
    expect(detectLocale(["fr-FR", "es-MX", "en"])).toBe("es");
    expect(detectLocale(["ES"])).toBe("es");
  });

  it("is Spanish when the browser has none of ours", () => {
    expect(detectLocale(["fr-FR", "de"])).toBe("es");
    expect(detectLocale([])).toBe("es");
  });

  it("knows which values are languages", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
