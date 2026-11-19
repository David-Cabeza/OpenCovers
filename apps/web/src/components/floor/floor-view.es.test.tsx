import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FloorTable } from "@/lib/api";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { FloorView } from "./floor-view";

function table(overrides: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    name: "Mesa 1",
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

const FLOOR = "GET /v1/venues/v1/floor";
const ITEMS = "GET /v1/venues/v1/floor-items";
const RESERVATION = {
  id: "r1",
  guest: { name: "Ana", contact: "ana@example.com" },
  partySize: 4,
  date: "2026-11-18",
  time: "20:00",
  service: "dinner",
  status: "booked",
  tables: ["t1"],
  bookedVia: "staff",
};

describe("FloorView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the title, the counts and the free table name for a screen reader", async () => {
    mockApi({
      [FLOOR]: {
        body: {
          tables: [
            table(),
            table({ id: "t3", name: "Mesa 3", posX: 200, occupied: true, reservationId: "r1", guestName: "Ana", partySize: 4 }),
          ],
        },
      },
      [ITEMS]: { body: { items: [] } },
    });
    renderWithApp(<FloorView venueId="v1" />);
    expect(await screen.findByRole("heading", { name: "Plano de sala" })).toBeInTheDocument();
    expect(await screen.findByText("4 comensales en mesas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mesa 1, 2 plazas, sentar a un cliente sin reserva" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mesa 3: Ana, 4 comensales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ambiente" })).toBeInTheDocument();
    expect(screen.queryByText("Floor plan")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /walk-in/ })).not.toBeInTheDocument();
  });

  it("says there are no tables", async () => {
    mockApi({ [FLOOR]: { body: { tables: [] } }, [ITEMS]: { body: { items: [] } } });
    renderWithApp(<FloorView venueId="v1" />);
    expect(await screen.findByText("Aún no hay mesas")).toBeInTheDocument();
    expect(screen.queryByText("No tables yet")).not.toBeInTheDocument();
  });

  it("opens the table card and the move dialog in Spanish", async () => {
    mockApi({
      [FLOOR]: {
        body: {
          tables: [
            table({ occupied: true, reservationId: "r1", guestName: "Ana", partySize: 4 }),
            table({ id: "t2", name: "Mesa 2", seats: 2, posX: 100 }),
            table({ id: "t3", name: "Mesa 3", seats: 6, posX: 200 }),
          ],
        },
      },
      [ITEMS]: { body: { items: [] } },
      "GET /v1/venues/v1/reservations/r1": { body: RESERVATION },
    });
    renderWithApp(<FloorView venueId="v1" />);
    const node = await screen.findByLabelText("Mesa 1: Ana, 4 comensales");
    act(() => node.focus());
    const card = await screen.findByRole("dialog", { name: "Reserva de Ana" });
    expect(await within(card).findByText("Cuándo")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Mover a…" }));
    const dialog = await screen.findByRole("dialog", { name: "Mover a Ana" });
    expect(within(dialog).getByText("Ahora en Mesa 1, 4 comensales. Elige una mesa libre.")).toBeInTheDocument();
    expect(within(dialog).getByText("2 plazas, demasiado pequeña")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mover a Mesa 3" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Pick a free table/)).not.toBeInTheDocument();
  });
});
