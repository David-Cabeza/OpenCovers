import { screen } from "@testing-library/react";
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
    const free = await screen.findByRole("button", { name: "Seat a walk-in at Table 1" });
    free.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Guest name")).toBeInTheDocument();
  });

  it("does not offer walk-in seating on an occupied table and names who is there", async () => {
    setup([table({ occupied: true, reservationId: "r1", guestName: "Ana", partySize: 2 })]);
    expect(await screen.findByLabelText("Table 1: Ana, 2 guests")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Seat a walk-in/ })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no tables", async () => {
    setup([]);
    expect(await screen.findByText("No tables yet")).toBeInTheDocument();
  });
});
