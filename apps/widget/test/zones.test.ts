import { describe, expect, it } from "vitest";
import { groupSlots, hasZoneChoice, zonesToShow } from "../src/zones";

describe("zone helpers", () => {
  it("offers a choice only with two or more zones", () => {
    expect(hasZoneChoice(undefined)).toBe(false);
    expect(hasZoneChoice([])).toBe(false);
    expect(hasZoneChoice(["Sala"])).toBe(false);
    expect(hasZoneChoice(["Sala", "Terraza"])).toBe(true);
  });

  it("keeps one flat group when no slot has a service", () => {
    const slots = [{ time: "13:00" }, { time: "14:00", zones: ["Sala"] }];
    expect(groupSlots(slots)).toEqual([{ service: null, slots }]);
  });

  it("groups by service in order of first appearance", () => {
    const slots = [
      { time: "13:00", service: "Comida" },
      { time: "13:30", service: "Comida" },
      { time: "21:00", service: "Cena" },
      { time: "21:30", service: "Cena" },
    ];
    const groups = groupSlots(slots);
    expect(groups.map((g) => g.service)).toEqual(["Comida", "Cena"]);
    expect(groups[1].slots.map((s) => s.time)).toEqual(["21:00", "21:30"]);
  });

  it("shows zones beside a time only while no zone is chosen", () => {
    expect(zonesToShow({ time: "13:00", zones: ["Sala", "Terraza"] }, "")).toEqual(["Sala", "Terraza"]);
    expect(zonesToShow({ time: "13:00", zones: ["Sala"] }, "Sala")).toEqual([]);
    expect(zonesToShow({ time: "13:00" }, "")).toEqual([]);
    expect(zonesToShow({ time: "13:00", zones: [] }, "")).toEqual([]);
  });
});
