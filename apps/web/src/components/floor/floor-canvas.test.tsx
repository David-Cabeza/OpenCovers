import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithApp } from "@/test/mock-api";
import { FloorCanvas, chairPositions, tableSize } from "./floor-canvas";

const table = (shape: string, seats = 6) => ({ id: "t1", name: "T1", seats, shape, posX: 0, posY: 0 });

function face() {
  return screen.getByText("T1").closest("[style*='width']") as HTMLElement;
}

describe("table shapes", () => {
  it("draws an oval table wider than tall, with an elliptical outline", () => {
    renderWithApp(<FloorCanvas tables={[table("oval")]} mode="view" />);
    const el = face();
    expect(parseFloat(el.style.width)).toBeGreaterThan(parseFloat(el.style.height));
    expect(el.className).toContain("rounded-[50%]");
  });

  it("grows an oval table with its seats, up to a limit", () => {
    const { unmount } = renderWithApp(<FloorCanvas tables={[table("oval", 2)]} mode="view" />);
    const small = parseFloat(face().style.width);
    unmount();
    renderWithApp(<FloorCanvas tables={[table("oval", 20)]} mode="view" />);
    const large = parseFloat(face().style.width);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(96);
  });

  it("keeps round tables round", () => {
    renderWithApp(<FloorCanvas tables={[table("round", 4)]} mode="view" />);
    const el = face();
    expect(el.style.width).toBe(el.style.height);
    expect(el.className).toContain("rounded-full");
  });

  it("spaces oval chairs evenly along the outline, with none crowded at the ends", () => {
    for (const seats of [2, 6, 10]) {
      const pts = chairPositions("oval", seats, tableSize("oval", seats));
      expect(pts).toHaveLength(seats);
      const gaps = pts.map((p, i) => {
        const q = pts[(i + 1) % seats]!;
        return Math.hypot(p.x - q.x, p.y - q.y);
      });
      expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.25);
    }
  });
});
