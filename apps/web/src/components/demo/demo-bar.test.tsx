import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { DemoBar } from "./demo-bar";

const status = {
  enabled: true,
  googleEnabled: false,
  venueId: "v1",
  bookingKey: "pk_abcdefghijklmnopqrstuv",
  expiresAt: "2026-12-03T10:00:00.000Z",
};

const reservation = (over: Record<string, unknown>) => ({
  id: "r1",
  venueId: "v1",
  date: "2026-11-20",
  time: "20:00",
  service: "dinner",
  partySize: 2,
  status: "booked",
  version: 1,
  bookedVia: "widget",
  guest: { name: "Ana" },
  ...over,
});

function search(reservations: unknown[]) {
  mockApi({ "GET /v1/venues/v1/reservations/search": { body: { reservations } } });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApiMocks);

describe("the demo bar", () => {
  it("shows the expiry date, a deploy link, and a Diner link that opens the widget in a new tab", async () => {
    search([]);
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText(/deleted on 3 December 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deploy it yourself" })).toHaveAttribute("href", expect.stringContaining("deploy"));
    const diner = screen.getByRole("link", { name: /Diner/ });
    expect(diner).toHaveAttribute("href", "/w/pk_abcdefghijklmnopqrstuv");
    expect(diner).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Restaurant")).toHaveAttribute("aria-current", "true");
  });

  it("lists the tour without a trace step, and ticks steps from real bookings", async () => {
    search([reservation({ id: "a" }), reservation({ id: "b", status: "cancelled" })]);
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (2 of 3 done)")).toBeInTheDocument();
    expect(screen.queryByText(/trace/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not count a booking staff made as the diner's", async () => {
    search([reservation({ bookedVia: "staff" })]);
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (0 of 3 done)")).toBeInTheDocument();
  });

  it("keeps the manual tick for finding the booking in the agenda, and remembers it", async () => {
    search([]);
    const user = userEvent.setup();
    const first = renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(screen.getByText("Take the tour (1 of 3 done)")).toBeInTheDocument();
    first.unmount();
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText("Take the tour (1 of 3 done)")).toBeInTheDocument();
  });

  it("works when the browser refuses storage", async () => {
    search([]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(screen.getByText("Take the tour (1 of 3 done)")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("collapses the checklist", async () => {
    search([]);
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getByRole("button", { name: /Take the tour/ }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
