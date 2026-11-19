import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: "ana@example.com" } } }),
    signOut: vi.fn(),
  },
}));
vi.mock("./agenda/agenda-view", () => ({ AgendaView: () => <p>AgendaView</p> }));
vi.mock("./waitlist/waitlist-view", () => ({ WaitlistView: () => <p>WaitlistView</p> }));

import { Dashboard } from "./dashboard";

describe("Dashboard in Spanish", () => {
  beforeEach(() => {
    useUiStore.setState({ venueId: "v1", locale: "es" });
    mockApi({
      "GET /v1/venues": { body: { venues: [{ id: "v1", name: "La Taberna", timezone: "Europe/Madrid", role: "admin" }] } },
    });
  });
  afterEach(() => {
    resetApiMocks();
    document.title = "OpenCovers";
  });

  it("puts the screen name in the title in the language of the app, and follows a change", async () => {
    const user = userEvent.setup();
    renderWithApp(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.title).toBe("Agenda · La Taberna · OpenCovers"));
    await user.click(screen.getAllByRole("button", { name: "Lista de espera" })[0]);
    await waitFor(() => expect(document.title).toBe("Lista de espera · La Taberna · OpenCovers"));
    useUiStore.setState({ locale: "en" });
    await waitFor(() => expect(document.title).toBe("Waitlist · La Taberna · OpenCovers"));
  });
});
