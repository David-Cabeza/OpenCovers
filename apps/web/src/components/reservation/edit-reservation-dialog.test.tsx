import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reservation } from "@/lib/api";
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
    expect(screen.getByLabelText("Note")).toHaveAttribute("maxlength", "500");
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

  it("sends the new consent and keeps the rating and note as they were", async () => {
    const { api, onOpenChange, user } = setup();

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Granted" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [req] = api.calls("POST", MODIFY_PATH);
    expect(req.body).toEqual({
      guest: { consent: "granted" },
      rating: 4,
      commentary: "Window seat",
    });
    expect(req.headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Reservation updated")).toBeInTheDocument();
  });

  it("sends the edited note trimmed and the other values unchanged", async () => {
    const { api, user } = setup();

    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "  Birthday  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      guest: { consent: "unknown" },
      rating: 4,
      commentary: "Birthday",
    });
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

  it("stops the note at 500 characters", async () => {
    const { user } = setup();

    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "x".repeat(520));

    expect(screen.getByLabelText("Note")).toHaveValue("x".repeat(500));
  });

  it("shows the API error and keeps the dialog open", async () => {
    const { onOpenChange, user } = setup({
      [MODIFY]: { status: 409, body: { code: "version_conflict" } },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not update the reservation.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
