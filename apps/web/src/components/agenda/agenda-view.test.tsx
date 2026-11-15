import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AgendaView } from "./agenda-view";

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
    guest: { name: "Jane Doe", contact: "jane@example.com", consent: "unknown" },
    ...overrides,
  };
}

const AGENDA = "GET /v1/venues/v1/agenda";

function setup(initial: Reservation, extra: Parameters<typeof mockApi>[0] = {}) {
  const state = { current: initial };
  const api = mockApi({
    [AGENDA]: () => ({ body: { reservations: [state.current] } }),
    ...extra,
  });
  renderWithApp(<AgendaView venueId="v1" />);
  return { api, state, user: userEvent.setup() };
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, guest = "Jane Doe") {
  const row = (await screen.findByText(guest)).closest("tr") as HTMLElement;
  await user.click(within(row).getByRole("button"));
}

describe("AgendaView actions", () => {
  afterEach(resetApiMocks);

  it("lists the reservations of the day", async () => {
    setup(reservation());

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("20:30")).toBeInTheDocument();
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("seats a booked reservation and refreshes the list", async () => {
    const { api, state, user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/r1/status": () => {
        state.current = reservation({ status: "seated", version: 2 });
        return { body: state.current };
      },
    });
    await openRowMenu(user);
    const agendaCallsBefore = api.calls("GET", "/v1/venues/v1/agenda").length;

    await user.click(await screen.findByRole("menuitem", { name: "Seat" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/r1/status");
    expect(api.writes()[0].body).toEqual({ status: "seated" });
    expect(api.writes()[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Seated")).toBeInTheDocument();
    expect(api.calls("GET", "/v1/venues/v1/agenda").length).toBeGreaterThan(agendaCallsBefore);
  });

  it("marks a booked reservation as no-show", async () => {
    const { api, state, user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/r1/status": () => {
        state.current = reservation({ status: "no_show", version: 2 });
        return { body: state.current };
      },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "No-show" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ status: "no_show" });
    expect(await screen.findByText("No-show")).toBeInTheDocument();
  });

  it("marks a seated reservation as attended", async () => {
    const { api, state, user } = setup(reservation({ status: "seated" }), {
      "POST /v1/venues/v1/reservations/r1/status": () => {
        state.current = reservation({ status: "attended", version: 3 });
        return { body: state.current };
      },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Mark attended" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ status: "attended" });
    expect(await screen.findByText("Attended")).toBeInTheDocument();
  });

  it("cancels a reservation, confirms it and refreshes the list", async () => {
    const { api, state, user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/r1/cancel": () => {
        state.current = reservation({ status: "cancelled", version: 2 });
        return { body: state.current };
      },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Cancel" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/r1/cancel");
    expect(await screen.findByText("Reservation cancelled")).toBeInTheDocument();
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });

  it("shows the API error when a status change is refused and keeps the row", async () => {
    const { user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/r1/status": {
        status: 409,
        body: { code: "invalid_transition" },
      },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Seat" }));

    expect(await screen.findByText("invalid_transition")).toBeInTheDocument();
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("shows the API error when a cancel is refused", async () => {
    const { user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/r1/cancel": {
        status: 409,
        body: { code: "already_cancelled" },
      },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Cancel" }));

    expect(await screen.findByText("already_cancelled")).toBeInTheDocument();
  });

  it("offers no status actions for a finished reservation", async () => {
    const { user } = setup(reservation({ status: "attended" }));
    await openRowMenu(user);

    expect(await screen.findByRole("menuitem", { name: /Edit consent/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Seat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("opens the walk-in dialog from the agenda and sends the walk-in", async () => {
    const { api, user } = setup(reservation(), {
      "POST /v1/venues/v1/reservations/walk-in": { body: reservation({ id: "r2" }) },
    });
    await screen.findByText("Jane Doe");

    await user.click(screen.getByRole("button", { name: "Walk-in" }));
    await user.type(await screen.findByLabelText("Guest name"), "Sam");
    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/walk-in");
    expect(api.writes()[0].body).toEqual({
      partySize: 2,
      guest: { name: "Sam", consent: "unknown" },
    });
  });

  it("edits consent, rating and note from the row menu", async () => {
    const { api, user } = setup(reservation({ rating: 3, commentary: "Window" }), {
      "POST /v1/venues/v1/reservations/r1/modify": { body: reservation() },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: /Edit consent/ }));
    await user.clear(await screen.findByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Quiet table");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/r1/modify");
    expect(api.writes()[0].body).toEqual({
      guest: { consent: "unknown" },
      rating: 3,
      commentary: "Quiet table",
    });
  });
});
