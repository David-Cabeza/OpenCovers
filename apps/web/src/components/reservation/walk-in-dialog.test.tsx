import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { WalkInDialog } from "./walk-in-dialog";

const WALK_IN = "POST /v1/venues/v1/reservations/walk-in";

function setup(
  props: { tableId?: string; tableName?: string } = {},
  extra: Parameters<typeof mockApi>[0] = {},
) {
  const api = mockApi({ [WALK_IN]: { body: { id: "r1" } }, ...extra });
  const onOpenChange = vi.fn();
  renderWithApp(<WalkInDialog venueId="v1" open onOpenChange={onOpenChange} {...props} />);
  return { api, onOpenChange, user: userEvent.setup() };
}

describe("WalkInDialog", () => {
  afterEach(resetApiMocks);

  it("seats the default party of two as a number and leaves table choice to the engine", async () => {
    const { api, onOpenChange, user } = setup();

    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [req] = api.calls("POST", "/v1/venues/v1/reservations/walk-in");
    expect(req.body).toEqual({ partySize: 2, guest: { consent: "unknown" } });
    expect(req.headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Guest seated")).toBeInTheDocument();
  });

  it("sends the party size, guest details and consent the host entered", async () => {
    const { api, user } = setup();

    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "4");
    await user.type(screen.getByLabelText("Guest name"), "Jane Doe");
    await user.type(screen.getByLabelText("Contact"), "jane@example.com");
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Granted" }));
    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      partySize: 4,
      guest: { name: "Jane Doe", contact: "jane@example.com", consent: "granted" },
    });
  });

  it("seats the guest at the chosen table", async () => {
    const { api, user } = setup({ tableId: "t7", tableName: "Table 7" });

    expect(screen.getByText("Seat at Table 7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toMatchObject({ partySize: 2, tables: ["t7"] });
  });

  it("rejects an empty party size before calling the server", async () => {
    const { api, user } = setup();

    await user.clear(screen.getByLabelText("Party size"));
    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    expect(await screen.findByText("Party size is required.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it("shows the API error and keeps the dialog open", async () => {
    const { onOpenChange, user } = setup(
      {},
      { [WALK_IN]: { status: 409, body: { code: "no_table_available" } } },
    );

    await user.click(screen.getByRole("button", { name: "Seat guest" }));

    expect(await screen.findByText("no_table_available")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
