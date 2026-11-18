import { describe, expect, it } from "vitest";
import { elapsed, shiftIso } from "./date";

describe("shiftIso", () => {
  it("crosses month and year boundaries", () => {
    expect(shiftIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIso("2026-03-29", 1)).toBe("2026-03-30");
  });
});

describe("elapsed", () => {
  it("shortens a wait to minutes, hours or days", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const ago = (min: number) => new Date(now - min * 60000).toISOString();
    expect(elapsed(ago(0), now)).toBe("<1m");
    expect(elapsed(ago(12), now)).toBe("12m");
    expect(elapsed(ago(65), now)).toBe("1h 5m");
    expect(elapsed(ago(120), now)).toBe("2h");
    expect(elapsed(ago(60 * 49), now)).toBe("2d");
    expect(elapsed(ago(-5), now)).toBe("<1m");
  });
});
