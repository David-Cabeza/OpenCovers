import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Reservation } from "@/lib/api";
import { longDate } from "@/lib/date";
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
const TABLES_ROUTE = "GET /v1/venues/v1/tables";
const MODIFY = "POST /v1/venues/v1/reservations/r1/modify";
const STATUS = "POST /v1/venues/v1/reservations/r1/status";

const TABLES = [
  { id: "t1", name: "Table 1", seats: 2, zone: "", shape: "rect", posX: 0, posY: 0, rotation: 0 },
  { id: "t2", name: "Table 2", seats: 4, zone: "", shape: "rect", posX: 0, posY: 0, rotation: 0 },
];

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
  const row = (await screen.findByText(guest)).closest("[data-slot=reservation-row]") as HTMLElement;
  await user.click(within(row).getByRole("button"));
}

describe("AgendaView actions", () => {
  afterEach(() => {
    resetApiMocks();
    window.history.replaceState(null, "", "/");
  });

  it("lists the reservations of the day", async () => {
    setup(reservation());

    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("20:30")).toBeInTheDocument();
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("says why a past day takes no new booking", async () => {
    window.history.replaceState(null, "", "/?date=2020-01-01");
    setup(reservation());

    const button = screen.getByRole("button", { name: "New reservation" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("You can't book a past day");
    expect(screen.getByText("You can't book a past day")).toBeVisible();
  });

  it("gives no past-day reason for today", async () => {
    setup(reservation());

    expect(screen.getByRole("button", { name: "New reservation" })).toBeEnabled();
    expect(screen.queryByText("You can't book a past day")).not.toBeInTheDocument();
  });

  it("marks a booking made through the widget as online", async () => {
    setup(reservation({ bookedVia: "widget" }));
    expect(await screen.findByText("Online")).toBeInTheDocument();
  });

  it("shows no online mark on a booking staff made", async () => {
    setup(reservation());
    await screen.findByText("Jane Doe");
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Status changed to Seated")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "Cancel reservation" }));

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

    expect(await screen.findByText("This reservation cannot change to that status right now.")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "Cancel reservation" }));

    expect(await screen.findByText("This reservation is already cancelled.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks before cancelling and writes nothing when the guest is kept", async () => {
    const { api, user } = setup(reservation());
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Cancel this reservation?" })).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Keep reservation" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("offers no status actions for a finished reservation", async () => {
    const { user } = setup(reservation({ status: "attended" }));
    await openRowMenu(user);

    expect(await screen.findByRole("menuitem", { name: "Edit details" })).toBeInTheDocument();
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

  it("opens a new reservation for the agenda day, with a time to set, and the booking joins the list", async () => {
    window.history.replaceState(null, "", "/?date=2030-01-01");
    const created: Reservation[] = [];
    const { api, user } = setup(reservation(), {
      "GET /v1/venues/v1/availability": { body: { availability: { dinner: [{ time: "20:00", available: true, type: "slot" }] } } },
      [TABLES_ROUTE]: { body: { tables: TABLES } },
      "POST /v1/venues/v1/reservations": () => {
        const r = reservation({ id: "r3", time: "20:00", guest: { name: "Pat", consent: "unknown" } });
        created.push(r);
        return { body: r };
      },
      [AGENDA]: () => ({ body: { reservations: [reservation(), ...created] } }),
    });
    await screen.findByText("Jane Doe");

    const primary = screen.getByRole("button", { name: "New reservation" });
    expect(screen.getByRole("button", { name: "Walk-in" })).toHaveClass("border");
    expect(primary).not.toHaveClass("border");
    await user.click(primary);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(new RegExp(longDate("2030-01-01"), "i"))).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Time")).toHaveValue("20:00"));
    await user.type(within(dialog).getByLabelText("Guest name"), "Pat");
    await user.click(within(dialog).getByRole("button", { name: "Create reservation" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ date: "2030-01-01", time: "20:00" });
    expect(api.writes()[0].body).not.toHaveProperty("tables");
    expect(await screen.findByText("Pat")).toBeInTheDocument();
  });

  it("does not offer a new reservation on a past day", async () => {
    window.history.replaceState(null, "", "/?date=2020-01-01");
    setup(reservation());
    await screen.findByText("Jane Doe");

    expect(screen.getByRole("button", { name: "New reservation" })).toBeDisabled();
  });

  it("edits consent, rating and note from the row menu", async () => {
    const { api, user } = setup(reservation({ rating: 3, commentary: "Window" }), {
      "POST /v1/venues/v1/reservations/r1/modify": { body: reservation() },
    });
    await openRowMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Edit details" }));
    await user.clear(await screen.findByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Quiet table");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/r1/modify");
    expect(api.writes()[0].body).toEqual({ commentary: "Quiet table", version: 1 });
  });
});

describe("AgendaView table assignment", () => {
  afterEach(resetApiMocks);

  function setupTables(reservations: Reservation[], extra: Parameters<typeof mockApi>[0] = {}) {
    const api = mockApi({
      [AGENDA]: () => ({ body: { reservations } }),
      [TABLES_ROUTE]: () => ({ body: { tables: TABLES } }),
      ...extra,
    });
    renderWithApp(<AgendaView venueId="v1" />);
    return { api, user: userEvent.setup() };
  }

  const party4 = () => reservation({ partySize: 4, guest: { name: "Ana", consent: "unknown" } });

  it("marks a booking without tables as Unassigned and names the tables of one that has them", async () => {
    setupTables([
      party4(),
      reservation({
        id: "r2",
        time: "21:00",
        guest: { name: "Luis", consent: "unknown" },
        tables: ["t2"],
      }),
    ]);

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(await screen.findByText("Table 2")).toBeInTheDocument();
  });

  it("assigns the chosen tables through modify", async () => {
    const { api, user } = setupTables([party4()], {
      [MODIFY]: { body: reservation({ tables: ["t2"] }) },
    });

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Assign tables" }));
    await user.click(await screen.findByRole("button", { name: /Table 2/ }));
    expect(screen.getByText("4 seats selected for 4 guests.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save tables" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].path).toBe("/v1/venues/v1/reservations/r1/modify");
    expect(api.writes()[0].body).toEqual({ tables: ["t2"], version: 1 });
  });

  it("keeps a half-made selection when the agenda refreshes, and compares it with what it opened with", async () => {
    let stored = reservation({ partySize: 2, guest: { name: "Ana", consent: "unknown" }, tables: ["t1"] });
    const api = mockApi({
      [AGENDA]: () => ({ body: { reservations: [stored] } }),
      [TABLES_ROUTE]: () => ({ body: { tables: TABLES } }),
    });
    const { queryClient } = renderWithApp(<AgendaView venueId="v1" />);
    const user = userEvent.setup();

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Change tables" }));
    await user.click(await screen.findByRole("button", { name: /Table 2/ }));
    stored = { ...stored, version: 2, tables: ["t2"] };
    await queryClient.refetchQueries({ queryKey: ["agenda", "v1"] });

    expect(screen.getByRole("button", { name: /Table 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Table 2/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Table 2/ }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
  });

  it("does not call the API when the selected tables seat fewer guests than the party", async () => {
    const { api, user } = setupTables([party4()]);

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Assign tables" }));
    await user.click(await screen.findByRole("button", { name: /Table 1/ }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));

    expect(screen.getByText("2 seats selected for 4 guests.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it.each([
    ["slot_taken", "One of those tables is already taken at that time. Pick another table."],
    ["no_suitable_table", "Those tables do not fit this party at that time."],
  ])("shows a clear message for %s", async (code, message) => {
    const { user } = setupTables([party4()], {
      [MODIFY]: { status: 409, body: { code, message: code } },
    });

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Assign tables" }));
    await user.click(await screen.findByRole("button", { name: /Table 2/ }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("opens the assign dialog when seating fails with table_required", async () => {
    const { user } = setupTables([party4()], {
      [STATUS]: { status: 409, body: { code: "table_required", message: "table_required" } },
    });

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Seat" }));

    expect(await screen.findByText("Assign a table first.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Assign tables" })).toBeInTheDocument();
  });

  it("shows the friendly message for a refused status change when seating", async () => {
    const { user } = setupTables([party4()], {
      [STATUS]: { status: 409, body: { code: "invalid_transition", message: "x" } },
    });

    await openRowMenu(user, "Ana");
    await user.click(await screen.findByRole("menuitem", { name: "Seat" }));

    expect(await screen.findByText("This reservation cannot change to that status right now.")).toBeInTheDocument();
  });
});

describe("AgendaView overview", () => {
  afterEach(resetApiMocks);

  const reservations = [
    reservation({ id: "a", time: "13:00", service: "lunch", partySize: 2, tables: ["t1"], guest: { name: "Ana", consent: "unknown" } }),
    reservation({ id: "b", time: "20:30", service: "dinner", partySize: 4, guest: { name: "Beto", consent: "unknown" } }),
    reservation({ id: "c", time: "21:00", service: "dinner", partySize: 3, status: "cancelled", guest: { name: "Cris", consent: "unknown" } }),
  ];

  function setupDay() {
    const api = mockApi({
      [AGENDA]: () => ({ body: { reservations } }),
      [TABLES_ROUTE]: () => ({ body: { tables: TABLES } }),
    });
    renderWithApp(<AgendaView venueId="v1" />);
    return { api, user: userEvent.setup() };
  }

  it("summarizes the day without counting cancelled bookings", async () => {
    setupDay();
    await screen.findByText("Ana");
    const stat = (label: string) => screen.getByText(label).nextElementSibling;
    expect(stat("Reservations")).toHaveTextContent("2");
    expect(stat("Covers")).toHaveTextContent("6");
    expect(stat("Needs table")).toHaveTextContent("1");
  });

  it("groups the bookings by service", async () => {
    setupDay();
    await screen.findByText("Ana");
    expect(screen.getByRole("heading", { name: "lunch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "dinner" })).toBeInTheDocument();
  });

  it("moves between days and offers a way back to today", async () => {
    const { api, user } = setupDay();
    await screen.findByText("Ana");
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(await screen.findByRole("button", { name: "Today" })).toBeInTheDocument();
    await waitFor(() => expect(api.calls("GET", "/v1/venues/v1/agenda").length).toBeGreaterThan(1));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument());
  });
});

describe("AgendaView day in the address", () => {
  afterEach(() => {
    resetApiMocks();
  });

  it("opens the day in ?date and writes the new day when navigating", async () => {
    window.history.replaceState(null, "", "/?date=2026-12-06");
    const api = mockApi({ [AGENDA]: () => ({ body: { reservations: [] } }) });
    const user = userEvent.setup();
    renderWithApp(<AgendaView venueId="v1" />);

    await waitFor(() => expect(api.calls("GET", "/v1/venues/v1/agenda")).toHaveLength(1));
    expect(api.calls("GET", "/v1/venues/v1/agenda")[0].path).toContain("date=2026-12-06");

    await user.click(screen.getByRole("button", { name: "Next day" }));

    await waitFor(() => expect(window.location.search).toBe("?date=2026-12-07"));
    await waitFor(() => expect(api.calls("GET", "/v1/venues/v1/agenda").at(-1)?.path).toContain("date=2026-12-07"));
  });
});
