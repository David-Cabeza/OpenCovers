import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longDate, todayIso } from "@/lib/date";
import { useUiStore } from "@/stores/ui-store";
import { PacingView } from "./pacing-view";

describe("PacingView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the title, the peak, the legend and the date in Spanish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ pacing: [{ service: "dinner", slots: [{ time: "20:00", capacity: 10, covers: 4 }] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PacingView venueId="v1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Máximo 4/10 a las 20:00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ritmo" })).toBeInTheDocument();
    expect(screen.getByText(longDate(todayIso()))).toBeInTheDocument();
    expect(screen.getByText("menos del 50%")).toBeInTheDocument();
    expect(screen.getByTitle("20:00 — 4/10 cubiertos")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Pacing" })).not.toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });
});
