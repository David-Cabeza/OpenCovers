import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reservation, Table } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AssignTablesDialog } from "./assign-tables-dialog";

const MODIFY = "POST /v1/venues/v1/reservations/r1/modify";
const TABLES = "GET /v1/venues/v1/tables";

const table = (id: string, name: string): Table => ({ id, name, seats: 2 }) as Table;
const ROOM = [table("t1", "Table 1"), table("t2", "Table 2"), table("t3", "Table 3")];

const RESERVATION: Reservation = {
  id: "r1",
  venueId: "v1",
  date: "2026-11-20",
  time: "20:30",
  service: "dinner",
  partySize: 2,
  status: "booked",
  version: 1,
  bookedVia: "staff",
  guest: { name: "Jane Doe", contact: "jane@example.com", consent: "unknown" },
  tables: ["t1", "t2"],
};

function setup(reservation: Reservation = RESERVATION) {
  // The booking as the server holds it, which another person can move while this dialog is open.
  const stored = { tables: reservation.tables ?? [] };
  const api = mockApi({
    [TABLES]: { body: { tables: ROOM } },
    [MODIFY]: (req) => {
      stored.tables = (req.body as { tables: string[] }).tables;
      return { body: { ...reservation, ...stored } };
    },
  });
  const onOpenChange = vi.fn();
  renderWithApp(<AssignTablesDialog venueId="v1" reservation={reservation} onOpenChange={onOpenChange} />);
  return { api, stored, onOpenChange, user: userEvent.setup() };
}

const press = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name: new RegExp(name) }));

describe("AssignTablesDialog", () => {
  afterEach(resetApiMocks);

  it.each([
    ["nothing was touched", []],
    ["the same tables were picked again in another order", ["Table 1", "Table 1"]],
  ])("closes without a write or a success message when %s", async (_, presses) => {
    const { api, onOpenChange, user } = setup();
    await screen.findByRole("button", { name: /Table 1/ });

    for (const name of presses) await press(user, name);
    await press(user, "Save tables");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.writes()).toHaveLength(0);
    expect(screen.queryByText("Tables assigned")).not.toBeInTheDocument();
  });

  it("does not undo a move another person made while it was open", async () => {
    const { stored, onOpenChange, user } = setup();
    await screen.findByRole("button", { name: /Table 1/ });

    stored.tables = ["t3"];
    await press(user, "Save tables");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(stored.tables).toEqual(["t3"]);
  });

  it.each([
    ["a table is added", ["Table 3"], ["t1", "t2", "t3"]],
    ["a table is removed", ["Table 2"], ["t1"]],
    ["a table is swapped", ["Table 2", "Table 3"], ["t1", "t3"]],
  ])("sends the selection when %s", async (_, presses, tables) => {
    const { api, user } = setup();
    await screen.findByRole("button", { name: /Table 1/ });

    for (const name of presses) await press(user, name);
    await press(user, "Save tables");

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ tables });
  });

  it("cannot save a booking that has no tables until one is picked", async () => {
    const { user } = setup({ ...RESERVATION, tables: undefined });
    await screen.findByRole("button", { name: /Table 1/ });

    expect(screen.getByRole("button", { name: "Save tables" })).toBeDisabled();
    await press(user, "Table 1");
    expect(screen.getByRole("button", { name: "Save tables" })).toBeEnabled();
  });
});
