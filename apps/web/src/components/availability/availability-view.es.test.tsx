import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { longDate, todayIso } from "@/lib/date";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AvailabilityView } from "./availability-view";

describe("AvailabilityView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the title, the plural subtitle, the slot count and the date in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/availability": {
        body: {
          availability: {
            dinner: [
              { time: "20:00", available: true, type: "standard" },
              { time: "20:15", available: false, type: "standard" },
            ],
          },
        },
      },
      "GET /v1/venues/v1/tables": { body: { tables: [] } },
    });
    renderWithApp(<AvailabilityView venueId="v1" />);

    expect(await screen.findByRole("heading", { name: "dinner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Disponibilidad" })).toBeInTheDocument();
    expect(screen.getByText(/Elige una hora libre para reservar mesa para 2 comensales\./)).toBeInTheDocument();
    expect(screen.getByText(longDate(todayIso()))).toBeInTheDocument();
    expect(screen.getByText("1 de 2 libres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Más comensales" })).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Availability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More guests" })).not.toBeInTheDocument();
  });
});
