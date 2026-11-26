import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FloorView } from "@/components/floor/floor-view";
import { NavigationProvider } from "@/components/layout/navigation";
import { WaitlistView } from "@/components/waitlist/waitlist-view";
import type { Reservation, Role } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import type { ReactElement } from "react";

const SEATED: Reservation = {
  id: "r1",
  venueId: "v1",
  date: "2026-11-20",
  time: "20:30",
  service: "dinner",
  partySize: 2,
  status: "seated",
  version: 1,
  bookedVia: "staff",
  guest: { name: "Ana", consent: "unknown" },
  commentary: "",
  tables: ["t1"],
};

const MODIFY_PATH = "/v1/venues/v1/reservations/r1/modify";
const RECORD = "Record allergies or diets";
const OFF = [
  ["with the switch off", { enabled: false }],
  ["to a read role", { role: "read" as Role }],
] as const;

interface Options {
  role?: Role;
  enabled?: boolean;
  reservation?: Reservation;
}

function setup(ui: ReactElement, { role = "write", enabled = true, reservation = SEATED }: Options = {}) {
  let waiting = true;
  const api = mockApi({
    "GET /v1/venues/v1/config": { body: { dietaryEnabled: enabled } },
    "GET /v1/venues/v1/waitlist": () => ({
      body: {
        entries: waiting
          ? [{ id: "w1", venueId: "v1", partySize: 2, zone: "", guestName: "Ana", guestContact: "", status: "waiting", reservationId: null, createdAt: new Date().toISOString() }]
          : [],
      },
    }),
    "POST /v1/venues/v1/waitlist/w1/seat": () => {
      waiting = false;
      return { body: reservation };
    },
    "GET /v1/venues/v1/floor": {
      body: { tables: [{ id: "t1", name: "Table 1", seats: 2, zone: "", shape: "round", posX: 0, posY: 0, rotation: 0, occupied: true, reservationId: "r1", guestName: "Ana", partySize: 2 }] },
    },
    "GET /v1/venues/v1/floor-items": { body: { items: [] } },
    "GET /v1/venues/v1/reservations/r1": { body: reservation },
    [`POST ${MODIFY_PATH}`]: { body: reservation },
  });
  renderWithApp(<NavigationProvider value={{ goTo: () => {}, role }}>{ui}</NavigationProvider>);
  return { api, user: userEvent.setup() };
}

async function recordPeanuts(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  // The fields are already out, with focus on the first of them.
  expect(within(dialog).getByRole("button", { name: "Cereals containing gluten" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Peanuts" }));
  await user.click(within(dialog).getByRole("checkbox", { name: /I confirm the guest has agreed/ }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
}

const editDialog = () => screen.findByRole("dialog", { name: /allergies/i });

afterEach(() => {
  resetApiMocks();
  window.history.replaceState(null, "", "/");
});

describe("after seating from the waitlist", () => {
  const seat = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole("button", { name: "Seat" }));

  it("keeps a focused shortcut that gets focus back on cancel and goes away on save", async () => {
    const { api, user } = setup(<WaitlistView venueId="v1" />);
    await seat(user);
    const shortcut = await screen.findByRole("button", { name: RECORD });
    expect(shortcut).toHaveFocus();
    expect(shortcut).toHaveAccessibleDescription("You seated Ana.");

    await user.keyboard("{Enter}");
    await editDialog();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(shortcut).toHaveFocus());

    await user.keyboard("{Enter}");
    await recordPeanuts(user, await editDialog());

    await waitFor(() => expect(api.calls("POST", MODIFY_PATH)).toHaveLength(1));
    expect(api.calls("POST", MODIFY_PATH)[0].body).toMatchObject({ dietary: { allergens: ["peanuts"], consented: true } });
    await waitFor(() => expect(screen.queryByRole("button", { name: RECORD })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toHaveFocus());
  });

  it.each(OFF)("offers nothing %s", async (_, options) => {
    const { api, user } = setup(<WaitlistView venueId="v1" />, options);
    await seat(user);
    await screen.findByText("No one is waiting");
    expect(api.calls("GET", "/v1/venues/v1/config")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: RECORD })).not.toBeInTheDocument();
  });
});

describe("on an occupied table card", () => {
  async function openCard(user: ReturnType<typeof userEvent.setup>) {
    const node = await screen.findByLabelText(/^Table 1 Ana/);
    await user.hover(node);
    const card = await screen.findByRole("dialog", { name: "Reservation for Ana" });
    await within(card).findByText("Seated");
    return { node, card };
  }

  it("opens the edit dialog on the allergy fields and returns focus to the table", async () => {
    const { api, user } = setup(<FloorView venueId="v1" />);
    const { node, card } = await openCard(user);
    await user.click(await within(card).findByRole("button", { name: RECORD }));
    await recordPeanuts(user, await editDialog());

    await waitFor(() => expect(api.calls("POST", MODIFY_PATH)).toHaveLength(1));
    await waitFor(() => expect(node).toHaveFocus());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("says edit when something is already recorded", async () => {
    const dietary = { allergens: ["milk" as const], diets: [], note: "", consented: true as const, recordedAt: "2026-11-20T10:00:00Z", recordedBy: null };
    const { user } = setup(<FloorView venueId="v1" />, { reservation: { ...SEATED, dietary } });
    const { card } = await openCard(user);
    expect(await within(card).findByRole("button", { name: "Edit allergies and diets" })).toBeInTheDocument();
  });

  it.each(OFF)("offers nothing %s", async (_, options) => {
    const { user } = setup(<FloorView venueId="v1" />, options);
    const { card } = await openCard(user);
    expect(within(card).queryByRole("button", { name: /allergies/i })).not.toBeInTheDocument();
  });
});
