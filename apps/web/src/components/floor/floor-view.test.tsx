import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FloorTable } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { FloorView } from "./floor-view";

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

const FLOOR = "GET /v1/venues/v1/floor";
const ITEMS = "GET /v1/venues/v1/floor-items";

function setup(tables: FloorTable[]) {
  mockApi({
    [FLOOR]: { body: { tables } },
    [ITEMS]: { body: { items: [] } },
  });
  renderWithApp(<FloorView venueId="v1" />);
  return userEvent.setup();
}

describe("FloorView", () => {
  afterEach(resetApiMocks);

  it("counts free and occupied tables and the guests seated", async () => {
    setup([
      table(),
      table({ id: "t2", name: "Table 2", posX: 100 }),
      table({
        id: "t3",
        name: "Table 3",
        posX: 200,
        occupied: true,
        reservationId: "r1",
        guestName: "Ana",
        partySize: 4,
      }),
    ]);
    expect(await screen.findByText("4 guests at tables")).toBeInTheDocument();
    expect(screen.getByText("Free").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Occupied").nextElementSibling).toHaveTextContent("1");
  });

  it("seats a walk-in at a free table from the keyboard", async () => {
    const user = setup([table()]);
    const free = await screen.findByRole("button", { name: "Table 1, 2 seats, seat a walk-in" });
    free.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Guest name")).toBeInTheDocument();
  });

  it("does not offer walk-in seating on an occupied table and names who is there", async () => {
    setup([table({ occupied: true, reservationId: "r1", guestName: "Ana", partySize: 2 })]);
    expect(await screen.findByLabelText("Table 1 Ana 2 pax, 2 guests")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Seat a walk-in/ })).not.toBeInTheDocument();
  });

  describe("moving a seated reservation without dragging", () => {
    const seated = table({
      occupied: true,
      reservationId: "r1",
      guestName: "Ana",
      partySize: 4,
    });
    const tables = [
      seated,
      table({ id: "t2", name: "Table 2", seats: 2, posX: 100 }),
      table({ id: "t3", name: "Table 3", seats: 6, posX: 200 }),
      table({ id: "t4", name: "Table 4", seats: 4, posX: 300 }),
    ];
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
      version: 3,
    };

    function setupMove(list: FloorTable[]) {
      const api = mockApi({
        [FLOOR]: { body: { tables: list } },
        [ITEMS]: { body: { items: [] } },
        "GET /v1/venues/v1/reservations/r1": { body: RESERVATION },
        "POST /v1/venues/v1/reservations/r1/modify": { body: RESERVATION },
      });
      renderWithApp(<FloorView venueId="v1" />);
      return { api, user: userEvent.setup() };
    }

    async function openMove() {
      const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
      act(() => node.focus());
      fireEvent.click(await screen.findByRole("button", { name: "Move to…" }));
    }

    it("opens from the card's Move to… button and lists free tables that fit first", async () => {
      setupMove(tables);
      await openMove();
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Move Ana")).toBeInTheDocument();
      const names = within(dialog)
        .getAllByRole("button", { name: /^Move to / })
        .map((b) => b.getAttribute("aria-label"));
      expect(names).toEqual(["Move to Table 4", "Move to Table 3", "Move to Table 2"]);
      expect(within(dialog).getByText("2 seats, too small")).toBeInTheDocument();
    });

    it("opens after a tap on a touch screen", async () => {
      setupMove(tables);
      const node = await screen.findByLabelText("Table 1 Ana 4 pax, 4 guests");
      fireEvent.pointerDown(node, { pointerType: "touch" });
      fireEvent.click(node);
      fireEvent.click(await screen.findByRole("button", { name: "Move to…" }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("moves the reservation to the chosen table and closes", async () => {
      const { api, user } = setupMove(tables);
      await openMove();
      await user.click(await screen.findByRole("button", { name: "Move to Table 3" }));
      await waitFor(() =>
        expect(api.calls("POST", "/v1/venues/v1/reservations/r1/modify")).toHaveLength(1),
      );
      expect(api.calls("POST", "/v1/venues/v1/reservations/r1/modify")[0].body).toEqual({
        tables: ["t3"],
        version: 3,
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("says so when no table is free", async () => {
      setupMove([seated, table({ id: "t2", name: "Table 2", occupied: true, reservationId: "r2" })]);
      await openMove();
      expect(await screen.findByText("There are no free tables right now.")).toBeInTheDocument();
    });

    it("does not offer Move to… on a free table", async () => {
      const { user } = setupMove(tables);
      await user.click(await screen.findByRole("button", { name: "Table 2, 2 seats, seat a walk-in" }));
      expect(await screen.findByLabelText("Guest name")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Move to…" })).not.toBeInTheDocument();
    });
  });

  it("shows the empty state when there are no tables", async () => {
    setup([]);
    expect(await screen.findByText("No tables yet")).toBeInTheDocument();
  });
});
