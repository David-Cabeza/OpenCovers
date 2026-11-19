import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";
import { BookingPolicyCard } from "./booking-policy-card";

const CONFIG = { enabled: true, maxAdvanceDays: 90, maxActivePerGuestPerDay: 2, blockedDates: [] };

describe("BookingPolicyCard in Spanish", () => {
  beforeEach(() => {
    useUiStore.setState({ locale: "es" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(CONFIG), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
  });
  afterEach(() => {
    useUiStore.setState({ locale: "en" });
    vi.unstubAllGlobals();
  });

  it("shows the title, the fields and the button in Spanish", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <BookingPolicyCard venueId="v1" role="admin" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Días de antelación")).toBeInTheDocument();
    expect(screen.getByText("Política de reservas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar política de reservas" })).toBeInTheDocument();
    expect(screen.queryByText("Booking policy")).not.toBeInTheDocument();
  });
});
