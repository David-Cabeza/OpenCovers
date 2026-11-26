import { describe, expect, it } from "vitest";
import { arrowMove } from "./floor-keys";

describe("arrowMove", () => {
  it("moves one grid step per arrow", () => {
    expect(arrowMove("ArrowRight", false, 40, 40)).toEqual({ x: 48, y: 40 });
    expect(arrowMove("ArrowLeft", false, 40, 40)).toEqual({ x: 32, y: 40 });
    expect(arrowMove("ArrowDown", false, 40, 40)).toEqual({ x: 40, y: 48 });
    expect(arrowMove("ArrowUp", false, 40, 40)).toEqual({ x: 40, y: 32 });
  });
  it("moves four steps with Shift", () => {
    expect(arrowMove("ArrowRight", true, 40, 40)).toEqual({ x: 72, y: 40 });
  });
  it("lands on the grid and stays inside the plan", () => {
    expect(arrowMove("ArrowRight", false, 43, 43)).toEqual({ x: 48, y: 43 });
    expect(arrowMove("ArrowLeft", false, 43, 40)).toEqual({ x: 40, y: 40 });
    expect(arrowMove("ArrowLeft", false, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(arrowMove("ArrowUp", true, 8, 8)).toEqual({ x: 8, y: 0 });
  });
  it("ignores other keys", () => {
    expect(arrowMove("a", false, 8, 8)).toBeNull();
  });
});
