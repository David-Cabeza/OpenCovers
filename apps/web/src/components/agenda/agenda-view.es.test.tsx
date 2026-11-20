import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/api";
import { longDate, todayIso } from "@/lib/date";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AgendaView } from "./agenda-view";

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "r1",
    venueId: "v1",
    date: "2026-11-20",
    time: "20:30",
    service: "dinner",
    partySize: 3,
    status: "booked",
    version: 1,
    bookedVia: "staff",
    guest: { name: "Jane Doe", contact: "jane@example.com", consent: "unknown" },
    ...overrides,
  };
}

describe("AgendaView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the agenda, its actions, plurals and the date in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/agenda": { body: { reservations: [reservation()] } },
      "GET /v1/venues/v1/tables": { body: { tables: [] } },
    });
    renderWithApp(<AgendaView venueId="v1" />);

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cliente sin reserva" })).toBeInTheDocument();
    expect(screen.getByText("Reservada")).toBeInTheDocument();
    expect(screen.getByText("1 reserva · 3 cubiertos")).toBeInTheDocument();
    expect(screen.getByText(longDate(todayIso()))).toBeInTheDocument();
    expect(longDate(todayIso())).toContain(" de ");

    await userEvent.setup().click(screen.getByRole("button", { name: "Acciones de la reserva de las 20:30, Jane Doe" }));
    expect(await screen.findByRole("menuitem", { name: "Sentar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Asignar mesas" })).toBeInTheDocument();

    expect(screen.queryByText("Walk-in")).not.toBeInTheDocument();
    expect(screen.queryByText("Booked")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Seat" })).not.toBeInTheDocument();
  });
});
