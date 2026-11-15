import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PacingView } from "./pacing-view";

function mockPacing(pacing: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ pacing }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PacingView venueId="v1" />
    </QueryClientProvider>,
  );
}

describe("PacingView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows covers against capacity for each slot of a service", async () => {
    const fetchMock = mockPacing([
      {
        service: "dinner",
        slots: [
          { time: "20:00", capacity: 10, covers: 4 },
          { time: "20:15", capacity: 10, covers: 0 },
        ],
      },
    ]);
    renderView();

    expect(await screen.findByText("4/10")).toBeInTheDocument();
    expect(screen.getByText("0/10")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "dinner" })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^\/v1\/venues\/v1\/pacing\?date=\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("tells the host to configure services when there are none", async () => {
    mockPacing([]);
    renderView();

    expect(await screen.findByText("No services configured")).toBeInTheDocument();
  });
});
