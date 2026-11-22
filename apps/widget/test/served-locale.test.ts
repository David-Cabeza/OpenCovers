import { describe, expect, it } from "vitest";
import { servedLocale } from "../src/messages";

describe("servedLocale", () => {
  it("keeps the ?lang the server served the page in", () => {
    expect(servedLocale("en", "en")).toBe("en");
    expect(servedLocale("es-ES", "es")).toBe("es");
  });

  it("drops a ?lang the server did not accept, such as French in the demo", () => {
    expect(servedLocale("fr", "es")).toBeNull();
    expect(servedLocale("de", "en")).toBeNull();
  });

  it("is null without ?lang or with an unknown code", () => {
    expect(servedLocale(null, "es")).toBeNull();
    expect(servedLocale("xx", "es")).toBeNull();
  });
});
