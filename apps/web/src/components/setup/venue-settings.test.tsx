import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { Role } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { VenueSettings } from "./venue-settings";

const CONFIG = {
  enabled: true,
  noticeAddress: "owner@example.com",
  notificationsEnabled: true,
  resendConfigured: true,
  fromEmail: "reservas@example.com",
  slotIntervalMinutes: 30,
  leadTimeMinutes: 60,
  lastSeatingOffsetMinutes: 45,
  overbookingCeiling: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(putResponse: () => Response) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return putResponse();
      }
      return json(CONFIG);
    }),
  );
  return puts;
}

function renderSettings(role?: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <VenueSettings venueId="v1" role={role} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function ceilingInput() {
  const input = await screen.findByLabelText("Overbooking ceiling");
  await waitFor(() => expect(screen.getByLabelText("Slot interval")).toHaveValue(30));
  return input;
}

describe("VenueSettings overbooking ceiling", () => {
  afterEach(() => {
    toast.dismiss();
    vi.unstubAllGlobals();
  });

  it("explains the setting in plain words", async () => {
    mockApi(() => json(CONFIG));
    renderSettings("admin");

    await ceilingInput();
    expect(screen.getByText(/without a table at the same time/)).toBeInTheDocument();
    expect(screen.getByText(/0\s+turns overbooking off/)).toBeInTheDocument();
    expect(screen.getByText(/need a table assigned before they can be seated/)).toBeInTheDocument();
    expect(screen.getByText(/Only an admin can change this/)).toBeInTheDocument();
  });

  it("saves the ceiling together with the current values of the other settings", async () => {
    const user = userEvent.setup();
    const puts = mockApi(() => json({ ...CONFIG, overbookingCeiling: 6 }));
    renderSettings("admin");

    const input = await ceilingInput();
    await user.clear(input);
    await user.type(input, "6");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      enabled: true,
      noticeAddress: "owner@example.com",
      notificationsEnabled: true,
      fromEmail: "reservas@example.com",
      slotIntervalMinutes: 30,
      leadTimeMinutes: 60,
      lastSeatingOffsetMinutes: 45,
      overbookingCeiling: 6,
    });
  });

  it("sends 0 when the ceiling is left at its default", async () => {
    const user = userEvent.setup();
    const puts = mockApi(() => json(CONFIG));
    renderSettings("admin");

    await ceilingInput();
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ overbookingCeiling: 0 });
  });

  it.each(["1001", "-1", "2.5", ""])("does not send an invalid ceiling (%s)", async (value) => {
    const user = userEvent.setup();
    const puts = mockApi(() => json(CONFIG));
    renderSettings("admin");

    const input = await ceilingInput();
    await user.clear(input);
    if (value) await user.type(input, value);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      await screen.findByText("The overbooking ceiling must be a whole number from 0 to 1000."),
    ).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it("shows a friendly message when the API answers 403", async () => {
    const user = userEvent.setup();
    mockApi(() => json({ code: "forbidden", message: "forbidden" }, 403));
    renderSettings("admin");

    await ceilingInput();
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("Only an admin can change venue settings.")).toBeInTheDocument();
  });

  it("locks the field for a user who is not an admin", async () => {
    mockApi(() => json(CONFIG));
    renderSettings("write");

    expect(await ceilingInput()).toBeDisabled();
  });
});
