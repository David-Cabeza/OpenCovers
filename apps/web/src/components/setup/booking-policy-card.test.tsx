import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { Role } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { BookingPolicyCard } from "./booking-policy-card";

const CONFIG = {
  enabled: true,
  maxAdvanceDays: 90,
  maxActivePerGuestPerDay: 2,
  blockedDates: [
    { from: "2026-12-24", to: "2026-12-26" },
    { from: "2027-03-01", to: "2027-03-01" },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(putResponse: (body: Record<string, unknown>) => Response = (b) => json({ ...CONFIG, ...b })) {
  const puts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return putResponse(body);
      }
      return json(CONFIG);
    }),
  );
  return puts;
}

function renderCard(role?: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <BookingPolicyCard venueId="v1" role={role} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function loaded() {
  const advance = await screen.findByLabelText("Advance days");
  await waitFor(() => expect(advance).toHaveValue("90"));
  return advance;
}

describe("BookingPolicyCard", () => {
  afterEach(() => {
    toast.dismiss();
    vi.unstubAllGlobals();
  });

  it("loads the current values, with blocked dates as days and ranges", async () => {
    mockApi();
    renderCard("admin");

    await loaded();
    expect(screen.getByLabelText("Bookings per guest per day")).toHaveValue("2");
    expect(screen.getByLabelText("Blocked dates")).toHaveValue("2026-12-24..2026-12-26\n2027-03-01");
  });

  it("saves edited values with the blocked dates sorted and merged", async () => {
    const user = userEvent.setup();
    const puts = mockApi();
    renderCard("admin");

    const advance = await loaded();
    await user.clear(advance);
    await user.type(advance, "30");
    const blocked = screen.getByLabelText("Blocked dates");
    await user.clear(blocked);
    await user.type(blocked, "2026-12-26,2026-12-25");
    await user.click(screen.getByRole("button", { name: "Save booking policy" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      maxAdvanceDays: 30,
      maxActivePerGuestPerDay: 2,
      blockedDates: [{ from: "2026-12-25", to: "2026-12-26" }],
    });
    expect(await screen.findByText("Booking policy saved")).toBeInTheDocument();
  });

  it("clears each rule when its field is emptied", async () => {
    const user = userEvent.setup();
    const puts = mockApi();
    renderCard("admin");

    const advance = await loaded();
    await user.clear(advance);
    await user.clear(screen.getByLabelText("Bookings per guest per day"));
    await user.clear(screen.getByLabelText("Blocked dates"));
    await user.click(screen.getByRole("button", { name: "Save booking policy" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ maxAdvanceDays: null, maxActivePerGuestPerDay: null, blockedDates: [] });
  });

  it("rejects out-of-range input in the form and sends nothing", async () => {
    const user = userEvent.setup();
    const puts = mockApi();
    renderCard("admin");

    const advance = await loaded();
    await user.clear(advance);
    await user.type(advance, "1001");
    const blocked = screen.getByLabelText("Blocked dates");
    await user.clear(blocked);
    await user.type(blocked, "2026-02-30");
    await user.click(screen.getByRole("button", { name: "Save booking policy" }));

    expect(await screen.findByText(/Advance days must be a whole number from 0 to 1000/)).toBeInTheDocument();
    expect(screen.getByText(/"2026-02-30" is not a valid date/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it("shows the API error message when the save fails", async () => {
    const user = userEvent.setup();
    mockApi(() => json({ code: "invalid_request", message: "bad" }, 400));
    renderCard("admin");

    await loaded();
    await user.click(screen.getByRole("button", { name: "Save booking policy" }));

    expect(
      await screen.findByText("Some of the details are not valid. Check them and try again."),
    ).toBeInTheDocument();
  });

  it("is read-only for a role that is not admin", async () => {
    mockApi();
    renderCard("write");

    const advance = await loaded();
    expect(advance).toBeDisabled();
    expect(screen.getByLabelText("Bookings per guest per day")).toBeDisabled();
    expect(screen.getByLabelText("Blocked dates")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save booking policy" })).not.toBeInTheDocument();
  });
});
