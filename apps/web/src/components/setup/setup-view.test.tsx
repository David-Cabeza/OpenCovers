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

const open = (section: string) => window.history.replaceState(null, "", `/?section=${section}`);

describe("SetupView", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    resetApiMocks();
  });

  it("offers every section to an admin as tabs, General first and selected", async () => {
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const bar = await screen.findByRole("tablist", { name: "Settings sections" });
    const tabs = within(bar).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["General", "Online", "Dining room", "Developers"]);
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Online" })).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel", { name: "General" });
    expect(panel).toBeVisible();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-controls", panel.id);
    expect(screen.queryByText("Add table")).not.toBeInTheDocument();
  });

  it("hides the admin-only sections from other roles, even by the address", async () => {
    open("developers");
    setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    const bar = await screen.findByRole("tablist", { name: "Settings sections" });
    expect(within(bar).getByRole("tab", { name: "Dining room" })).toBeInTheDocument();
    expect(within(bar).queryByRole("tab", { name: "Online" })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("tab", { name: "Developers" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Developers" })).not.toBeInTheDocument();
  });

  it("shows a section on click and records it in the address", async () => {
    const user = userEvent.setup();
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    await user.click(await screen.findByRole("tab", { name: "Dining room" }));
    expect(window.location.search).toBe("?section=room");
    expect(await screen.findByRole("button", { name: "Edit Mesa 1" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Dining room" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "General" })).not.toBeInTheDocument();
  });

  it("opens the section named in the address", async () => {
    open("online");
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    expect(await screen.findByRole("tab", { name: "Online", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Online" })).toBeVisible();
  });

  it("falls back to General for an unknown section", async () => {
    open("nonsense");
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    expect(await screen.findByRole("tab", { name: "General", selected: true })).toBeInTheDocument();
  });

  it("moves between tabs with the arrow, Home and End keys", async () => {
    const user = userEvent.setup();
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const general = await screen.findByRole("tab", { name: "General" });
    general.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Online" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Online" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Developers" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Developers" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus();
  });

  it("keeps an unsaved edit in General when switching tabs and back", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /v1/venues/v1/tables": { body: TABLES },
      "GET /v1/venues/v1/services": { body: SERVICES },
      "GET /v1/venues/v1/config": {
        body: {
          enabled: true, noticeAddress: "", notificationsEnabled: false, resendConfigured: false,
          fromEmail: "", slotIntervalMinutes: 15, leadTimeMinutes: 0, lastSeatingOffsetMinutes: 0, overbookingCeiling: 0,
        },
      },
    });
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const field = await screen.findByLabelText(/slot interval/i);
    await user.clear(field);
    await user.type(field, "30");
    await user.click(screen.getByRole("tab", { name: "Dining room" }));
    expect(document.getElementById("settings-venue")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByLabelText(/slot interval/i)).toHaveValue(30);
  });

  it("does not fetch the data of a section that was never opened", async () => {
    const api = setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    await screen.findByRole("tablist");
    expect(api.requests.some((r) => r.path.includes("/tables"))).toBe(false);
  });

  it("lists tables and services as rows with their details", async () => {
    open("room");
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
    open("room");
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
    open("room");
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
    open("room");
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
    open("room");
    setup();
    renderWithApp(<SetupView venueId="v1" role="write" />);
    await user.click(await screen.findByRole("button", { name: "Edit Mesa 1" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("gives the Dining room a heading outline with no skipped level", async () => {
    open("room");
    setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    await screen.findByRole("heading", { name: "Services" });
    const headings = screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent]);
    expect(headings).toEqual([
      ["H1", "Settings"],
      ["H2", "Dining room"],
      ["H3", "Tables"],
      ["H3", "Floor layout"],
      ["H3", "Services"],
    ]);
  });
});
