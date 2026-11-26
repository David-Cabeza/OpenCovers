import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { NewReservationDialog } from "./new-reservation-dialog";
import { ReservationTraceDialog } from "./reservation-trace-dialog";
import { WalkInDialog } from "./walk-in-dialog";
import type { Reservation } from "@/lib/api";

const TABLES = [
  { id: "t1", name: "Mesa 1", seats: 2, zone: "main", shape: "round", posX: 0, posY: 0, rotation: 0 },
  { id: "t2", name: "Mesa 2", seats: 4, zone: "main", shape: "round", posX: 0, posY: 0, rotation: 0 },
];

describe("reservation dialogs in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("new reservation: title, labels, plural summary and validation message", async () => {
    mockApi({ "GET /v1/venues/v1/tables": { body: { tables: TABLES } } });
    const user = userEvent.setup();
    renderWithApp(
      <NewReservationDialog venueId="v1" date="2026-11-20" time="20:30" partySize={2} open onOpenChange={vi.fn()} />,
    );
    expect(await screen.findByText("Nueva reserva")).toBeInTheDocument();
    expect(screen.getByText("viernes, 20 de noviembre a las 20:30")).toBeInTheDocument();
    expect(screen.queryByText(/2026-11-20/)).toBeNull();
    expect(await screen.findByRole("radio", { name: "Automática" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Elegir mesa" }));
    expect(screen.getByText("Seleccionado: 0 plazas para 2 comensales.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Mesa 2 · 4" }));
    expect(screen.getByText("Seleccionado: 4 plazas para 2 comensales.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Tamaño del grupo"));
    await user.click(screen.getByRole("button", { name: "Crear reserva" }));
    expect(await screen.findByText("Indica el tamaño del grupo.")).toBeInTheDocument();
    expect(screen.queryByText("New reservation")).not.toBeInTheDocument();
    expect(screen.queryByText("Party size is required.")).not.toBeInTheDocument();
  });

  it("walk-in: title at a table and the consent options", async () => {
    mockApi({});
    renderWithApp(<WalkInDialog venueId="v1" open onOpenChange={vi.fn()} tableId="t1" tableName="Mesa 1" />);
    expect(await screen.findByText("Sentar en Mesa 1")).toBeInTheDocument();
    expect(screen.getByText("Sienta en Mesa 1 a un cliente que acaba de llegar.")).toBeInTheDocument();
    expect(screen.getByLabelText("Consentimiento de contacto")).toHaveTextContent("Sin preguntar");
    expect(screen.queryByText("Seat at Mesa 1")).not.toBeInTheDocument();
  });

  it("trace: channel, actor and event labels", async () => {
    const reservation = {
      id: "r1", venueId: "v1", date: "2026-11-20", time: "20:30", service: "dinner", partySize: 2,
      status: "cancelled", version: 3, bookedVia: "widget",
      guest: { name: "Jane Doe", contact: "jane@example.com", consent: "unknown" },
    } as Reservation;
    mockApi({
      "GET /v1/venues/v1/reservations/r1/trace": {
        body: {
          reservationId: "r1",
          entries: [
            { eventId: "10", type: "created", version: 1, occurredAt: "2026-11-19T18:00:00.000Z", idempotencyKey: null, channel: "widget", actor: null, recorded: true },
            { eventId: "11", type: "modified", version: 2, occurredAt: "2026-11-19T18:01:00.000Z", idempotencyKey: null, channel: "mcp", actor: "key_0123456789ab", recorded: true },
            { eventId: "12", type: "modified", version: 3, occurredAt: "2026-11-19T18:02:00.000Z", idempotencyKey: null, channel: "staff", actor: null, recorded: true },
            { eventId: "13", type: "cancelled", version: 4, occurredAt: "2026-11-19T18:03:00.000Z", idempotencyKey: null, channel: null, actor: null, recorded: false },
          ],
        },
      },
    });
    renderWithApp(<ReservationTraceDialog venueId="v1" reservation={reservation} onOpenChange={() => {}} />);
    expect(await screen.findByText("Widget de reservas en línea")).toBeInTheDocument();
    expect(screen.getByText(/Un cliente, desde el widget/)).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText(/Clave de API key_0123456789ab/)).toBeInTheDocument();
    expect(screen.getByText(/Miembro del equipo/)).toBeInTheDocument();
    expect(screen.getByText("Origen desconocido")).toBeInTheDocument();
    expect(screen.getByText("Reservada")).toBeInTheDocument();
    expect(screen.getByText("Versión 1")).toBeInTheDocument();
    expect(screen.queryByText("Online booking widget")).not.toBeInTheDocument();
  });
});
