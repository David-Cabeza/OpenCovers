import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { WaitlistEntry } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { WaitlistView } from "./waitlist-view";

function entry(overrides: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "w1",
    venueId: "v1",
    partySize: 2,
    zone: "",
    guestName: "Ana",
    guestContact: "ana@example.com",
    status: "waiting",
    reservationId: null,
    createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
    ...overrides,
  };
}

const LIST = "GET /v1/venues/v1/waitlist";

describe("WaitlistView", () => {
  afterEach(resetApiMocks);

  it("shows the queue oldest first with the totals", async () => {
    mockApi({
      [LIST]: {
        body: {
          entries: [
            entry({ id: "w2", guestName: "Newer", partySize: 4, createdAt: new Date(Date.now() - 5 * 60000).toISOString() }),
            entry({ id: "w1", guestName: "Older", partySize: 3 }),
          ],
        },
      },
    });
    renderWithApp(<WaitlistView venueId="v1" />);
    await screen.findByText("Older");
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Older")).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText("Position 1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Newer")).toBeInTheDocument();
    expect(screen.getByText("Parties").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Guests").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("Longest wait").nextElementSibling).toHaveTextContent("20m");
  });

  it("seats an entry and removes another from the waitlist", async () => {
    const api = mockApi({
      [LIST]: { body: { entries: [entry()] } },
      "POST /v1/venues/v1/waitlist/w1/seat": { body: {} },
      "POST /v1/venues/v1/waitlist/w1/cancel": { body: {} },
    });
    const user = userEvent.setup();
    renderWithApp(<WaitlistView venueId="v1" />);
    await user.click(await screen.findByRole("button", { name: "Seat" }));
    await waitFor(() => expect(api.calls("POST", "/v1/venues/v1/waitlist/w1/seat")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Remove from the waitlist" }));
    expect(api.calls("POST", "/v1/venues/v1/waitlist/w1/cancel")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Remove from waitlist" }));
    await waitFor(() => expect(api.calls("POST", "/v1/venues/v1/waitlist/w1/cancel")).toHaveLength(1));
  });

  it("keeps the entry when the confirmation is declined", async () => {
    const api = mockApi({ [LIST]: { body: { entries: [entry()] } } });
    const user = userEvent.setup();
    renderWithApp(<WaitlistView venueId="v1" />);
    await user.click(await screen.findByRole("button", { name: "Remove from the waitlist" }));
    await user.click(await screen.findByRole("button", { name: "Keep on waitlist" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls("POST", "/v1/venues/v1/waitlist/w1/cancel")).toHaveLength(0);
  });

  it("explains an empty waitlist", async () => {
    mockApi({ [LIST]: { body: { entries: [] } } });
    renderWithApp(<WaitlistView venueId="v1" />);
    expect(await screen.findByText("No one is waiting")).toBeInTheDocument();
  });

  it("shows the date, the window and the online source of a guest's request, and nothing for staff entries", async () => {
    mockApi({
      [LIST]: {
        body: {
          entries: [
            entry({ id: "w1", guestName: "Marta", date: "2030-06-01", windowStart: "20:00", windowEnd: "22:00", source: "widget" }),
            entry({ id: "w2", guestName: "Walk", date: null, windowStart: null, windowEnd: null, source: "staff" }),
          ],
        },
      },
    });
    renderWithApp(<WaitlistView venueId="v1" />);
    await screen.findByText("Marta");
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText(/20:00–22:00/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Online")).toBeInTheDocument();
    expect(rows[0].querySelector("[data-slot=waitlist-date]")).not.toBeNull();
    expect(rows[1].querySelector("[data-slot=waitlist-date]")).toBeNull();
    expect(within(rows[1]).queryByText("Online")).toBeNull();
    expect(within(rows[1]).getByText("Walk")).toBeInTheDocument();
  });

  it("asks for one date when the filter is set, and goes back to the default list", async () => {
    const api = mockApi({ [LIST]: { body: { entries: [entry()] } } });
    const user = userEvent.setup();
    renderWithApp(<WaitlistView venueId="v1" />);
    await screen.findByText("Ana");
    expect(api.requests.at(-1)?.path).toBe("/v1/venues/v1/waitlist");
    await user.type(screen.getByLabelText("Show the waitlist for a date"), "2030-06-01");
    await waitFor(() => expect(api.requests.at(-1)?.path).toBe("/v1/venues/v1/waitlist?date=2030-06-01"));
    await user.click(screen.getByRole("button", { name: "Back to today" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Back to today" })).toBeNull());
  });
});
