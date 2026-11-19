import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { CATALOG } from "@/i18n/catalog";
import { t } from "@/i18n";
import { authErrorMessage, errorMessage } from "./error-message";

// The documented vocabulary lives in docs/contract/errors.md as "- `code`: ..." bullets.
const errorsDoc = readFileSync(resolve(__dirname, "../../../../docs/contract/errors.md"), "utf8");
const documented = [...errorsDoc.matchAll(/^- `([a-z_]+)`:/gm)].map((m) => m[1] as string);

describe("errorMessage", () => {
  it("reads the documented codes from the contract", () => {
    expect(documented.length).toBeGreaterThan(30);
  });

  it.each(documented)("has a friendly message for %s", (code) => {
    const text = errorMessage(new ApiError(code, 400), "fallback");
    expect(text).not.toBe("fallback");
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toBe(code);
    expect(text).not.toContain("_");
  });

  it("only maps codes the contract documents", () => {
    const mapped = Object.keys(CATALOG.en)
      .filter((key) => key.startsWith("errors.api."))
      .map((key) => key.slice("errors.api.".length));
    for (const code of mapped) expect(documented).toContain(code);
  });

  it("shows a retry-later message for any 429", () => {
    expect(errorMessage(new ApiError("whatever", 429), "x")).toMatch(/try again/i);
  });

  it("falls back for unknown codes and plain errors without leaking them", () => {
    expect(errorMessage(new ApiError("db_exploded", 500), "Could not save.")).toBe("Could not save.");
    expect(errorMessage(new ApiError("__proto__", 500), "Could not save.")).toBe("Could not save.");
    expect(errorMessage(new TypeError("Failed to fetch"), "Could not save.")).toBe("Could not save.");
    expect(errorMessage("boom", "Could not save.")).toBe("Could not save.");
  });
});

describe("authErrorMessage", () => {
  it("maps rate limiting and invitation errors, else falls back", () => {
    expect(authErrorMessage({ status: 429 }, "f")).toMatch(/try again/i);
    expect(authErrorMessage({ code: "INVALID_INVITATION" }, "f")).toBe(t("errors.api.invalid_invitation"));
    expect(authErrorMessage({ status: 401, message: "Invalid email or password" }, "f")).toBe(
      "Invalid email or password",
    );
    expect(authErrorMessage({ status: 400 }, "f")).toBe("f");
    expect(authErrorMessage({ status: 500 }, "f")).toMatch(/not responding/i);
  });
});
