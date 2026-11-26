import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorTable, Reservation } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { FloorView } from "./floor-view";

const FLOOR = "GET /v1/venues/v1/floor";
const ITEMS = "GET /v1/venues/v1/floor-items";
const RES = "GET /v1/venues/v1/reservations/r1";

function table(overrides: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    name: "Table 1",
    seats: 2,
    zone: "",
    shape: "round",
    posX: 0,
    posY: 0,
    rotation: 0,
    occupied: false,
    ...overrides,
  };
}

const OCCUPIED = table({ occupied: true, reservationId: "r1", guestName: "Ana", partySize: 4 });

const RESERVATION: Reservation = {
  id: "r1",
  venueId: "v1",
  date: "2026-11-18",
  time: "21:00",
  service: "dinner",
  partySize: 4,
  status: "seated",
  version: 1,
  bookedVia: "phone",
  guest: { name: "Ana Pérez", contact: "ana@example.test", consent: "granted" },
  commentary: "Window seat, birthday",
  reconfirmation: "confirmed",
  tables: ["t1"],
};

function setup(tables: FloorTable[], reservation: { status?: number; body?: unknown } = { body: RESERVATION }) {
  const api = mockApi({
    [FLOOR]: { body: { tables } },
    [ITEMS]: { body: { items: [] } },
    [RES]: reservation,
  });
  renderWithApp(<FloorView venueId="v1" />);
  return { api, user: userEvent.setup() };
}

describe("FloorTableCard", () => {
  afterEach(resetApiMocks);

  it("opens on hover for an occupied table and fetches that reservation", async () => {
    const { api, user } = setup([OCCUPIED]);
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    expect(api.calls("GET", "/v1/venues/v1/reservations/r1")).toHaveLength(0);
    await user.hover(node);
    const card = await screen.findByRole("dialog", { name: "Reservation for Ana" });
    expect(await screen.findByText("ana@example.test")).toBeInTheDocument();
    expect(card).toHaveTextContent("Window seat, birthday");
    expect(card).toHaveTextContent("Seated");
    expect(card).toHaveTextContent("Reconfirmed");
    expect(card).toHaveTextContent("21:00");
    expect(card).toHaveTextContent("phone");
    expect(api.calls("GET", "/v1/venues/v1/reservations/r1")).toHaveLength(1);
    expect(node).not.toHaveAttribute("title");
  });

  it("opens on keyboard focus and Enter moves focus into the card", async () => {
    const { user } = setup([OCCUPIED]);
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    act(() => node.focus());
    expect(node).toHaveFocus();
    const card = await screen.findByRole("dialog");
    expect(node).toHaveAttribute("aria-describedby", card.id);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(node).toHaveFocus();
  });

  it("opens on tap for touch and closes with the close button", async () => {
    setup([OCCUPIED]);
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    fireEvent.pointerDown(node, { pointerType: "touch" });
    fireEvent.click(node);
    await screen.findByRole("dialog");
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(node).toHaveFocus();
  });

  it("shows nothing for a free table and keeps the walk-in button", async () => {
    const { api, user } = setup([table()]);
    const free = await screen.findByRole("button", { name: "Table 1, 2 seats, seat a walk-in" });
    await user.hover(free);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests.filter((r) => r.path.includes("/reservations/"))).toHaveLength(0);
  });

  it("closes when a drag starts and does not reopen while dragging", async () => {
    const { user } = setup([OCCUPIED]);
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    await user.hover(node);
    await screen.findByRole("dialog");
    fireEvent.dragStart(node, { dataTransfer: { setData() {}, effectAllowed: "" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.pointerEnter(node, { pointerType: "mouse" });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.dragEnd(node);
    fireEvent.pointerLeave(node, { pointerType: "mouse" });
    fireEvent.pointerEnter(node, { pointerType: "mouse" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the name and party size at once, with a skeleton while the rest loads", async () => {
    mockApi({
      [FLOOR]: { body: { tables: [OCCUPIED] } },
      [ITEMS]: { body: { items: [] } },
    });
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/reservations/r1") ? new Promise<Response>(() => {}) : base(input, init),
    );
    renderWithApp(<FloorView venueId="v1" />);
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    await userEvent.setup().hover(node);
    const card = await screen.findByRole("dialog");
    expect(card).toHaveTextContent("Ana");
    expect(card).toHaveTextContent("4 guests");
    expect(screen.getByTestId("card-loading")).toBeInTheDocument();
  });

  it("shows a one-line error when the reservation cannot be loaded", async () => {
    const { user } = setup([OCCUPIED], { status: 500, body: { code: "error" } });
    const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
    await user.hover(node);
    expect(await screen.findByText("Could not load the reservation.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Ana");
  });
});
