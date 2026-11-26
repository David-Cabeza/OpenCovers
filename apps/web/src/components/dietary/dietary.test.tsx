import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaView } from "@/components/agenda/agenda-view";
import { FloorView } from "@/components/floor/floor-view";
import { NavigationProvider } from "@/components/layout/navigation";
import { PreShiftView } from "@/components/preshift/pre-shift-view";
import { EditReservationDialog } from "@/components/reservation/edit-reservation-dialog";
import { NewReservationDialog } from "@/components/reservation/new-reservation-dialog";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import type { Reservation, Role } from "@/lib/api";
import type { Dietary } from "@/lib/dietary";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import type { ReactElement } from "react";

const DIETARY: Dietary = {
  allergens: ["peanuts", "milk"],
  diets: ["vegan"],
  note: "intolerance to onion",
  consented: true,
  recordedAt: "2026-11-20T10:00:00Z",
  recordedBy: "Jane Staff",
};

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
    guest: { name: "Ana", consent: "unknown" },
    commentary: "",
    ...overrides,
  };
}

const CONFIG = "GET /v1/venues/v1/config";
const MODIFY = "POST /v1/venues/v1/reservations/r1/modify";
const MODIFY_PATH = "/v1/venues/v1/reservations/r1/modify";
const CREATE = "POST /v1/venues/v1/reservations";
const WALK_IN = "POST /v1/venues/v1/reservations/walk-in";

function setup(
  ui: ReactElement,
  { role = "write", enabled = true, routes = {} }: { role?: Role; enabled?: boolean; routes?: Parameters<typeof mockApi>[0] } = {},
) {
  const api = mockApi({
    [CONFIG]: { body: { dietaryEnabled: enabled } },
    [MODIFY]: { body: reservation() },
    [CREATE]: { body: reservation() },
    [WALK_IN]: { body: reservation() },
    "GET /v1/venues/v1/tables": { body: { tables: [] } },
    ...routes,
  });
  const { queryClient } = renderWithApp(<NavigationProvider value={{ goTo: () => {}, role }}>{ui}</NavigationProvider>);
  return { api, queryClient, user: userEvent.setup() };
}

const agendaRoute = (...reservations: Reservation[]) => ({ "GET /v1/venues/v1/agenda": { body: { reservations } } });

const row = async (guest = "Ana") => (await screen.findByText(guest)).closest("li") as HTMLElement;

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await row()).getByRole("button"));
}

const ADD = "Add allergies or diets";
const TICK = /I confirm the guest has agreed/;

afterEach(() => {
  resetApiMocks();
  window.history.replaceState(null, "", "/");
});

describe("a recorded value, where staff read the booking", () => {
  it("is written out in the agenda row, without opening anything", async () => {
    setup(<AgendaView venueId="v1" />, { routes: agendaRoute(reservation({ dietary: DIETARY })) });

    const shown = within(await row());
    expect(shown.getByText("Allergens: Peanuts, Milk (including lactose)")).toBeInTheDocument();
    expect(shown.getByText("Diet: Vegan")).toBeInTheDocument();
    expect(shown.getByText("Allergy or diet note: intolerance to onion")).toBeInTheDocument();
  });

  it("says Diets when there are several", async () => {
    setup(<AgendaView venueId="v1" />, { routes: agendaRoute(reservation({ dietary: { ...DIETARY, diets: ["vegan", "halal"] } })) });

    expect(within(await row()).getByText("Diets: Vegan, Halal")).toBeInTheDocument();
  });

  it.each([
    [true, "Allergies and diets, contact permission, rating and note"],
    [false, "Contact permission, rating and note"],
  ])("titles the edit dialog by what it holds, with the switch %s", async (enabled, title) => {
    setup(<EditReservationDialog venueId="v1" reservation={reservation()} onOpenChange={() => {}} />, { enabled });

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  });

  it("is shown even when the instance settings cannot be read", async () => {
    setup(<AgendaView venueId="v1" />, {
      routes: { ...agendaRoute(reservation({ dietary: DIETARY })), [CONFIG]: { status: 500 } },
    });

    expect(await screen.findByText("Diet: Vegan")).toBeInTheDocument();
  });

  it("says nothing at all for a booking with nothing recorded", async () => {
    setup(<AgendaView venueId="v1" />, { routes: agendaRoute(reservation()) });

    expect((await row()).textContent).not.toMatch(/allerg|diet/i);
  });

  it("is on the pre-shift list", async () => {
    setup(<PreShiftView venueId="v1" />, { routes: agendaRoute(reservation({ dietary: DIETARY })) });

    expect(within(await row()).getByText("Allergens: Peanuts, Milk (including lactose)")).toBeInTheDocument();
  });

  it("uses the allergen names of Regulation (EU) 1169/2011 in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    setup(<PreShiftView venueId="v1" />, {
      routes: agendaRoute(reservation({ dietary: { ...DIETARY, allergens: ["gluten", "nuts", "sesame", "sulphites", "lupin"] } })),
    });

    expect(
      await screen.findByText(
        "Alérgenos: Cereales que contengan gluten, Frutos de cáscara, Granos de sésamo, Dióxido de azufre y sulfitos, Altramuces",
      ),
    ).toBeInTheDocument();
  });

  const floor = {
    "GET /v1/venues/v1/floor": {
      body: {
        tables: [
          { id: "t1", name: "Table 1", seats: 2, zone: "", shape: "round", posX: 0, posY: 0, rotation: 0, occupied: true, reservationId: "r1", guestName: "Ana", partySize: 2 },
        ],
      },
    },
    "GET /v1/venues/v1/floor-items": { body: { items: [] } },
  };

  it("marks the table on the floor plan and spells it out on the table's card", async () => {
    const { user } = setup(<FloorView venueId="v1" />, {
      routes: {
        ...floor,
        ...agendaRoute(reservation({ dietary: DIETARY })),
        "GET /v1/venues/v1/reservations/r1": { body: reservation({ dietary: DIETARY }) },
      },
    });

    const table = await screen.findByRole("button", { name: "Table 1 Ana 2 pax, 2 guests. Has allergy information" });
    table.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Allergens: Peanuts, Milk (including lactose)")).toBeInTheDocument();
  });

  it("says so when the floor plan cannot learn which tables to mark", async () => {
    setup(<FloorView venueId="v1" />, { routes: { ...floor, "GET /v1/venues/v1/agenda": { status: 500 } } });

    expect(await screen.findByText(/Could not load allergy information/)).toBeInTheDocument();
  });
});

