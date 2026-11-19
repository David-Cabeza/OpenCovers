import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/api";
import type { ReservationTraceDto } from "@/lib/reservation-trace";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AgendaView } from "@/components/agenda/agenda-view";
import { ReservationTraceDialog } from "./reservation-trace-dialog";

const reservation: Reservation = {
  id: "r1",
  venueId: "v1",
  date: "2026-11-20",
  time: "20:30",
  service: "dinner",
  partySize: 2,
  status: "cancelled",
  version: 3,
  bookedVia: "widget",
  guest: { name: "Jane Doe", contact: "jane@example.com", consent: "unknown" },
};

const TRACE = "GET /v1/venues/v1/reservations/r1/trace";

const widgetTrace: ReservationTraceDto = {
  reservationId: "r1",
  source: "widget",
  actor: "widget",
  entries: [
    { eventId: "10", type: "created", version: 1, occurredAt: "2026-11-19T18:00:00.000Z", idempotencyKey: "key-create" },
    { eventId: "11", type: "modified", version: 2, occurredAt: "2026-11-19T18:05:00.000Z", idempotencyKey: "key-modify" },
    { eventId: "12", type: "cancelled", version: 3, occurredAt: "2026-11-19T18:10:00.000Z", idempotencyKey: null },
  ],
};

describe("ReservationTraceDialog", () => {
  afterEach(resetApiMocks);

  it("shows where a booking came from and each event with its version and key", async () => {
    mockApi({ [TRACE]: { body: widgetTrace } });
    renderWithApp(<ReservationTraceDialog venueId="v1" reservation={reservation} onOpenChange={() => {}} />);

    expect(await screen.findByText("Online booking widget")).toBeInTheDocument();
    expect(screen.getByText("A guest, through the widget")).toBeInTheDocument();

    const events = within(screen.getByRole("list", { name: "Events" })).getAllByRole("listitem");
    expect(events).toHaveLength(3);
    expect(within(events[0]).getByText("Booked")).toBeInTheDocument();
    expect(within(events[0]).getByText("Version 1")).toBeInTheDocument();
    expect(within(events[0]).getByText("key-create")).toBeInTheDocument();
    expect(within(events[1]).getByText("Changed")).toBeInTheDocument();
    expect(within(events[2]).getByText("Cancelled")).toBeInTheDocument();
    expect(within(events[2]).queryByText(/Idempotency key/)).not.toBeInTheDocument();
  });

  it("names a staff member as the actor", async () => {
    mockApi({
      [TRACE]: { body: { ...widgetTrace, source: "staff", actor: "chef@example.com", entries: [] } },
    });
    renderWithApp(<ReservationTraceDialog venueId="v1" reservation={reservation} onOpenChange={() => {}} />);

    expect(await screen.findByText("Staff app")).toBeInTheDocument();
    expect(screen.getByText("chef@example.com")).toBeInTheDocument();
    expect(screen.getByText(/No events are kept/)).toBeInTheDocument();
  });

  it("shows an event type it does not know under its own name", async () => {
    mockApi({
      [TRACE]: {
        body: {
          ...widgetTrace,
          entries: [{ eventId: "1", type: "moved", version: 1, occurredAt: "2026-11-19T18:00:00.000Z", idempotencyKey: null }],
        },
      },
    });
    renderWithApp(<ReservationTraceDialog venueId="v1" reservation={reservation} onOpenChange={() => {}} />);

    expect(await screen.findByText("moved")).toBeInTheDocument();
  });

  it("shows a loading state, then an error with a retry that recovers", async () => {
    let calls = 0;
    mockApi({
      [TRACE]: () => (++calls === 1 ? { status: 404, body: { code: "reservation_not_found" } } : { body: widgetTrace }),
    });
    const user = userEvent.setup();
    renderWithApp(<ReservationTraceDialog venueId="v1" reservation={reservation} onOpenChange={() => {}} />);

    expect(screen.getByRole("status", { name: "Loading the trace" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("This reservation no longer exists.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Online booking widget")).toBeInTheDocument();
  });
});

describe("opening the trace from the agenda", () => {
  afterEach(resetApiMocks);

  it("opens the trace of a widget booking from the row menu with the keyboard", async () => {
    const api = mockApi({
      "GET /v1/venues/v1/agenda": { body: { reservations: [reservation] } },
      "GET /v1/venues/v1/tables": { body: { tables: [] } },
      [TRACE]: { body: widgetTrace },
    });
    const user = userEvent.setup();
    renderWithApp(<AgendaView venueId="v1" />);

    const row = (await screen.findByText("Jane Doe")).closest("[data-slot=reservation-row]") as HTMLElement;
    within(row).getByRole("button", { name: "Reservation actions" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "View trace" }));

    const dialog = await screen.findByRole("dialog", { name: "Reservation trace" });
    expect(await within(dialog).findByText("Online booking widget")).toBeInTheDocument();
    expect(api.calls("GET", "/v1/venues/v1/reservations/r1/trace")).toHaveLength(1);
  });
});
