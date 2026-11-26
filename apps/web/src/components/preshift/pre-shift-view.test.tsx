import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/api";
import type { Dietary } from "@/lib/dietary";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { PreShiftView } from "./pre-shift-view";

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "r1",
    venueId: "v1",
    date: "2026-11-20",
    time: "20:30",
    service: "dinner",
    partySize: 2,
    status: "booked",
    version: 1,
    bookedVia: "staff",
    guest: { name: "Jane Doe", contact: "jane@example.com", consent: "granted" },
    ...overrides,
  };
}

function setup(reservations: Reservation[], waitlist: unknown[] = []) {
  mockApi({
    "GET /v1/venues/v1/agenda": { body: { reservations } },
    "GET /v1/venues/v1/tables": { body: { tables: [] } },
    "GET /v1/venues/v1/services": { body: { services: [] } },
    "GET /v1/venues/v1/waitlist": { body: { entries: waitlist } },
  });
  renderWithApp(<PreShiftView venueId="v1" />);
}

describe("PreShiftView", () => {
  afterEach(resetApiMocks);

  it("summarizes the shift and flags large parties and notes", async () => {
    setup([
      reservation({ id: "a", guest: { name: "Ana", consent: "granted" }, commentary: "Nut allergy" }),
      reservation({ id: "b", time: "21:00", partySize: 8, guest: { name: "Big Group", consent: "unknown" } }),
      reservation({ id: "c", status: "cancelled", guest: { name: "Gone", consent: "unknown" } }),
    ]);
    await screen.findByText("Ana");
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(screen.getByText("Reservations").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Covers").nextElementSibling).toHaveTextContent("10");
    expect(screen.getByText("Large parties (6+)").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("With notes").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("8 large")).toBeInTheDocument();
    expect(screen.getByText("Nut allergy")).toBeInTheDocument();
  });

  it("counts the bookings marked as allergy, among the upcoming ones only, on screen and on the printed line", async () => {
    const dietary = (value: Partial<Dietary>): Dietary => ({
      allergens: [],
      diets: [],
      note: "",
      consented: true,
      recordedAt: "2026-11-20T10:00:00Z",
      recordedBy: null,
      ...value,
    });
    setup([
      reservation({ id: "a", guest: { name: "Ana", consent: "unknown" }, dietary: dietary({ allergens: ["peanuts"] }) }),
      reservation({ id: "b", status: "seated", dietary: dietary({ note: "intolerance to onion" }) }),
      reservation({ id: "c", dietary: dietary({ diets: ["vegan"] }) }),
      reservation({ id: "d", status: "cancelled", dietary: dietary({ allergens: ["milk"] }) }),
      reservation({ id: "e" }),
    ]);
    await screen.findByText("Ana");
    expect(screen.getByText("With allergies").nextElementSibling).toHaveTextContent(/^2$/);
    expect(screen.getByText(/With allergies: 2/)).toBeInTheDocument();
  });

  it("shows no allergy figure when no booking is marked, so it never reads as no allergies", async () => {
    setup([reservation()]);
    await screen.findByText("Jane Doe");
    expect(screen.getByText("With notes")).toBeInTheDocument();
    expect(screen.queryByText(/With allergies/)).not.toBeInTheDocument();
  });

  it("marks a booking without tables as unassigned and shows the reconfirmation state", async () => {
    setup([reservation({ reconfirmation: "declined" })]);
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
  });

  it("lists who is on the waitlist now", async () => {
    setup(
      [reservation()],
      [{ id: "w1", venueId: "v1", partySize: 3, zone: "Patio", guestName: "Waiting Wes", guestContact: "", status: "waiting", reservationId: null, createdAt: new Date().toISOString() }],
    );
    expect(await screen.findByText("Waitlist now (1)")).toBeInTheDocument();
    expect(screen.getByText("Party of 3 · Patio")).toBeInTheDocument();
  });

  it("says when nobody is expected", async () => {
    setup([]);
    expect(await screen.findByText("Nobody expected")).toBeInTheDocument();
  });

  it("can move to the next day", async () => {
    setup([reservation()]);
    await screen.findByText("Jane Doe");
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(await screen.findByRole("button", { name: "Today" })).toBeInTheDocument();
  });
});