describe("writing it on a new booking", () => {
  const newDialog = <NewReservationDialog venueId="v1" date="2026-11-20" time="20:30" partySize={2} open onOpenChange={() => {}} />;

  it("sends nothing until the writer ticks that the guest agreed, and the tick starts empty", async () => {
    const { api, user } = setup(newDialog);

    await user.click(await screen.findByRole("button", { name: ADD }));
    await user.click(screen.getByRole("button", { name: "Peanuts" }));
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.type(screen.getByLabelText("Other allergy or diet detail"), "  no onion ");
    expect(screen.getByRole("checkbox", { name: TICK })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Create reservation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Tick the box to save.");
    expect(api.writes()).toHaveLength(0);

    await user.click(screen.getByRole("checkbox", { name: TICK }));
    await user.click(screen.getByRole("button", { name: "Create reservation" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({
      dietary: { allergens: ["peanuts"], diets: ["halal"], note: "no onion", consented: true },
    });
  });

  it("leaves the field out when nothing was chosen", async () => {
    const { api, user } = setup(newDialog);

    await screen.findByRole("button", { name: ADD });
    await user.click(screen.getByRole("button", { name: "Create reservation" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).not.toHaveProperty("dietary");
  });

  it("keeps what was typed when the write fails", async () => {
    const { user } = setup(newDialog, { routes: { [CREATE]: { status: 500 } } });

    await user.click(await screen.findByRole("button", { name: ADD }));
    await user.click(screen.getByRole("button", { name: "Eggs" }));
    await user.type(screen.getByLabelText("Other allergy or diet detail"), "no onion");
    await user.click(screen.getByRole("checkbox", { name: TICK }));
    await user.click(screen.getByRole("button", { name: "Create reservation" }));

    expect(await screen.findByText("Could not create the reservation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eggs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Other allergy or diet detail")).toHaveValue("no onion");
    expect(screen.getByRole("checkbox", { name: TICK })).toBeChecked();
  });

  it("goes with a walk-in too", async () => {
    const { api, user } = setup(<WalkInDialog venueId="v1" open onOpenChange={() => {}} />);

    await user.click(await screen.findByRole("button", { name: ADD }));
    await user.click(screen.getByRole("button", { name: "Fish" }));
    await user.click(screen.getByRole("checkbox", { name: TICK }));
    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ dietary: { allergens: ["fish"], diets: [], note: "", consented: true } });
  });

  it.each([
    ["the instance does not take it", { enabled: false }],
    ["the role can only read", { role: "read" as const }],
  ])("is not offered when %s", async (_, options) => {
    const { api, queryClient, user } = setup(<WalkInDialog venueId="v1" open onOpenChange={() => {}} />, options);
    await waitFor(() => expect(api.calls("GET", "/v1/venues/v1/config")).toHaveLength(1));
    // The settings have arrived, so what is missing now stays missing.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(screen.queryByRole("button", { name: ADD })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seat guest" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).not.toHaveProperty("dietary");
  });
});

describe("a note over its limit", () => {
  const NOTE = "Other allergy or diet detail";
  const LAST = " do not serve nut desserts";

  it.each([
    ["a new booking", <NewReservationDialog venueId="v1" date="2026-11-20" time="20:30" partySize={2} open onOpenChange={() => {}} />, "Create reservation"],
    ["a walk-in", <WalkInDialog venueId="v1" open onOpenChange={() => {}} />, "Seat guest"],
    ["an edit", <EditReservationDialog venueId="v1" reservation={reservation()} onOpenChange={() => {}} />, "Save"],
  ])("is kept whole and blocks saving %s until it is shortened", async (_, dialog, button) => {
    const { api, user } = setup(dialog);
    await user.click(await screen.findByRole("button", { name: ADD }));
    const note = screen.getByLabelText(NOTE);
    const long = "x".repeat(200) + LAST;

    await user.click(note);
    await user.paste(long);
    await user.click(screen.getByRole("checkbox", { name: TICK }));

    expect(note).toHaveValue(long);
    expect(screen.getByText("226 of 200")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Too long to save. Shorten it to 200 characters or fewer.");
    expect(note).toBeInvalid();
    expect(note).toHaveAccessibleDescription(/Too long to save.*226 of 200.*most important thing first/);

    // Twice: focus has to come back every time, not only the first.
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: button }));
      expect(note).toHaveFocus();
    }
    expect(api.writes()).toHaveLength(0);

    // Shortened from the start, without emptying it, which would drop the tick.
    fireEvent.change(note, { target: { value: LAST } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(note).toBeValid();
    await user.click(screen.getByRole("button", { name: button }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ dietary: { note: LAST.trim() } });
  });

  it.each([
    ["spaces around it do not count", `  ${"x".repeat(200)}  `, "200 of 200", false],
    ["a line break counts as one", `${"x".repeat(99)}\n${"x".repeat(100)}`, "200 of 200", false],
    ["an emoji counts as two, as in the API", `${"x".repeat(199)}\u{1F95C}`, "201 of 200", true],
  ])("counts the way the API does: %s", async (_, text, counter, over) => {
    const { user } = setup(<WalkInDialog venueId="v1" open onOpenChange={() => {}} />);
    await user.click(await screen.findByRole("button", { name: ADD }));

    await user.click(screen.getByLabelText(NOTE));
    await user.paste(text);

    expect(screen.getByText(counter)).toBeInTheDocument();
    expect(screen.queryByRole("alert") !== null).toBe(over);
  });
});

describe("changing it on a booking", () => {
  function edit(options?: Parameters<typeof setup>[1]) {
    const onOpenChange = vi.fn();
    const stored = reservation({ dietary: DIETARY });
    return { ...setup(<EditReservationDialog venueId="v1" reservation={stored} onOpenChange={onOpenChange} />, options), onOpenChange };
  }
  const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Save" }));

  it("does not send an unchanged value, and asks for no tick", async () => {
    const { api, user } = edit();

    expect(await screen.findByRole("button", { name: "Peanuts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("checkbox", { name: TICK })).not.toBeInTheDocument();
    await save(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).not.toHaveProperty("dietary");
  });

  it("asks for a fresh tick to change a recorded value, and sends the whole new value", async () => {
    const { api, user } = edit();

    await user.click(await screen.findByRole("button", { name: "Eggs" }));
    expect(screen.getByRole("checkbox", { name: TICK })).not.toBeChecked();
    await save(user);
    expect(api.writes()).toHaveLength(0);

    await user.click(screen.getByRole("checkbox", { name: TICK }));
    await save(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({
      dietary: { allergens: ["eggs", "peanuts", "milk"], diets: ["vegan"], note: "intolerance to onion", consented: true },
    });
  });

  it("warns before saving an emptied value, then deletes it with null", async () => {
    const { api, user } = edit();

    await user.click(await screen.findByRole("button", { name: "Peanuts" }));
    await user.click(screen.getByRole("button", { name: "Milk (including lactose)" }));
    await user.click(screen.getByRole("button", { name: "Vegan" }));
    await user.clear(screen.getByLabelText("Other allergy or diet detail"));
    expect(screen.getByRole("status")).toHaveTextContent("Saving deletes");
    expect(screen.queryByRole("checkbox", { name: TICK })).not.toBeInTheDocument();
    await save(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect((api.writes()[0].body as { dietary: unknown }).dietary).toBeNull();
  });
});

describe("withdrawing it", () => {
  const DELETE = "Delete allergies and diets";

  it.each(["booked", "attended", "cancelled", "no_show"])("sends only `dietary: null` for a %s booking", async (status) => {
    const { api, user } = setup(<AgendaView venueId="v1" />, { routes: agendaRoute(reservation({ status, dietary: DIETARY })) });

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: DELETE }));
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/^20:30, Ana\./);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: DELETE }));

    await waitFor(() => expect(api.calls("POST", MODIFY_PATH)).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ dietary: null });
    expect(await screen.findByText("Allergies and diets deleted")).toBeInTheDocument();
  });

  it("stays open to try again when it fails", async () => {
    const { user } = setup(<AgendaView venueId="v1" />, {
      routes: { ...agendaRoute(reservation({ dietary: DIETARY })), [MODIFY]: { status: 500 } },
    });

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: DELETE }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: DELETE }));

    expect(await screen.findByText("Could not delete the allergies and diets.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each([
    ["the role can only read", "read" as const, reservation({ dietary: DIETARY })],
    ["nothing is recorded", "write" as const, reservation()],
  ])("is not offered when %s", async (_, role, shown) => {
    const { user } = setup(<AgendaView venueId="v1" />, { role, routes: agendaRoute(shown) });

    await openMenu(user);
    await screen.findByRole("menuitem", { name: "View trace" });
    expect(screen.queryByRole("menuitem", { name: DELETE })).not.toBeInTheDocument();
  });
});
