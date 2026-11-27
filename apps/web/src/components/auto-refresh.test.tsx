import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaView } from "@/components/agenda/agenda-view";
import { FloorView } from "@/components/floor/floor-view";
import { PreShiftView } from "@/components/preshift/pre-shift-view";
import { ServerBanner } from "@/components/server-banner";
import { FloorEditor } from "@/components/setup/floor-editor";
import type { FloorTable, Reservation } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useServerStatus } from "@/stores/server-status";
import { mockApi, renderWithApp, resetApiMocks, type MockResponse } from "@/test/mock-api";
import { useUiStore } from "@/stores/ui-store";

const AGENDA = "GET /v1/venues/v1/agenda";
const AGENDA_PATH = "/v1/venues/v1/agenda";
const TABLES = "GET /v1/venues/v1/tables";
const SERVICES = "GET /v1/venues/v1/services";
const WAITLIST = "GET /v1/venues/v1/waitlist";
const FLOOR = "GET /v1/venues/v1/floor";
const FLOOR_PATH = "/v1/venues/v1/floor";
const ITEMS = "GET /v1/venues/v1/floor-items";

const NOTICE_EN = "Could not update. Data from 07:10 PM.";

function reservation(id: string, name: string, time = "20:30"): Reservation {
  return {
    id,
    venueId: "v1",
    date: "2026-11-27",
    time,
    service: "dinner",
    partySize: 2,
    status: "booked",
    version: 1,
    bookedVia: "staff",
    guest: { name },
  };
}

const table = (overrides: Partial<FloorTable> = {}): FloorTable => ({
  id: "t1",
  name: "Table 1",
  seats: 2,
  zone: "",
  shape: "round",
  posX: 0,
  posY: 0,
  rotation: 0,
  occupied: false,
  ...overrides,
});

/** A server whose answers the test changes: what it holds, and whether it fails. */
function server() {
  const state = {
    reservations: [reservation("r1", "Ana")],
    tables: [table()],
    waitlist: [] as unknown[],
    failing: false,
  };
  const answer = (body: () => unknown) => (): MockResponse =>
    state.failing ? { status: 500, body: { code: "internal" } } : { body: body() };
  const api = mockApi({
    [AGENDA]: answer(() => ({ reservations: state.reservations })),
    [TABLES]: answer(() => ({ tables: state.tables })),
    [SERVICES]: answer(() => ({ services: [] })),
    [WAITLIST]: answer(() => ({ entries: state.waitlist })),
    [FLOOR]: answer(() => ({ tables: state.tables })),
    [ITEMS]: answer(() => ({ items: [] })),
  });
  return { state, api };
}

// With the app's own defaults, which do not refetch on focus and keep data for half a minute.
const open = (ui: ReactElement) => renderWithApp(ui, queryClient.getDefaultOptions().queries);
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const notice = () => document.querySelector("[data-slot=stale-notice]");
const status = () => screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 27, 19, 10, 0));
});

