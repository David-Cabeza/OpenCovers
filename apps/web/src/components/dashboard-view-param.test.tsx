import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { ThemeProvider } from "@/lib/theme";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { email: "ana@example.com" } } }), signOut: vi.fn() },
}));
vi.mock("./agenda/agenda-view", () => ({ AgendaView: () => <p>AgendaView</p> }));
vi.mock("./preshift/pre-shift-view", () => ({ PreShiftView: () => <p>PreShiftView</p> }));
vi.mock("./floor/floor-view", () => ({ FloorView: () => <p>FloorView</p> }));
vi.mock("./availability/availability-view", () => ({ AvailabilityView: () => <p>AvailabilityView</p> }));
vi.mock("./waitlist/waitlist-view", () => ({ WaitlistView: () => <p>WaitlistView</p> }));
vi.mock("./pacing/pacing-view", () => ({ PacingView: () => <p>PacingView</p> }));
vi.mock("./setup/setup-view", () => ({ SetupView: () => <p>SetupView</p> }));
vi.mock("./team/team-view", () => ({ TeamView: () => <p>TeamView</p> }));

import { Dashboard } from "./dashboard";

function show(url: string, role = "admin") {
  window.history.replaceState(null, "", url);
  mockApi({ "GET /v1/venues": { body: { venues: [{ id: "v1", name: "La Taberna", timezone: "Europe/Madrid", role }] } } });
  renderWithApp(
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>,
  );
}

beforeEach(() => useUiStore.setState({ venueId: "v1" }));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  resetApiMocks();
});

describe("the open screen in the address", () => {
  it("opens the screen named by ?view= after a reload", async () => {
    show("/?view=floor");
    expect(await screen.findByText("FloorView")).toBeInTheDocument();
    expect(window.location.search).toBe("?view=floor");
  });

  it("falls back to the agenda for a screen the role cannot see", async () => {
    show("/?view=team", "read");
    expect(await screen.findByText("AgendaView")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("falls back to the agenda for an unknown screen", async () => {
    show("/?view=nope");
    expect(await screen.findByText("AgendaView")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("keeps ?section= opening Settings", async () => {
    show("/?view=floor&section=online");
    expect(await screen.findByText("SetupView")).toBeInTheDocument();
    expect(window.location.search).toBe("?section=online");
  });

  it("updates the address when another screen is chosen, and keeps other params", async () => {
    const user = userEvent.setup();
    show("/?date=2026-12-06");
    await screen.findByText("AgendaView");

    await user.click(screen.getAllByRole("button", { name: "Waitlist" })[0]);
    expect(await screen.findByText("WaitlistView")).toBeInTheDocument();
    expect(window.location.search).toBe("?date=2026-12-06&view=waitlist");

    await user.click(screen.getAllByRole("button", { name: "Agenda" })[0]);
    await waitFor(() => expect(window.location.search).toBe("?date=2026-12-06"));
  });
});
