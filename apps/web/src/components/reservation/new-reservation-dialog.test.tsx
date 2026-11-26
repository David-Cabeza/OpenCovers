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

async function chooseManually(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "Choose table" }));
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
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 2 · 4" }));
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
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const body = api.writes()[0].body as { partySize: unknown; commentary?: string };
    expect(body.partySize).toBe(2);
    expect(body.commentary).toBeUndefined();
  });

  it("sums the seats of several selected tables", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await user.click(screen.getByRole("button", { name: "Table 2 · 4" }));
    expect(screen.getByText("6 seats selected for 2 guests.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "6");
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ partySize: 6, tables: ["t1", "t2"] });
  });

  it("warns about health data, and does not create with a note over 500 characters", async () => {
    const { api, user } = setup();
    const note = await screen.findByLabelText("Note");
    expect(
      screen.getByText("Up to 500 characters. Do not enter health data such as allergies."),
    ).toBeInTheDocument();

    await user.click(note);
    await user.paste("x".repeat(520));
    expect(note).toHaveValue("x".repeat(520));
    await user.click(screen.getByRole("button", { name: "Create reservation" }));

    expect(note).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Shorten it to 500 characters or fewer.");
    expect(api.writes()).toHaveLength(0);
  });

  it("does not require a guest name or contact", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect((api.writes()[0].body as { guest: unknown }).guest).toEqual({});
  });

  it("refuses a party larger than the selected tables and sends nothing", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
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
    await chooseManually(user);
    await submit(user);

    expect(await screen.findByText("Select at least one table.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("shows the missing table inside the dialog and clears it when a table is chosen", async () => {
    const { user } = setup();
    await chooseManually(user);
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Select at least one table.");
    const group = screen.getByRole("group", { name: "Tables" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAttribute("aria-describedby", alert.id);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(group).not.toHaveAttribute("aria-invalid");
  });

  it("marks tables held at the chosen time, refuses them, and follows the time", async () => {
    const agenda = {
      reservations: [
        { id: "r9", time: "20:00", status: "booked", partySize: 2, tables: ["t1"], guest: { name: "Irene" } },
        { id: "r8", time: "13:00", status: "cancelled", partySize: 2, tables: ["t2"], guest: { name: "Ana" } },
      ],
    };
    const { user } = setup({ "GET /v1/venues/v1/agenda": { body: agenda } });
    await chooseManually(user);
    const busy = await screen.findByRole("button", { name: /Table 1 · 2/ });
    await waitFor(() => expect(busy).toHaveAttribute("aria-disabled", "true"));
    expect(busy).toHaveAccessibleDescription("Busy · Irene");
    expect(screen.getByRole("button", { name: "Table 2 · 4" })).not.toHaveAttribute("aria-disabled");
    await user.click(busy);
    expect(busy).toHaveAttribute("aria-pressed", "false");
  });

  it("rejects an empty party size before calling the server", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await user.clear(screen.getByLabelText("Party size"));
    await submit(user);

    expect(await screen.findByText("Party size is required.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("rejects a party of zero before calling the server", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "0");
    await submit(user);

    expect(screen.getByLabelText("Party size")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  it("tells the host when the venue has no tables yet", async () => {
    setup({}, []);
    expect(await screen.findByText("This venue has no tables yet.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("leaves the tables to the server by default and says which ones it gave", async () => {
    const { api, onOpenChange, user } = setup({ [CREATE]: { body: { id: "r1", tables: ["t2"] } } });
    expect(await screen.findByRole("radio", { name: "Automatic" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Table 1 · 2" })).not.toBeInTheDocument();
    await submit(user);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.writes()[0].body).not.toHaveProperty("tables");
    expect(await screen.findByText("Tables: Table 2")).toBeInTheDocument();
  });

  it("drops the chosen tables when the host goes back to automatic", async () => {
    const { api, user } = setup();
    await chooseManually(user);
    await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
    await user.click(screen.getByRole("radio", { name: "Automatic" }));
    await submit(user);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).not.toHaveProperty("tables");
  });

  it.each([
    ["no_suitable_table", "No free table for this party at that time."],
    ["party_size_too_large", "The party is too large for that time."],
  ])("shows %s inside the dialog without a chosen table, until the party changes", async (code, text) => {
    const { onOpenChange, user } = setup({ [CREATE]: { status: 409, body: { code } } });
    await screen.findByRole("radio", { name: "Automatic" });
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await user.type(screen.getByLabelText("Party size"), "1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["slot_taken", "One of those tables is already taken at that time. Pick another table."],
    ["outside_hours", "That time is outside the venue's opening hours."],
  ])(
    "shows the %s error and keeps the dialog open",
    async (code, text) => {
      const { onOpenChange, user } = setup({ [CREATE]: { status: 409, body: { code } } });
      await chooseManually(user);
      await user.click(screen.getByRole("button", { name: "Table 1 · 2" }));
      await submit(user);

      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(screen.getByRole("button", { name: "Create reservation" })).toBeEnabled();
    },
  );
});