afterEach(() => {
  resetApiMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  useServerStatus.getState().setDown(false);
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

describe("a service screen left open", () => {
  it("shows a booking made elsewhere without being touched", async () => {
    const { state } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");

    state.reservations = [...state.reservations, reservation("r2", "Berta", "21:00")];
    await wait(30_000);

    expect(await screen.findByText("Berta")).toBeInTheDocument();
  });

  it("does not ask while the tab is hidden, and asks as soon as it is back", async () => {
    const { api } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");

    act(() => focusManager.setFocused(false));
    const before = api.calls("GET", AGENDA_PATH).length;
    await wait(5 * 60_000);
    expect(api.calls("GET", AGENDA_PATH)).toHaveLength(before);

    act(() => focusManager.setFocused(true));
    await wait(0);
    expect(api.calls("GET", AGENDA_PATH)).toHaveLength(before + 1);
  });

  it("keeps an open row menu open across a refresh", async () => {
    const { state } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");
    await user().click(screen.getByRole("button", { name: /Actions for the 20:30/ }));

    state.reservations = [reservation("r0", "Carlos", "19:30"), ...state.reservations];
    await wait(30_000);

    expect(await screen.findByText("Carlos")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Seat" })).toBeInTheDocument();
  });

  it("keeps a half-filled new reservation, its time included, when the quarter hour passes", async () => {
    const { state } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");
    const u = user();
    await u.click(screen.getByRole("button", { name: "New reservation" }));
    await u.type(screen.getByLabelText("Guest name"), "Dora");
    expect(screen.getByLabelText("Time")).toHaveValue("19:15");

    state.reservations = [...state.reservations, reservation("r2", "Berta", "22:00")];
    await wait(10 * 60_000);

    expect(screen.getByText("Berta")).toBeInTheDocument();
    expect(screen.getByLabelText("Time")).toHaveValue("19:15");
    expect(screen.getByLabelText("Guest name")).toHaveValue("Dora");
    expect(screen.getByLabelText("Guest name")).toHaveFocus();
  });

  it("asks again for the waitlist on the pre-shift", async () => {
    const { state } = server();
    open(<PreShiftView venueId="v1" />);
    await screen.findByText("Ana");

    state.waitlist = [{ id: "w1", guestName: "Elena", partySize: 3, createdAt: new Date().toISOString() }];
    await wait(30_000);

    expect(await screen.findByText("Elena")).toBeInTheDocument();
  });

  it("is not asked for the floor editor, which is not a screen to watch", async () => {
    const { api } = server();
    open(<FloorEditor venueId="v1" />);
    await wait(0);
    const before = api.requests.length;
    await wait(5 * 60_000);
    expect(api.requests).toHaveLength(before);
  });
});

describe("when a refresh fails", () => {
  it("keeps the data, says since when once, and clears it on success", async () => {
    const { state } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");
    expect(notice()).toBeNull();
    expect(status()).toBeEmptyDOMElement();

    state.failing = true;
    await wait(30_000);

    await waitFor(() => expect(status()).toHaveTextContent(NOTICE_EN));
    expect(notice()).toHaveTextContent(NOTICE_EN);
    expect(screen.getByText("Ana")).toBeInTheDocument();

    // Later failures change nothing in the live region, so nothing is read out again.
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(status(), { childList: true, characterData: true, subtree: true });
    await wait(3 * 30_000);
    expect(changes).not.toHaveBeenCalled();
    observer.disconnect();

    state.failing = false;
    await wait(30_000);
    await waitFor(() => expect(notice()).toBeNull());
    expect(status()).toBeEmptyDOMElement();
  });

  it("says it in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    const { state } = server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");

    state.failing = true;
    await wait(30_000);

    await waitFor(() => expect(notice()).toHaveTextContent("No se ha podido actualizar. Hora de los datos: 19:10."));
  });

  it("says so when a read gets no answer at all", async () => {
    server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
      ),
    );
    await wait(30_000);
    expect(notice()).toBeNull();
    await wait(15_000);

    await waitFor(() => expect(notice()).toHaveTextContent(NOTICE_EN));
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });

  it("says so for a hung read while the server banner is retrying", async () => {
    server();
    open(
      <>
        <ServerBanner />
        <AgendaView venueId="v1" />
      </>,
    );
    await screen.findByText("Ana");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
      ),
    );
    // Another read failed first, so the banner is already asking again every 15 seconds.
    act(() => useServerStatus.getState().setDown(true));
    await wait(90_000);

    await waitFor(() => expect(notice()).toHaveTextContent(NOTICE_EN));
  });

  it("says so while the browser is offline", async () => {
    server();
    open(<AgendaView venueId="v1" />);
    await screen.findByText("Ana");

    act(() => onlineManager.setOnline(false));
    await wait(30_000);
    await waitFor(() => expect(notice()).toHaveTextContent(NOTICE_EN));

    act(() => onlineManager.setOnline(true));
    await wait(0);
    await waitFor(() => expect(notice()).toBeNull());
  });

  it("puts the age of the data on a printed pre-shift", async () => {
    const { state } = server();
    open(<PreShiftView venueId="v1" />);
    await screen.findByText("Ana");
    const printed = () => document.querySelector("strong.print\\:block");
    expect(printed()).toBeNull();

    state.failing = true;
    await wait(30_000);

    await waitFor(() => expect(printed()).toHaveTextContent(NOTICE_EN));
    // The floating notice is for the screen only.
    expect(notice()).toHaveClass("print:hidden");
  });

  it("leaves a screen that never loaded with its error, not a skeleton every half minute", async () => {
    const { state, api } = server();
    state.failing = true;
    open(<AgendaView venueId="v1" />);
    await screen.findByRole("alert");
    const before = api.calls("GET", AGENDA_PATH).length;

    await wait(5 * 60_000);

    expect(api.calls("GET", AGENDA_PATH)).toHaveLength(before);
    expect(notice()).toBeNull();
  });
});

describe("the time of the floor plan", () => {
  const asked = (api: ReturnType<typeof server>["api"]) => api.calls("GET", FLOOR_PATH).at(-1)!.path.split("?")[1];

  it("follows the clock today, replacing the plan in place", async () => {
    const { api, state } = server();
    open(<FloorView venueId="v1" />);
    await screen.findByText("Table 1");
    expect(screen.getByLabelText("Time")).toHaveValue("19:10");
    const canvas = screen.getByTestId("floor-canvas");

    await wait(60_000);

    await waitFor(() => expect(screen.getByLabelText("Time")).toHaveValue("19:11"));
    expect(asked(api)).toBe("date=2026-11-27&time=19:11");
    expect(screen.getByTestId("floor-canvas")).toBe(canvas);

    state.failing = true;
    await wait(60_000);
    await waitFor(() => expect(notice()).toHaveTextContent("Could not update. Data from 07:11 PM."));
    expect(screen.getByLabelText("Time")).toHaveValue("19:11");
    expect(screen.getByTestId("floor-canvas")).toBe(canvas);
  });

  it("stays at a time the person picked, until they ask for now", async () => {
    const { api } = server();
    open(<FloorView venueId="v1" />);
    await screen.findByText("Table 1");

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:00" } });
    await wait(5 * 60_000);

    expect(screen.getByLabelText("Time")).toHaveValue("21:00");
    expect(asked(api)).toBe("date=2026-11-27&time=21:00");

    await user().click(screen.getByRole("button", { name: "Now" }));
    await waitFor(() => expect(screen.getByLabelText("Time")).toHaveValue("19:15"));
    await wait(60_000);
    await waitFor(() => expect(screen.getByLabelText("Time")).toHaveValue("19:16"));
  });

  it("does not move on another day", async () => {
    const { api } = server();
    open(<FloorView venueId="v1" />);
    await screen.findByText("Table 1");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-28" } });
    await wait(5 * 60_000);

    expect(screen.getByLabelText("Time")).toHaveValue("19:10");
    expect(asked(api)).toBe("date=2026-11-28&time=19:10");
  });

  it("keeps the focus on a table that someone else seats", async () => {
    const { state } = server();
    open(<FloorView venueId="v1" />);
    const free = await screen.findByRole("button", { name: "Table 1, 2 seats, seat a walk-in" });
    act(() => free.focus());

    state.tables = [table({ occupied: true, reservationId: "r1", guestName: "Ana", partySize: 2 })];
    await wait(30_000);

    await waitFor(() => expect(screen.getByLabelText("Table 1 Ana 2 pax, 2 guests")).toHaveFocus());
  });
});
