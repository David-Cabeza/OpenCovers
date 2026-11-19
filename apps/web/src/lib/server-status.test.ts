import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { authErrorMessage } from "@/lib/error-message";
import { t } from "@/i18n";
import { isServerUnreachable } from "@/lib/server-status";

describe("isServerUnreachable", () => {
  it("is true for what browsers throw when no answer comes back", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "Network request failed"]) {
      expect(isServerUnreachable(new TypeError(message)), message).toBe(true);
    }
  });

  it("is true for a gateway error and for a server error with no body of ours", () => {
    for (const status of [502, 503, 504]) expect(isServerUnreachable(new ApiError("transient", status)), String(status)).toBe(true);
    expect(isServerUnreachable(new ApiError("error", 500))).toBe(true);
    expect(isServerUnreachable(new ApiError("error", 501))).toBe(true);
  });

  it("is false when the server answered, whatever it said", () => {
    expect(isServerUnreachable(new ApiError("slot_taken", 409))).toBe(false);
    expect(isServerUnreachable(new ApiError("unauthorized", 401))).toBe(false);
    expect(isServerUnreachable(new ApiError("rate_limited", 429))).toBe(false);
    expect(isServerUnreachable(new ApiError("transient", 500))).toBe(false);
    expect(isServerUnreachable(new ApiError("error", 404))).toBe(false);
  });

  it("is false for other errors and for values that are not errors", () => {
    expect(isServerUnreachable(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isServerUnreachable(new Error("Failed to fetch"))).toBe(false);
    for (const value of [undefined, null, "Failed to fetch", { status: 502 }]) expect(isServerUnreachable(value)).toBe(false);
  });
});

describe("authErrorMessage for a server error", () => {
  it("says the server is not responding for any 5xx, whatever message came with it", () => {
    expect(authErrorMessage({ status: 502 }, "Could not sign in.")).toBe(t("errors.serverError"));
    expect(authErrorMessage({ status: 500, message: "boom at db.ts:12" }, "Could not sign in.")).toBe(t("errors.serverError"));
  });

  it("keeps the other answers as they were", () => {
    expect(authErrorMessage({ status: 401, message: "Invalid email or password" }, "x")).toBe("Invalid email or password");
    expect(authErrorMessage({ status: 400 }, "Could not sign in.")).toBe("Could not sign in.");
    expect(authErrorMessage(null, "Could not sign in.")).toBe("Could not sign in.");
  });
});
