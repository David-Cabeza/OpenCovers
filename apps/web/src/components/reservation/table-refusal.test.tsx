import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AssignTablesDialog } from "@/components/reservation/assign-tables-dialog";
import { FloorView } from "@/components/floor/floor-view";
import type { FloorTable, Reservation } from "@/lib/api";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks, type MockResponse } from "@/test/mock-api";

const MODIFY = "POST /v1/venues/v1/reservations/r1/modify";
const TABLES = "GET /v1/venues/v1/tables";

const table = (id: string, name: string, zone: string): FloorTable => ({
  id, name, zone, seats: 4, shape: "square", posX: 0, posY: 0, rotation: 0, occupied: false,
});
const ROOM = [table("t1", "Table 1", "indoor"), table("t2", "Table 2", "indoor"), table("t3", "Table 3", "terrace")];

const BOOKING: Reservation = {
  id: "r1",
  venueId: "v1",
  date: "2026-11-30",
  time: "20:30",
  service: "dinner",
  partySize: 4,
  status: "booked",
  version: 3,
  bookedVia: "staff",
  guest: { name: "Ana" },
  zone: "indoor",
  tables: ["t1"],
};

interface Case {
  code: string;
  booking?: Partial<Reservation>;
  /** What the tables read answers. By default the room. */
  tables?: MockResponse;
}

function routes({ code, booking, tables }: Case) {
  const stored = { ...BOOKING, ...booking };
  const plan = ROOM.map((t, i) => ({
    ...t,
    posX: i * 100,
    ...(stored.tables?.includes(t.id) && { occupied: true, reservationId: "r1", guestName: "Ana", partySize: 4 }),
  }));
  mockApi({
    "GET /v1/venues/v1/floor": { body: { tables: plan } },
    "GET /v1/venues/v1/floor-items": { body: { items: [] } },
    "GET /v1/venues/v1/reservations/r1": { body: stored },
    [TABLES]: tables ?? { body: { tables: ROOM } },
    [MODIFY]: { status: code === "invalid_request" ? 400 : 409, body: { code } },
  });
  return stored;
}

async function moveOnPlan(to: string, refusal: Case) {
  routes(refusal);
  renderWithApp(<FloorView venueId="v1" />);
  const node = await screen.findByLabelText(/^Table 1 Ana/);
  act(() => node.focus());
  fireEvent.click(await screen.findByRole("button", { name: /^(Move to…|Mover a…)$/ }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^(Move to|Mover a) ${to}$`) }));
}

async function assign(add: string, refusal: Case) {
  const stored = routes(refusal);
  renderWithApp(<AssignTablesDialog venueId="v1" reservation={stored} onOpenChange={() => {}} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: new RegExp(add) }));
  await user.click(screen.getByRole("button", { name: /^(Save tables|Guardar mesas)$/ }));
}

const GENERIC = "Some of the details are not valid. Check them and try again.";

describe("a refused table change says why and what to do", () => {
  afterEach(() => {
    resetApiMocks();
    useUiStore.setState({ locale: "en" });
  });

  it.each<[string, string, Case, string]>([
    [
      "the table is too small",
      "Table 2",
      { code: "party_size_too_large" },
      "Not moved: that table does not seat the whole party. Pick a bigger one, or join several with Change tables in the Agenda.",
    ],
    [
      "the booking has joined tables and one does not seat it",
      "Table 3",
      { code: "party_size_too_large", booking: { tables: ["t1", "t2"] } },
      "Not moved: this booking has several tables, and the one you picked does not seat the whole party on its own. Use Change tables in the Agenda.",
    ],
    [
      "the table is outside the booking's zone",
      "Table 3",
      { code: "invalid_request" },
      "Not moved: this booking is for the indoor zone and that table is in another. Pick a table in indoor.",
    ],
  ])("on the floor plan when %s", async (_, to, refusal, message) => {
    await moveOnPlan(to, refusal);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each<[string, string, Case]>([
    ["the table is in the booking's zone", "Table 2", { code: "invalid_request" }],
    ["the booking has no zone", "Table 3", { code: "invalid_request", booking: { zone: "" } }],
    ["the booking is seated", "Table 3", { code: "invalid_request", booking: { status: "seated" } }],
    ["the table no longer exists", "Table 3", { code: "invalid_request", tables: { body: { tables: ROOM.slice(0, 1) } } }],
    ["the tables cannot be read", "Table 3", { code: "invalid_request", tables: { status: 500 } }],
  ])("keeps the general text for invalid_request when %s", async (_, to, refusal) => {
    await moveOnPlan(to, refusal);
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect(screen.queryByText(/Not moved/)).not.toBeInTheDocument();
  });

  it.each([
    [
      "the tables do not seat the party",
      "Table 2",
      "party_size_too_large",
      "Not saved: those tables do not seat the whole party. Add a table or pick bigger ones.",
    ],
    [
      "a selected table is outside the zone",
      "Table 3",
      "invalid_request",
      "Not saved: this booking is for the indoor zone. Remove the tables in other zones from the selection: Table 3.",
    ],
  ])("in Change tables when %s", async (_, add, code, message) => {
    await assign(add, { code });
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("keeps the general text in Change tables when every selected table is in the zone", async () => {
    await assign("Table 2", { code: "invalid_request" });
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
  });

  it("shows the seats as they are now after a refusal for seats", async () => {
    let seats = 4;
    mockApi({
      [TABLES]: () => ({ body: { tables: [{ ...ROOM[0], seats }] } }),
      [MODIFY]: () => {
        seats = 2;
        return { status: 409, body: { code: "party_size_too_large" } };
      },
    });
    renderWithApp(<AssignTablesDialog venueId="v1" reservation={{ ...BOOKING, tables: [] }} onOpenChange={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 4" }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));
    expect(await screen.findByRole("button", { name: "Table 1 · 2" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save tables" })).toBeDisabled());
  });

  it.each<[string, string, string[], string]>([
    [
      "party_size_too_large",
      "Table 2",
      ["t1"],
      "No se ha movido: en esa mesa no cabe todo el grupo. Elige una más grande o junta varias con «Cambiar mesas» en la Agenda.",
    ],
    [
      "party_size_too_large",
      "Table 3",
      ["t1", "t2"],
      "No se ha movido: esta reserva tiene varias mesas y en la que has elegido no cabe todo el grupo. Usa «Cambiar mesas» en la Agenda.",
    ],
    [
      "invalid_request",
      "Table 3",
      ["t1"],
      "No se ha movido: esta reserva es de la zona indoor y esa mesa está en otra. Elige una mesa de indoor.",
    ],
  ])("in Spanish on the floor plan (%s, %s)", async (code, to, tables, message) => {
    useUiStore.setState({ locale: "es" });
    await moveOnPlan(to, { code, booking: { tables } });
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    ["party_size_too_large", "Table 2", "No se ha guardado: en esas mesas no cabe todo el grupo. Añade una mesa o elige otras más grandes."],
    [
      "invalid_request",
      "Table 3",
      "No se ha guardado: esta reserva es de la zona indoor. Quita de la selección las mesas de otras zonas: Table 3.",
    ],
  ])("in Spanish in Change tables (%s)", async (code, add, message) => {
    useUiStore.setState({ locale: "es" });
    await assign(add, { code });
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
