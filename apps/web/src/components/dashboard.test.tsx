import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { ThemeProvider } from "@/lib/theme";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: "ana@example.com" } } }),
    signOut: vi.fn(),
  },
}));

// The screens are not what is tested here, only the page around them.
vi.mock("./agenda/agenda-view", () => ({ AgendaView: () => <p>AgendaView</p> }));
vi.mock("./preshift/pre-shift-view", () => ({ PreShiftView: () => <p>PreShiftView</p> }));
vi.mock("./floor/floor-view", () => ({ FloorView: () => <p>FloorView</p> }));
vi.mock("./availability/availability-view", () => ({ AvailabilityView: () => <p>AvailabilityView</p> }));
vi.mock("./waitlist/waitlist-view", () => ({ WaitlistView: () => <p>WaitlistView</p> }));
vi.mock("./pacing/pacing-view", () => ({ PacingView: () => <p>PacingView</p> }));
vi.mock("./setup/setup-view", () => ({ SetupView: () => <p>SetupView</p> }));
vi.mock("./team/team-view", () => ({ TeamView: () => <p>TeamView</p> }));

import { Dashboard } from "./dashboard";

const VENUES = { venues: [{ id: "v1", name: "La Taberna", timezone: "Europe/Madrid", role: "admin" }] };

beforeEach(() => {
  useUiStore.setState({ venueId: "v1" });
  mockApi({ "GET /v1/venues": { body: VENUES } });
});
afterEach(() => {
  resetApiMocks();
  document.title = "OpenCovers";
});

describe("Dashboard accessibility", () => {
  it("puts the screen and the venue in the title of the page, and changes it with the screen", async () => {
    const user = userEvent.setup();
    renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.title).toBe("Agenda · La Taberna · OpenCovers"));

    await user.click(screen.getAllByRole("button", { name: "Waitlist" })[0]);
    await waitFor(() => expect(document.title).toBe("Waitlist · La Taberna · OpenCovers"));
    await user.click(screen.getAllByRole("button", { name: "Settings" })[0]);
    await waitFor(() => expect(document.title).toBe("Settings · La Taberna · OpenCovers"));
  });

  it("goes back to the plain title when the dashboard goes away", async () => {
    const { unmount } = renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.title).toContain("La Taberna"));
    unmount();
    expect(document.title).toBe("OpenCovers");
  });

  it("offers a link to skip the navigation, as the first thing the keyboard reaches", async () => {
    const user = userEvent.setup();
    renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    await screen.findByText("AgendaView");

    await user.tab();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it("moves the focus to the main content from that link, without changing the address", async () => {
    const user = userEvent.setup();
    const before = window.location.hash;
    renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    await screen.findByText("AgendaView");

    await user.click(screen.getByRole("link", { name: "Skip to content" }));

    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(window.location.hash).toBe(before);
  });

  it("says the venues could not be loaded, instead of offering to create a first one", async () => {
    mockApi({ "GET /v1/venues": { status: 500, body: { code: "transient" } } });
    renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    expect(await screen.findByText("Could not load your venues")).toBeInTheDocument();
    expect(screen.queryByText("No venues yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create your first venue/ })).not.toBeInTheDocument();
  });
});

