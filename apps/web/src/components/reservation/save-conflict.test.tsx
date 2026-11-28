import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaView } from "@/components/agenda/agenda-view";
import { FloorView } from "@/components/floor/floor-view";
import { NavigationProvider } from "@/components/layout/navigation";
import type { Reservation, Table } from "@/lib/api";
import { todayIso } from "@/lib/date";
import { fakeBooking } from "@/test/fake-booking";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AssignTablesDialog } from "./assign-tables-dialog";
import { EditReservationDialog } from "./edit-reservation-dialog";

const READ = "/v1/venues/v1/reservations/r1";
const MODIFY_PATH = `${READ}/modify`;
const CHANGED = "Not saved: this booking changed while you had it open. Check it and save again.";

const BOOKING: Reservation = {
  id: "r1",
  venueId: "v1",
  date: todayIso(),
  time: "20:30",
  service: "dinner",
  partySize: 2,
  status: "booked",
  version: 1,
  bookedVia: "staff",
  guest: { name: "Jane Doe", consent: "unknown" },
  rating: 4,
  commentary: "Window seat",
  tables: ["t1"],
};

const ROOM = [1, 2, 3].map((n) => ({ id: `t${n}`, name: `Table ${n}`, seats: 4 }) as Table);

afterEach(resetApiMocks);

function editDialog(booking: Reservation = BOOKING, extra: Parameters<typeof mockApi>[0] = {}) {
  const server = fakeBooking(booking);
  const api = mockApi({ "GET /v1/venues/v1/config": { body: { dietaryEnabled: true } }, ...server.routes, ...extra });
  const onOpenChange = vi.fn();
  renderWithApp(
    <NavigationProvider value={{ goTo: () => {}, role: "write" }}>
      <EditReservationDialog venueId="v1" reservation={booking} onOpenChange={onOpenChange} />
    </NavigationProvider>,
  );
  const user = userEvent.setup();
  const save = () => user.click(screen.getByRole("button", { name: "Save" }));
  const note = () => screen.getByRole("textbox", { name: "Note" });
  const retype = async (text: string) => {
    await user.clear(note());
    await user.type(note(), text);
  };
  return { server, api, onOpenChange, user, save, note, retype };
}

const sent = (api: ReturnType<typeof mockApi>) => api.calls("POST", MODIFY_PATH).map((r) => r.body);

describe("saving the details of a booking that changed meanwhile", () => {
  it("writes nothing, says so, keeps what was typed and shows the rest as it is stored now", async () => {
    const { server, api, onOpenChange, save, note, retype } = editDialog();
    server.change({ rating: 2 });

    await retype("Birthday");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGED);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(server.stored).toMatchObject({ commentary: "Window seat", rating: 2 });
    expect(note()).toHaveValue("Birthday");
    expect(screen.getByRole("combobox", { name: "Rating" })).toHaveTextContent("2");
    expect(screen.queryByText(/^Saved now/)).not.toBeInTheDocument();

    await save();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent(api)).toEqual([
      { commentary: "Birthday", version: 1 },
      { commentary: "Birthday", version: 2 },
    ]);
    const [first, second] = api.calls("POST", MODIFY_PATH).map((r) => r.headers["Idempotency-Key"]);
    expect(second).not.toBe(first);
    expect(server.stored).toMatchObject({ commentary: "Birthday", rating: 2 });
  });

  it("shows what is stored where the other person changed the same field", async () => {
    const { server, save, note, retype } = editDialog();
    server.change({ commentary: "Anniversary dinner" });

    await retype("Birthday");
    await save();

    expect(await screen.findByText("Saved now: Anniversary dinner")).toBeInTheDocument();
    expect(note()).toHaveValue("Birthday");
    expect(note()).toHaveAccessibleDescription(/Saved now: Anniversary/);
  });

  it("closes without a write when what was typed is what is now stored", async () => {
    const { server, api, onOpenChange, save, retype } = editDialog();
    server.change({ commentary: "Birthday" });

    await retype("Birthday");
    await save();
    await screen.findByRole("alert");
    await save();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent(api)).toHaveLength(1);
  });

  it("refuses to save a booking cancelled meanwhile, and says its status", async () => {
    const { server, save, retype } = editDialog();
    server.change({ status: "cancelled" });

    await retype("Birthday");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent("Its status is now: Cancelled.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("names the new status of a booking seated meanwhile and still saves", async () => {
    const { server, onOpenChange, save, retype } = editDialog();
    server.change({ status: "seated" });

    await retype("Birthday");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Its status is now: Seated.");
    await save();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(server.stored).toMatchObject({ status: "seated", commentary: "Birthday" });
  });

  it("says a booking is gone", async () => {
    const { save, retype } = editDialog(BOOKING, {
      [`POST ${MODIFY_PATH}`]: { status: 404, body: { code: "reservation_not_found" } },
    });

    await retype("Birthday");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: this booking no longer exists.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the form when the booking cannot be read again", async () => {
    const { server, save, note, retype } = editDialog(BOOKING, {
      [`GET ${READ}`]: { status: 500, body: {} },
    });
    server.change({ rating: 2 });

    await retype("Birthday");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be read again");
    expect(note()).toHaveValue("Birthday");
  });
});

