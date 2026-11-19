import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { SetupView } from "./setup-view";

const TABLES = {
  tables: [
    { id: "t1", name: "Mesa 1", seats: 4, zone: "Terraza", shape: "round", posX: 0, posY: 0, rotation: 0 },
    { id: "t2", name: "Mesa 2", seats: 1, zone: "", shape: "square", posX: 0, posY: 0, rotation: 0 },
  ],
};
const SERVICES = {
  services: [{ name: "dinner", openStart: "20:00", openEnd: "23:00", days: [1, 2, 3, 4, 5, 6, 7] }],
};

// Names also appear in the floor editor, so find the row of the list.
const row = (text: string) =>
  screen
    .getAllByText(text)
    .map((el) => el.closest("li"))
    .find(Boolean) as HTMLElement;

function setup() {
  return mockApi({
    "GET /v1/venues/v1/tables": { body: TABLES },
    "GET /v1/venues/v1/services": { body: SERVICES },
    "DELETE /v1/venues/v1/tables/t1": { body: { tables: [TABLES.tables[1]] } },
    "DELETE /v1/venues/v1/services/dinner": { body: { services: [] } },
  });
}

describe("SetupView", () => {
  afterEach(resetApiMocks);

  it("offers every section to an admin", async () => {
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    for (const label of ["General", "Online", "Dining room", "Developers"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("hides the admin-only sections from other roles", async () => {
    setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("button", { name: "Dining room" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Online" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Developers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Developers" })).not.toBeInTheDocument();
  });

  it("lists tables and services as rows with their details", async () => {
    setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await screen.findByRole("button", { name: "Edit Mesa 1" });
    const table = row("Mesa 1");
    expect(within(table).getByText("Terraza")).toBeInTheDocument();
    expect(within(table).getByText("4 seats")).toBeInTheDocument();
    const single = row("Mesa 2");
    expect(within(single).getByText("No zone")).toBeInTheDocument();
    expect(within(single).getByText("1 seat")).toBeInTheDocument();
    const service = row("dinner");
    expect(within(service).getByText("20:00–23:00")).toBeInTheDocument();
  });

  it("removes a table or a service from its row", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await user.click(await screen.findByRole("button", { name: "Remove Mesa 1" }));
    expect(api.calls("DELETE", "/v1/venues/v1/tables/t1")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Remove table" }));
    await waitFor(() => expect(api.calls("DELETE", "/v1/venues/v1/tables/t1")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Remove dinner" }));
    expect(api.calls("DELETE", "/v1/venues/v1/services/dinner")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Remove service" }));
    await waitFor(() => expect(api.calls("DELETE", "/v1/venues/v1/services/dinner")).toHaveLength(1));
  });

  it("keeps the table when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await user.click(await screen.findByRole("button", { name: "Remove Mesa 1" }));
    expect(await screen.findByRole("heading", { name: "Remove Mesa 1?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep table" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls("DELETE", "/v1/venues/v1/tables/t1")).toHaveLength(0);
  });

  it("keeps the service when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await user.click(await screen.findByRole("button", { name: "Remove dinner" }));
    expect(await screen.findByRole("heading", { name: "Remove dinner?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep service" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls("DELETE", "/v1/venues/v1/services/dinner")).toHaveLength(0);
  });

  it("opens the edit dialog from a table row", async () => {
    const user = userEvent.setup();
    setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await user.click(await screen.findByRole("button", { name: "Edit Mesa 1" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
