import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { WaitlistView } from "./waitlist-view";

describe("WaitlistView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the queue, its actions and the elapsed time in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/waitlist": {
        body: {
          entries: [
            {
              id: "w1",
              venueId: "v1",
              partySize: 2,
              zone: "",
              guestName: "Ana",
              guestContact: "",
              status: "waiting",
              reservationId: null,
              createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
            },
          ],
        },
      },
    });
    renderWithApp(<WaitlistView venueId="v1" />);

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lista de espera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sentar" })).toBeInTheDocument();
    expect(screen.getByText("Comensales").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Espera más larga").nextElementSibling).toHaveTextContent("20 min");
    expect(screen.getByText("Grupo de 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Posición 1")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Waitlist" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seat" })).not.toBeInTheDocument();
  });
});
