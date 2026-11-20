import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { ThemeProvider } from "@/lib/theme";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { useNavigation } from "./layout/navigation";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { email: "ana@example.com" } } }), signOut: vi.fn() },
}));

// The empty states of these screens link to Settings; stand in for them with the same calls.
vi.mock("./agenda/agenda-view", () => ({
  AgendaView: () => {
    const nav = useNavigation();
    return (
      <>
        <button onClick={() => nav?.goTo("setup", "services")}>link services</button>
        <button onClick={() => nav?.goTo("setup", "room")}>link room</button>
        <button onClick={() => nav?.goTo("setup", "developers")}>link developers</button>
      </>
    );
  },
}));

import { Dashboard } from "./dashboard";

const venues = (role: string) => ({ venues: [{ id: "v1", name: "La Taberna", timezone: "Europe/Madrid", role }] });
const scroll = vi.fn();

function show(role: string) {
  mockApi({
    "GET /v1/venues": { body: venues(role) },
    "GET /v1/venues/v1/tables": { body: { tables: [] } },
    "GET /v1/venues/v1/services": { body: { services: [] } },
  });
  Element.prototype.scrollIntoView = scroll;
  renderWithApp(
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  scroll.mockClear();
  useUiStore.setState({ venueId: "v1" });
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
  resetApiMocks();
});

describe("links into Settings sections", () => {
  it("opens Dining room and scrolls to the services card", async () => {
    const user = userEvent.setup();
    show("admin");
    await user.click(await screen.findByRole("button", { name: "link services" }));
    expect(await screen.findByRole("tab", { name: "Dining room", selected: true })).toBeInTheDocument();
    expect(window.location.search).toBe("?section=room");
    await waitFor(
      () => expect(scroll.mock.contexts.some((el) => (el as HTMLElement).id === "settings-services")).toBe(true),
      { timeout: 2_000 },
    );
  });

  it("opens Dining room from the floor plan link", async () => {
    const user = userEvent.setup();
    show("write");
    await user.click(await screen.findByRole("button", { name: "link room" }));
    expect(await screen.findByRole("tab", { name: "Dining room", selected: true })).toBeInTheDocument();
  });

  it("falls back to General when the role cannot see the target section", async () => {
    const user = userEvent.setup();
    show("write");
    await user.click(await screen.findByRole("button", { name: "link developers" }));
    expect(await screen.findByRole("tab", { name: "General", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Developers" })).not.toBeInTheDocument();
  });

  it("opens Settings on the section named in the address after a reload", async () => {
    window.history.replaceState(null, "", "/?section=online");
    show("admin");
    expect(await screen.findByRole("tab", { name: "Online", selected: true })).toBeInTheDocument();
  });
});
