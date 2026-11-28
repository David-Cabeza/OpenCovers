import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reservation } from "@/lib/api";
import { fakeBooking } from "@/test/fake-booking";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { EditReservationDialog } from "./edit-reservation-dialog";

const MODIFY = "POST /v1/venues/v1/reservations/r1/modify";
const MODIFY_PATH = "/v1/venues/v1/reservations/r1/modify";

const RESERVATION: Reservation = {
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
  rating: 4,
  commentary: "Window seat",
};

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ [MODIFY]: { body: RESERVATION }, ...extra });
  const onOpenChange = vi.fn();
  renderWithApp(
    <EditReservationDialog
      venueId="v1"
      reservation={RESERVATION}
      onOpenChange={onOpenChange}
    />,
  );
  return { api, onOpenChange, user: userEvent.setup() };
}

describe("EditReservationDialog", () => {
  afterEach(resetApiMocks);

  it("shows the recorded details, the note limit and the health data warning", () => {
    setup();

    expect(screen.getByText("Update the details recorded for Jane Doe.")).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("Window seat");
    expect(
      screen.getByText("Up to 500 characters. Do not enter health data such as allergies."),
    ).toBeInTheDocument();
  });

  it("names the consent select by its label", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Contact permission" })).toBeInTheDocument();
  });

  it("names the rating select by its label", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Rating" })).toBeInTheDocument();
  });

  it("sends the new consent and leaves out the rating and note", async () => {
    const { api, onOpenChange, user } = setup();

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Granted" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [req] = api.calls("POST", MODIFY_PATH);
    expect(req.body).toEqual({ guest: { consent: "granted" }, version: 1 });
    expect(req.headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Reservation updated")).toBeInTheDocument();
  });

  it("sends only the edited note, trimmed", async () => {
    const { api, user } = setup();

    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "  Birthday  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({ commentary: "Birthday", version: 1 });
  });

  it("sends a numeric rating and clears it with null", async () => {
    const { api, user } = setup();
    const [, rating] = screen.getAllByRole("combobox");

    await user.click(rating);
    await user.click(await screen.findByRole("option", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect((api.writes()[0].body as { rating: unknown }).rating).toBe(5);

    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "No rating" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(2));
    expect((api.writes()[1].body as { rating: unknown }).rating).toBeNull();
  });

  it("keeps a note over 500 characters whole and does not save it", async () => {
    const { api, user } = setup();
    const note = screen.getByLabelText("Note");

    await user.clear(note);
    await user.paste("x".repeat(520));
    expect(note).toHaveValue("x".repeat(520));
    expect(screen.getByText("520 of 500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(note).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Shorten it to 500 characters or fewer.");
    expect(api.writes()).toHaveLength(0);
  });

  it("shows the API error and keeps the dialog open", async () => {
    const { onOpenChange, user } = setup({
      [MODIFY]: { status: 409, body: { code: "version_conflict" } },
    });

    await user.type(screen.getByLabelText("Note"), " please");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not update the reservation.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not undo what another person saved after the dialog opened", async () => {
    // One booking behind two screens that both read it before either one saved.
    const server = fakeBooking(RESERVATION);
    const api = mockApi(server.routes);
    const user = userEvent.setup();
    const open = () =>
      renderWithApp(<EditReservationDialog venueId="v1" reservation={RESERVATION} onOpenChange={() => {}} />);

    const first = open();
    await user.click(screen.getByRole("combobox", { name: "Contact permission" }));
    await user.click(await screen.findByRole("option", { name: "Granted" }));
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Birthday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    first.unmount();

    open();
    await user.click(screen.getByRole("combobox", { name: "Rating" }));
    await user.click(await screen.findByRole("option", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(3));

    expect(server.stored).toMatchObject({ guest: { consent: "granted" }, commentary: "Birthday", rating: 5 });
  });

  it.each([
    ["nothing was touched", ""],
    ["only spaces were added around the note", "  "],
  ])("closes without a write or a success message when %s", async (_, padding) => {
    const api = mockApi({ [MODIFY]: { body: RESERVATION } });
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    renderWithApp(
      <EditReservationDialog venueId="v1" reservation={RESERVATION} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const user = userEvent.setup();

    if (padding) await user.type(screen.getByLabelText("Note"), padding);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.writes()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("Reservation updated")).not.toBeInTheDocument();
  });
});

