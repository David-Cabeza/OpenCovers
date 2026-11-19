import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { longDate, todayIso } from "@/lib/date";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { PreShiftView } from "./pre-shift-view";

const base = {
  venueId: "v1",
  date: "2026-11-20",
  time: "20:30",
  service: "dinner",
  status: "booked",
  version: 1,
  bookedVia: "staff",
};

describe("PreShiftView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the title, stats, consent, large party and waitlist in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/agenda": {
        body: {
          reservations: [
            { ...base, id: "a", partySize: 2, guest: { name: "Ana", consent: "granted" } },
            { ...base, id: "b", partySize: 8, guest: { name: "Grupo", consent: "unknown" } },
          ],
        },
      },
      "GET /v1/venues/v1/tables": { body: { tables: [] } },
      "GET /v1/venues/v1/services": { body: { services: [] } },
      "GET /v1/venues/v1/waitlist": {
        body: {
          entries: [
            { id: "w1", venueId: "v1", partySize: 3, zone: "", guestName: "Luis", status: "waiting", reservationId: null, createdAt: new Date().toISOString() },
          ],
        },
      },
    });
    renderWithApp(<PreShiftView venueId="v1" />);

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Previo al servicio" })).toBeInTheDocument();
    expect(screen.getByText(longDate(todayIso()), { selector: "span.first-letter\\:uppercase" })).toBeInTheDocument();
    expect(screen.getByText("Grupos grandes (6+)")).toBeInTheDocument();
    expect(screen.getByText("Concedido")).toBeInTheDocument();
    expect(screen.getByText("Sin preguntar")).toBeInTheDocument();
    expect(screen.getByText("Lista de espera ahora (1)")).toBeInTheDocument();
    expect(screen.getByText("Grupo de 3")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Pre-shift" })).not.toBeInTheDocument();
    expect(screen.queryByText("Granted")).not.toBeInTheDocument();
  });
});
