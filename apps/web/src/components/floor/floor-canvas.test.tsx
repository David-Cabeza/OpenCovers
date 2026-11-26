import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("gives a name on a diagonal long table less than the chord across it, so its corners stay inside", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("long", 6), name: "Barra", rotation: 45 }]} mode="view" />);
    const room = parseFloat(screen.getByText("Barra").style.maxWidth);
    expect(room).toBeGreaterThan(36 - 6);
    expect(room).toBeLessThan(36 / Math.sin(Math.PI / 4) - 6);
  });

  it("lets the name of a free table take two lines at most, inside the table, and keeps it whole in a tooltip", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("square", 2), name: "Terraza fondo 1" }]} mode="view" />);
    const name = screen.getByText("Terraza fondo 1");
    expect(name.className).toContain("line-clamp-2");
    expect(name).toHaveAttribute("title", "Terraza fondo 1");
    expect(parseFloat(name.style.maxWidth)).toBe(52 - 6);
  });

  it("keeps the name of an occupied table on one line, over the guest and the party size", () => {
    renderWithApp(
      <FloorCanvas
        tables={[{ ...table("round", 4), name: "Reservado VIP", occupied: true, guestName: "Dan", partySize: 3 }]}
        mode="view"
      />,
    );
    const name = screen.getByText("Reservado VIP");
    expect(name.className).toContain("truncate");
    expect(parseFloat(name.style.maxWidth)).toBeLessThan(58);
    expect(screen.getByText("Dan").className).toContain("truncate");
    expect(screen.getByText("3 pax")).toBeInTheDocument();
  });

  it("shows no placeholder line on an occupied table without a guest name", () => {
    renderWithApp(<FloorCanvas tables={[{ ...table("square", 2), occupied: true, partySize: 2 }]} mode="view" />);
    expect(screen.getByText("2 pax")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("draws a table saved as rect as a rectangle", () => {
    renderWithApp(<FloorCanvas tables={[table("rect")]} mode="view" />);
    const el = face();
    expect(el.style.width).toBe("64px");
    expect(el.style.height).toBe("46px");
  });
});

describe("a plan wider than the screen", () => {
  const wide = [
    { id: "a", name: "A", seats: 2, shape: "square", posX: 0, posY: 0 },
    { id: "b", name: "B", seats: 2, shape: "square", posX: 896, posY: 0 },
  ];
  // The plan is 896 + 80 + 24 = 1000 px wide.
  function frameOf(width: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly cb: () => void) {}
        observe() {
          this.cb();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is left alone when it fits", () => {
    frameOf(1200);
    renderWithApp(<FloorCanvas tables={wide} mode="view" />);
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("");
    expect(screen.queryByRole("button", { name: "Real size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
  });

  it("is shrunk to fit a tablet, and can be put back at its real size", async () => {
    frameOf(800);
    const user = userEvent.setup();
    renderWithApp(<FloorCanvas tables={wide} mode="view" />);
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("scale(0.8)");
    expect(screen.getByText("Whole plan, at 80%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Real size" }));
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("");
    expect(screen.getByTestId("floor-canvas").style.minWidth).toBe("1000px");
    expect(screen.getByText("Scroll sideways for the rest")).toBeInTheDocument();
  });

  it("opens at its real size on a phone, where shrinking would make it unreadable, and can show the whole plan", async () => {
    frameOf(350);
    const user = userEvent.setup();
    renderWithApp(<FloorCanvas tables={wide} mode="view" />);
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("");
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("scale(0.35)");
  });

  it("moves a table by the distance on the plan, not on the screen, while it is shrunk", () => {
    frameOf(500);
    Element.prototype.setPointerCapture = vi.fn();
    const onTableUpdate = vi.fn();
    renderWithApp(<FloorCanvas tables={wide} mode="edit" onTableUpdate={onTableUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByTestId("floor-canvas").style.transform).toBe("scale(0.5)");
    const node = screen.getByText("A").closest(".cursor-move") as HTMLElement;
    fireEvent.pointerDown(node, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node, { clientX: 50, clientY: 30 });
    fireEvent.pointerUp(node);
    expect(onTableUpdate).toHaveBeenCalledWith("a", { x: 80, y: 40 });
  });
});

describe("editing room elements", () => {
  const item = { id: "i1", type: "bar", label: "Bar", posX: 40, posY: 40, width: 160, height: 48 };

  it("resizes an element from its corner without moving it", () => {
    Element.prototype.setPointerCapture = vi.fn();
    const onItemUpdate = vi.fn();
    renderWithApp(<FloorCanvas tables={[]} items={[item]} mode="edit" onItemUpdate={onItemUpdate} />);
    const handle = screen.getByTitle("Resize");
    fireEvent.pointerDown(handle, { clientX: 200, clientY: 88 });
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 104 });
    fireEvent.pointerUp(handle);
    expect(onItemUpdate).toHaveBeenCalledTimes(1);
    expect(onItemUpdate).toHaveBeenCalledWith("i1", { width: 200, height: 64 });
  });
});

describe("editing from the keyboard", () => {
  const tbl = { id: "t3", name: "Mesa 3", seats: 4, posX: 40, posY: 40 };
  const item = { id: "i1", type: "bar", label: "Bar", posX: 40, posY: 40, width: 160, height: 48 };

  it("makes each table and element a named tab stop and names its handles", () => {
    renderWithApp(<FloorCanvas tables={[tbl]} items={[item]} mode="edit" />);
    for (const name of ["Mesa 3", "Bar"]) expect(screen.getByRole("group", { name }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Rotate Mesa 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rotate Bar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Bar" })).toBeTruthy();
  });

  it("moves a table one grid step with an arrow, four with Shift, and says where it went", () => {
    const onTableUpdate = vi.fn();
    renderWithApp(<FloorCanvas tables={[tbl]} mode="edit" onTableUpdate={onTableUpdate} />);
    const node = screen.getByRole("group", { name: "Mesa 3" });
    fireEvent.keyDown(node, { key: "ArrowRight" });
    expect(onTableUpdate).toHaveBeenLastCalledWith("t3", { x: 48, y: 40 });
    fireEvent.keyDown(node, { key: "ArrowDown", shiftKey: true });
    expect(onTableUpdate).toHaveBeenLastCalledWith("t3", { x: 48, y: 72 });
    expect(screen.getByRole("status").textContent).toBe("Mesa 3: position 48, 72");
  });

  it("moves an element the same way and ignores keys pressed on its handles", () => {
    const onItemUpdate = vi.fn();
    renderWithApp(<FloorCanvas tables={[]} items={[item]} mode="edit" onItemUpdate={onItemUpdate} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Rotate Bar" }), { key: "ArrowLeft" });
    expect(onItemUpdate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("group", { name: "Bar" }), { key: "ArrowLeft" });
    expect(onItemUpdate).toHaveBeenCalledWith("i1", { x: 32, y: 40 });
  });

  it("leaves view mode alone", () => {
    renderWithApp(<FloorCanvas tables={[tbl]} mode="view" />);
    expect(screen.queryByRole("group", { name: "Mesa 3" })).toBeNull();
  });
});

describe("text on a small or shrunk table", () => {
  /** Draws one table on a plan shrunk to `scale`: the table plus the margin is 104 px wide. */
  function shrunk(scale: number, extra: object) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly cb: () => void) {}
        observe() {
          this.cb();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(Math.ceil(104 * scale));
    renderWithApp(<FloorCanvas tables={[{ ...table("square", 2), name: "Terraza 1", ...extra }]} mode="view" />);
    const showAll = screen.queryByRole("button", { name: "Show all" });
    if (showAll) fireEvent.click(showAll);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shortens the name of a free table and keeps the whole one for screen readers and the tooltip", () => {
    shrunk(0.7, {});
    expect(screen.getByText("T1")).toHaveAttribute("title", "Terraza 1");
    expect(screen.getByText("T1")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Terraza 1, 2 seats, seat a walk-in" })).toBeInTheDocument();
  });

  it("drops the guest before the party size, and still names the guest", () => {
    shrunk(0.7, { occupied: true, guestName: "Dan", partySize: 2 });
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("2 pax")).toBeInTheDocument();
    expect(screen.queryByText("Dan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terraza 1 Dan 2 pax, 2 guests" })).toBeInTheDocument();
  });

  it("keeps only the short name on a tiny table", () => {
    shrunk(0.3, { occupied: true, guestName: "Dan", partySize: 2 });
    expect(screen.getByText("T1")).toHaveAttribute("title", "Terraza 1");
    expect(screen.queryByText("2 pax")).not.toBeInTheDocument();
  });
});
