import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../src/lib/online-booking";
import { SELF_SERVICE_TITLES } from "../src/lib/widget-page";

// The locales the API accepts, the `/r` titles and the widget's catalogs are one list (ADR-0017 stage 15).
describe("widget locales", () => {
  it("are the same set in the API, the /r titles and the widget catalogs", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../../widget/src/messages.ts"), "utf8");
    const declared = /export const CATALOGS = \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const catalogs = declared.split(",").map((s) => s.trim()).filter(Boolean);
    expect([...catalogs].sort()).toEqual([...LOCALES].sort());
    const embed = readFileSync(path.resolve(import.meta.dirname, "../../widget/public/embed.js"), "utf8");
    const langs = /var LANGS = \[([^\]]*)\]/.exec(embed)?.[1] ?? "";
    const embedded = langs.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect([...embedded].sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(SELF_SERVICE_TITLES).sort()).toEqual([...LOCALES].sort());
  });
});
