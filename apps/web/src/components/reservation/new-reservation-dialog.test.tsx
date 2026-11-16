import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { NewReservationDialog } from "./new-reservation-dialog";

const TABLES = [
  { id: "t1", name: "Table 1", seats: 2, zone: "main", shape: "round", posX: 0, posY: 0, rotation: 0 },
  { id: "t2", name: "Table 2", seats: 4, zone: "main", shape: "round", posX: 0, posY: 0, rotation: 0 },
];
const CREATE = "POST /v1/venues/v1/reservations";
const CREATE_PATH = "/v1/venues/v1/reservations";

function setup(
  extra: Parameters<typeof mockApi>[0] = {},
  tables: typeof TABLES = TABLES,
  partySize = 2,
) {
  const api = mockApi({
    "GET /v1/venues/v1/tables": { body: { tables } },
    [CREATE]: { body: { id: "r1" } },
    ...extra,
  });
  const onOpenChange = vi.fn();
  renderWithApp(
    <NewReservationDialog
      venueId="v1"
      date="2026-11-20"
      time="20:30"
      partySize={partySize}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { api, onOpenChange, user: userEvent.setup() };
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Create reservation" }));
}

describe("NewReservationDialog", () => {
  afterEach(() => {
    resetApiMocks();
  });

  it("sends the party size as a number with date, time, guest, note and tables", async () => {
    const { api, onOpenChange, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 2 · 4" }));
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "3");
    await user.type(screen.getByLabelText("Guest name"), "Jane Doe");
    await user.type(screen.getByLabelText("Contact"), "jane@example.com");
    await user.type(screen.getByLabelText("Note"), "Anniversary");
    await submit(user);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [req] = api.calls("POST", CREATE_PATH);
    expect(req.body).toEqual({
      date: "2026-11-20",
      time: "20:30",
      partySize: 3,
      tables: ["t2"],
      guest: { name: "Jane Doe", contact: "jane@example.com" },
      commentary: "Anniversary",
    });
    expect(typeof (req.body as { partySize: unknown }).partySize).toBe("number");
    expect(req.headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Reservation created")).toBeInTheDocument();
  });

  it("sends the prefilled party size as a number when the host does not touch it", async () => {
    const { api, user } = setup({}, TABLES, 2);
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const body = api.writes()[0].body as { partySize: unknown; commentary?: string };
    expect(body.partySize).toBe(2);
    expect(body.commentary).toBeUndefined();
  });

  it("sums the seats of several selected tables", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await user.click(screen.getByRole("button", { name: "Table 2 · 4" }));
    expect(screen.getByText("6 seats selected for 2 guests.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "6");
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ partySize: 6, tables: ["t1", "t2"] });
  });

  it("limits the note to 500 characters and warns about health data", async () => {
    const { user } = setup();
    expect(await screen.findByLabelText("Note")).toHaveAttribute("maxlength", "500");
    expect(
      screen.getByText("Up to 500 characters. Do not enter health data such as allergies."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Note"), "x".repeat(520));
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toHaveLength(500);
  });

  it("does not require a guest name or contact", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect((api.writes()[0].body as { guest: unknown }).guest).toEqual({});
  });

  it("refuses a party larger than the selected tables and sends nothing", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "5");
    await submit(user);

    expect(
      await screen.findByText("The party is larger than the selected tables."),
    ).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("asks for a table when none is selected and sends nothing", async () => {
    const { api, user } = setup();
    await screen.findByRole("button", { name: "Table 1 · 2" });
    await submit(user);

    expect(await screen.findByText("Select at least one table.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("rejects an empty party size before calling the server", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await user.clear(screen.getByLabelText("Party size"));
    await submit(user);

    expect(await screen.findByText("Party size is required.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("rejects a party of zero before calling the server", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "0");
    await submit(user);

    expect(screen.getByLabelText("Party size")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  it("tells the host when the venue has no tables yet", async () => {
    const { api, user } = setup({}, []);
    expect(await screen.findByText("This venue has no tables yet.")).toBeInTheDocument();
    await submit(user);

    expect(await screen.findByText("Select at least one table.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it.each(["slot_taken", "outside_hours"])(
    "shows the %s error and keeps the dialog open",
    async (code) => {
      const { onOpenChange, user } = setup({ [CREATE]: { status: 409, body: { code } } });
      await user.click(await screen.findByRole("button", { name: "Table 1 · 2" }));
      await submit(user);

      expect(await screen.findByText(code)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(screen.getByRole("button", { name: "Create reservation" })).toBeEnabled();
    },
  );
});
