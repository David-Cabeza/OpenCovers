import { describe, expect, it } from "vitest";
import { toEpoch } from "../src/time";

describe("time", () => {
  it("converts wall-clock time in a timezone to epoch", () => {
    expect(toEpoch("2026-01-15", "12:00", "Europe/Madrid")).toBe(
      toEpoch("2026-01-15", "11:00", "UTC"),
    );
  });

  it("uses UTC by default", () => {
    expect(toEpoch("2026-01-15", "12:00")).toBe(
      toEpoch("2026-01-15", "12:00", "UTC"),
    );
  });

  it("handles daylight saving time", () => {
    expect(toEpoch("2026-07-15", "12:00", "Europe/Madrid")).toBe(
      toEpoch("2026-07-15", "10:00", "UTC"),
    );
  });
});
