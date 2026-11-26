import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { email: "ana@example.com" } } }), signOut: vi.fn() },
}));
vi.mock("../agenda/agenda-view", () => ({ AgendaView: () => <p>AgendaView</p> }));
vi.mock("../preshift/pre-shift-view", () => ({ PreShiftView: () => <p>PreShiftView</p> }));
vi.mock("../floor/floor-view", () => ({ FloorView: () => <p>FloorView</p> }));
vi.mock("../availability/availability-view", () => ({ AvailabilityView: () => <p>AvailabilityView</p> }));
vi.mock("../waitlist/waitlist-view", () => ({ WaitlistView: () => <p>WaitlistView</p> }));

import { Dashboard } from "@/components/dashboard";

const TITLE = "Some recorded allergies or diets are not being shown.";
const CONFIG = "/v1/venues/v1/config";

// A reader, the role that can do the least.
function show(config: () => object, url = "/") {
  window.history.replaceState(null, "", url);
  const api = mockApi({
    "GET /v1/venues": { body: { venues: [{ id: "v1", name: "La Taberna", timezone: "Europe/Madrid", role: "read" }] } },
    [`GET ${CONFIG}`]: () => ({ body: config() }),
  });
  const { queryClient } = renderWithApp(<Dashboard />);
  return { api, queryClient, user: userEvent.setup() };
}

const band = () => document.querySelector('[data-slot="dietary-hidden"]');
const go = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getAllByRole("button", { name })[0]!);

beforeEach(() => useUiStore.setState({ venueId: "v1", locale: "en" }));
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  resetApiMocks();
});

describe("the warning that stored allergies and diets are hidden", () => {
  it.each(["/", "/?view=preshift", "/?view=floor", "/?view=waitlist"])("shows on %s, with no way to close it", async (url) => {
    show(() => ({ dietaryValuesHidden: true }), url);

    await waitFor(() => expect(band()).toHaveTextContent(`${TITLE} Ask every guest, tell the kitchen, and tell whoever runs the server.`));
    expect(band()?.querySelector("button")).toBeNull();
  });

  it.each([
    ["false", { dietaryValuesHidden: false }],
    ["absent, as from an older API", {}],
  ])("says nothing when the field is %s", async (_, config) => {
    const { api, queryClient } = show(() => config);

    await waitFor(() => expect(api.calls("GET", CONFIG)).toHaveLength(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(band()).toBeNull();
    expect(screen.queryByText(TITLE, { exact: false })).not.toBeInTheDocument();
  });

  it("is announced from one place that stays across screens", async () => {
    const { user } = show(() => ({ dietaryValuesHidden: true }));
    await waitFor(() => expect(band()).not.toBeNull());
    const alert = screen.getByText((text) => text.startsWith(TITLE), { selector: "[role=alert]" });

    await go(user, "Waitlist");
    expect(alert).toBeInTheDocument();
    await go(user, "Availability");
    expect(band()).toBeNull();
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(TITLE);
  });

  it("is written in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    show(() => ({ dietaryValuesHidden: true }));

    await waitFor(() =>
      expect(band()).toHaveTextContent(
        "Hay alergias o dietas anotadas que no se muestran. Pregunta a cada cliente, avisa a cocina y díselo a quien gestiona el servidor.",
      ),
    );
  });

  it("appears on a screen left open once the server switches them off, and goes when they are back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let hidden = false;
    const { api, queryClient } = show(() => ({ dietaryValuesHidden: hidden }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(api.calls("GET", CONFIG)).toHaveLength(1));

    hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(band()).not.toBeNull());
    expect(invalidate).not.toHaveBeenCalled();

    hidden = false;
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(band()).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agenda", "v1"] });
  });
});