describe("allergies and diets in a save that meets a change", () => {
  const dietary = { allergens: ["eggs" as const], diets: [], note: "", consented: true as const, recordedAt: "", recordedBy: null };
  const recorded = { ...BOOKING, dietary };

  it("deletes them with no version, so that the deletion is never refused", async () => {
    const { server, api, onOpenChange, user, save } = editDialog(recorded);
    server.change({ rating: 2 });

    await user.click(await screen.findByRole("button", { name: "Eggs" }));
    await save();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent(api)).toEqual([{ dietary: null }]);
    expect(server.stored.dietary).toBeUndefined();
  });

  it("deletes them even when the other changes of the same save are refused", async () => {
    const { server, api, user, save, note, retype } = editDialog(recorded);
    server.change({ rating: 2 });

    await user.click(await screen.findByRole("button", { name: "Eggs" }));
    await retype("Birthday");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent("The allergies and diets were deleted.");
    expect(sent(api)[1]).toEqual({ dietary: null });
    expect(server.stored).toMatchObject({ commentary: "Window seat" });
    expect(server.stored.dietary).toBeUndefined();
    expect(note()).toHaveValue("Birthday");
    await save();
    await waitFor(() => expect(sent(api)[2]).toEqual({ commentary: "Birthday", version: 3 }));
  });

  it("keeps the chosen ones and shows the ones another person recorded", async () => {
    const { server, user, save } = editDialog(recorded);
    server.change({ dietary: { ...dietary, allergens: ["milk"] } });

    await user.click(await screen.findByRole("button", { name: "Peanuts" }));
    await user.click(screen.getByRole("checkbox"));
    await save();

    expect(await screen.findByText("Allergies and diets saved now:")).toBeInTheDocument();
    expect(screen.getByText("Allergens: Milk (including lactose)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Peanuts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Eggs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("follows what another person recorded when this one did not touch them", async () => {
    const { server, save, retype } = editDialog(recorded);
    server.change({ dietary: { ...dietary, allergens: ["milk"] } });

    await retype("Birthday");
    await save();

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Milk (including lactose)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Eggs" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Allergies and diets saved now:")).not.toBeInTheDocument();
  });
});

