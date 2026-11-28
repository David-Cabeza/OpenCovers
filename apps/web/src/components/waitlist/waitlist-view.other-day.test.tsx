import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitlistEntry } from "@/lib/api";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { WaitlistView } from "./waitlist-view";

const SEAT_PATH = "/v1/venues/v1/waitlist/w1/seat";
const NOTE = "Only today's waitlist can be seated. This entry is for Saturday, November 28.";

function entry(id: string, name: string, date: string | null): WaitlistEntry {
  return {
    id,
    venueId: "v1",
    partySize: 2,
    zone: "",
    guestName: name,
    guestContact: "",
    status: "waiting",
    reservationId: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    date,
  };
}

// Fourteen hours ahead of UTC, so the venue's date is not the date of whoever runs the tests.
function setup(entries: WaitlistEntry[]) {
  const api = mockApi({
    "GET /v1/venues": { body: { venues: [{ id: "v1", name: "Venue", timezone: "Pacific/Kiritimati", enabled: true, role: "write" }] } },
    "GET /v1/venues/v1/waitlist": { body: { entries } },
    [`POST ${SEAT_PATH}`]: { status: 409, body: { code: "invalid_transition" } },
  });
  renderWithApp(<WaitlistView venueId="v1" />);
  return { api, user: userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) }) };
}

const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const seatOf = (name: string, label = "Seat") => within(rowOf(name)).getByRole("button", { name: label });

describe("seating and the venue's day", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 23:59:00 on Friday 27 in the venue.
    vi.setSystemTime(new Date("2026-11-27T09:59:00Z"));
  });

  afterEach(() => {
    resetApiMocks();
    useUiStore.setState({ locale: "en" });
    vi.useRealTimers();
  });

  it("offers Seat for the venue's today, and says why and which day for another one", async () => {
    const { api, user } = setup([entry("w1", "Marta", "2026-11-28"), entry("w2", "Ana", "2026-11-27"), entry("w3", "Walk", null)]);
    await screen.findByText("Marta");
    await waitFor(() => expect(seatOf("Marta")).toHaveAttribute("aria-disabled", "true"));
    expect(within(rowOf("Marta")).getByText(NOTE)).toBeVisible();
    expect(seatOf("Marta")).toHaveAccessibleDescription(NOTE);
    for (const name of ["Ana", "Walk"]) {
      expect(seatOf(name)).not.toHaveAttribute("aria-disabled");
      expect(within(rowOf(name)).queryByText(/Only today's waitlist/)).not.toBeInTheDocument();
    }

    await user.click(seatOf("Marta"));
    expect(api.calls("POST", SEAT_PATH)).toHaveLength(0);
    // Removing is still on offer.
    expect(within(rowOf("Marta")).getByRole("button", { name: "Remove from the waitlist" })).not.toHaveAttribute("aria-disabled");
  });

  it("says it in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    setup([entry("w1", "Marta", "2026-11-28")]);
    expect(await screen.findByText("Solo se puede sentar la lista de hoy. Esta entrada es para el sábado, 28 de noviembre.")).toBeVisible();
    expect(seatOf("Marta", "Sentar")).toHaveAttribute("aria-disabled", "true");
  });

  it("changes at the venue's midnight on a screen left open, and keeps the focus", async () => {
    setup([entry("w1", "Ana", "2026-11-27")]);
    await screen.findByText("Ana");
    seatOf("Ana").focus();
    expect(seatOf("Ana")).not.toHaveAttribute("aria-disabled");

    await act(() => vi.advanceTimersByTimeAsync(75_000));

    expect(seatOf("Ana")).toHaveAttribute("aria-disabled", "true");
    expect(seatOf("Ana")).toHaveFocus();
    expect(within(rowOf("Ana")).getByText(/Only today's waitlist can be seated/)).toBeVisible();
  });

  it("explains a refusal that arrives because the day has just changed", async () => {
    const { api, user } = setup([entry("w1", "Ana", "2026-11-27")]);
    await screen.findByText("Ana");
    // Past midnight, before the screen has noticed.
    vi.setSystemTime(new Date("2026-11-27T10:00:01Z"));
    await user.click(seatOf("Ana"));
    await waitFor(() => expect(api.calls("POST", SEAT_PATH)).toHaveLength(1));
    expect(await screen.findByText("Only today's waitlist can be seated. This entry is for Friday, November 27.", { selector: "[data-title]" })).toBeInTheDocument();
  });
});
