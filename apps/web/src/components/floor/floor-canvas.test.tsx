import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithApp } from "@/test/mock-api";
import { FloorCanvas } from "./floor-canvas";

const table = (shape: string, seats = 6) => ({ id: "t1", name: "T1", seats, shape, posX: 0, posY: 0 });

function face() {
  return screen.getByText("T1").closest(".border-2") as HTMLElement;
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

  it("draws a long table that stretches with its seats up to a limit", () => {
    const { unmount } = renderWithApp(<FloorCanvas tables={[table("long", 4)]} mode="view" />);
    const short = face();
    const shortW = parseFloat(short.style.width);
    expect(shortW).toBeGreaterThan(parseFloat(short.style.height) * 2);
    expect(short.className).toContain("rounded-lg");
    unmount();
    renderWithApp(<FloorCanvas tables={[table("long", 30)]} mode="view" />);
    const longW = parseFloat(face().style.width);
    expect(longW).toBeGreaterThan(shortW);
    expect(longW).toBeLessThanOrEqual(220);
  });

  it("keeps the name of a long table inside it when it is turned on its side", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("long", 6), name: "Mesa larga del fondo", rotation: 90 }]} mode="view" />);
    const name = screen.getByText("Mesa larga del fondo");
    expect(name.className).toContain("truncate");
    expect(parseFloat(name.style.maxWidth)).toBe(36 - 6);
  });

  it("lets the name of a long table use its whole length when it lies flat, in either direction", () => {
    for (const rotation of [0, 180, 20, 360]) {
      const { unmount } = renderWithApp(
        <FloorCanvas tables={[{ ...table("long", 6), name: "Mesa larga", rotation }]} mode="view" />,
      );
      expect(parseFloat(screen.getByText("Mesa larga").style.maxWidth), String(rotation)).toBeGreaterThan(36);
      unmount();
    }
  });

  it("gives a name on a diagonal long table the chord across it, between its depth and its length", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("long", 6), name: "Barra", rotation: 45 }]} mode="view" />);
    const room = parseFloat(screen.getByText("Barra").style.maxWidth);
    expect(room).toBeGreaterThan(36 - 6);
    expect(room).toBeLessThan(110 - 6);
    expect(room).toBeCloseTo(36 / Math.sin(Math.PI / 4) - 6, 2);
  });

  it("leaves the names of other tables to wrap, as before", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("round", 4), name: "Terraza 1" }]} mode="view" />);
    const name = screen.getByText("Terraza 1");
    expect(name.className).not.toContain("truncate");
    expect(name.style.maxWidth).toBe("");
  });
});