describe("assigning tables to a booking that changed meanwhile", () => {
  function assignDialog() {
    const server = fakeBooking(BOOKING);
    const api = mockApi({ "GET /v1/venues/v1/tables": { body: { tables: ROOM } }, ...server.routes });
    const onOpenChange = vi.fn();
    renderWithApp(<AssignTablesDialog venueId="v1" reservation={BOOKING} onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    const press = async (name: RegExp) => user.click(await screen.findByRole("button", { name }));
    return { server, api, onOpenChange, press };
  }

  it("keeps the choice, shows the stored tables and saves on the second press with the new version", async () => {
    const { server, api, onOpenChange, press } = assignDialog();
    await screen.findByRole("button", { name: /Table 1/ });
    server.change({ tables: ["t3"] });

    await press(/Table 2/);
    await press(/Save tables/);

    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGED);
    expect(screen.getByText("Saved now: Table 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Table 2/ })).toHaveAttribute("aria-pressed", "true");
    expect(server.stored.tables).toEqual(["t3"]);

    await press(/Save tables/);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent(api)[1]).toEqual({ tables: ["t1", "t2"], version: 2 });
  });

  it("refuses to save a booking cancelled meanwhile", async () => {
    const { server, press } = assignDialog();
    await screen.findByRole("button", { name: /Table 1/ });
    server.change({ status: "cancelled", tables: [] });

    await press(/Table 2/);
    await press(/Save tables/);

    expect(await screen.findByRole("alert")).toHaveTextContent("Its status is now: Cancelled.");
    expect(screen.getByRole("button", { name: /Save tables/ })).toBeDisabled();
  });
});

describe("moving a booking on the floor plan that changed meanwhile", () => {
  function floor() {
    const server = fakeBooking({ ...BOOKING, status: "seated" });
    const table = (id: string, posX: number) => ({
      id,
      name: `Table ${id.slice(1)}`,
      seats: 4,
      zone: "",
      shape: "round",
      posX,
      posY: 0,
      rotation: 0,
    });
    const api = mockApi({
      // The plan as it was first read, whatever is stored since.
      "GET /v1/venues/v1/floor": {
        body: {
          tables: [
            { ...table("t1", 0), occupied: true, reservationId: "r1", guestName: "Jane", partySize: 2 },
            { ...table("t2", 100), occupied: false },
          ],
        },
      },
      "GET /v1/venues/v1/floor-items": { body: { items: [] } },
      ...server.routes,
    });
    renderWithApp(<FloorView venueId="v1" />);
    const user = userEvent.setup();
    async function openMove() {
      (await screen.findByLabelText("Table 1 Jane 2 pax, 2 guests")).focus();
      await user.click(await screen.findByRole("button", { name: "Move to…" }));
      await screen.findByRole("dialog");
      await waitFor(() => expect(api.calls("GET", READ).length).toBeGreaterThan(0));
    }
    const moveToTable2 = () => user.click(screen.getByRole("button", { name: "Move to Table 2" }));
    return { server, api, openMove, moveToTable2 };
  }

  it("sends the version read when the dialog opened, and says it was not moved", async () => {
    const { server, api, openMove, moveToTable2 } = floor();
    await openMove();
    server.change({ partySize: 3 });

    await moveToTable2();

    expect(await screen.findByText("Not moved: this booking changed. Check the floor plan and move it again.")).toBeInTheDocument();
    expect(sent(api)).toEqual([{ tables: ["t2"], version: 1 }]);
    expect(server.stored.tables).toEqual(["t1"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not move a booking that is no longer where the plan shows it", async () => {
    const { server, api, openMove, moveToTable2 } = floor();
    await screen.findByLabelText("Table 1 Jane 2 pax, 2 guests");
    server.change({ tables: ["t3"] });
    await openMove();

    await moveToTable2();

    expect(await screen.findByText(/Not moved: this booking changed and is now at t3/)).toBeInTheDocument();
    expect(sent(api)).toHaveLength(0);
  });

  it("says a booking was cancelled", async () => {
    const { server, openMove, moveToTable2 } = floor();
    await openMove();
    server.change({ status: "cancelled", tables: [] });

    await moveToTable2();

    expect(await screen.findByText("Not moved: this booking changed. Its status is now: Cancelled.")).toBeInTheDocument();
  });
});

describe("this app's own writes", () => {
  it("do not count as someone else's: a dialog opened after them sends the new version", async () => {
    const server = fakeBooking({ ...BOOKING });
    let reads = 0;
    const api = mockApi({
      // The day is read once. Every later read of it fails, so only the answer to the write can move the version.
      "GET /v1/venues/v1/agenda": () => (reads++ ? { status: 500, body: {} } : { body: { reservations: [BOOKING] } }),
      "GET /v1/venues/v1/tables": { body: { tables: ROOM } },
      "POST /v1/venues/v1/reservations/r1/status": () => {
        server.change({ status: "seated" });
        return { body: server.stored };
      },
      ...server.routes,
    });
    renderWithApp(<AgendaView venueId="v1" />);
    const user = userEvent.setup();
    const menu = async () => user.click(await screen.findByRole("button", { name: /Actions for/ }));

    await menu();
    await user.click(await screen.findByRole("menuitem", { name: "Seat" }));
    await screen.findByText("Seated", { selector: "[data-slot=reservation-row] *" });
    await menu();
    await user.click(await screen.findByRole("menuitem", { name: "Edit details" }));
    await user.type(screen.getByRole("textbox", { name: "Note" }), " please");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent(api)).toEqual([{ commentary: "Window seat please", version: 2 }]));
    expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
  });
});
