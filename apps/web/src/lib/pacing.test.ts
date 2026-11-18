import { describe, expect, it } from "vitest";
import { pacingLevel, peakSlot } from "./pacing";

const slot = (covers: number, capacity = 10, time = "20:00") => ({ time, covers, capacity });

describe("pacingLevel", () => {
  it("classifies a slot by the share of its capacity that is booked", () => {
    expect(pacingLevel(slot(0))).toBe("empty");
    expect(pacingLevel(slot(4))).toBe("low");
    expect(pacingLevel(slot(5))).toBe("medium");
    expect(pacingLevel(slot(7))).toBe("medium");
    expect(pacingLevel(slot(8))).toBe("high");
    expect(pacingLevel(slot(12))).toBe("high");
  });

  it("treats a slot with no capacity but covers as low rather than dividing by zero", () => {
    expect(pacingLevel(slot(3, 0))).toBe("low");
  });
});

describe("peakSlot", () => {
  it("returns the fullest slot relative to its capacity", () => {
    const peak = peakSlot([slot(4, 10, "20:00"), slot(3, 4, "20:15"), slot(0, 10, "20:30")]);
    expect(peak?.time).toBe("20:15");
  });

  it("returns null when nothing is booked", () => {
    expect(peakSlot([slot(0), slot(0, 10, "20:15")])).toBeNull();
  });
});
