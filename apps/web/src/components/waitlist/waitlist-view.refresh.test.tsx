import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProvider } from "@/components/layout/navigation";
import type { WaitlistEntry } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { mockApi, renderWithApp, resetApiMocks, type MockResponse } from "@/test/mock-api";
import { WaitlistView } from "./waitlist-view";

const LIST = "GET /v1/venues/v1/waitlist";
const LIST_PATH = "/v1/venues/v1/waitlist";
const RECORD = "Record allergies or diets";
const GONE = "This entry is no longer waiting. It was already seated or removed.";

function entry(id: string, name: string, waited: number): WaitlistEntry {
  return {
    id,
    venueId: "v1",
    partySize: 2,
    zone: "",
    guestName: name,
    guestContact: "",
    status: "waiting",
    reservationId: null,
    createdAt: new Date(Date.now() - waited * 60_000).toISOString(),
  };
}

/** A server whose waitlist the test changes, as another session or a guest would. */
function server() {
  const state = { entries: [entry("w1", "Ana", 20), entry("w2", "Berta", 10), entry("w3", "Carlos", 5)], failing: false };
  const drop = (id: string) => {
    state.entries = state.entries.filter((e) => e.id !== id);
  };
  const write = (id: string) => (): MockResponse => {
    if (!state.entries.some((e) => e.id === id)) return { status: 409, body: { code: "invalid_transition" } };
    drop(id);
    return { body: { id: "r1", venueId: "v1" } };
  };
  const writes = Object.fromEntries(
    ["w1", "w2", "w3"].flatMap((id) => ["seat", "cancel"].map((action) => [`POST /v1/venues/v1/waitlist/${id}/${action}`, write(id)])),
  );
  const api = mockApi({
    "GET /v1/venues/v1/config": { body: { dietaryEnabled: true } },
    [LIST]: () => (state.failing ? { status: 500, body: { code: "internal" } } : { body: { entries: state.entries } }),
    ...writes,
  });
  return { state, api, drop };
}

// With the app's own defaults, which do not refetch on focus and keep data for half a minute.
async function open(role: "write" | "read" = "write") {
  renderWithApp(
    <NavigationProvider value={{ goTo: () => {}, role }}>
      <WaitlistView venueId="v1" />
    </NavigationProvider>,
    queryClient.getDefaultOptions().queries,
  );
  await screen.findByText("Ana");
}
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
const notice = () => document.querySelector("[data-slot=stale-notice]");
const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const seatOf = (name: string) => within(rowOf(name)).getByRole("button", { name: "Seat" });
const removeOf = (name: string) => within(rowOf(name)).getByRole("button", { name: "Remove from the waitlist" });
const add = () => screen.getByRole("button", { name: "Add" });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 27, 19, 10, 0));
});

afterEach(() => {
  resetApiMocks();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("a waitlist left open", () => {
  it("shows what others added and took away without being touched", async () => {
    const { state, drop } = server();
    await open();

    drop("w1");
    state.entries = [...state.entries, entry("w4", "Dora", 0)];
    await wait(30_000);

    expect(await screen.findByText("Dora")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("counts the waiting times up although nothing changed", async () => {
    server();
    await open();
    expect(rowOf("Ana")).toHaveTextContent("Waiting 20m");

    await wait(2 * 60_000);

    expect(rowOf("Ana")).toHaveTextContent("Waiting 22m");
    expect(screen.getByText("Longest wait").nextElementSibling).toHaveTextContent("22m");
  });

  it("keeps the entries and says since when if a refresh fails, with no error screen", async () => {
    const { state } = server();
    await open();

    state.failing = true;
    await wait(30_000);

    await waitFor(() => expect(notice()).toHaveTextContent("Could not update. Data from 07:10 PM."));
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    state.failing = false;
    await wait(30_000);
    await waitFor(() => expect(notice()).toBeNull());
  });

  it("keeps refreshing the date picked in the filter", async () => {
    const { api } = server();
    await open();
    await user().type(screen.getByLabelText("Show the waitlist for a date"), "2026-12-01");
    await screen.findByText("Ana");
    const asked = () => api.calls("GET", LIST_PATH).filter((r) => r.path.endsWith("?date=2026-12-01")).length;
    const before = asked();

    await wait(30_000);

    expect(asked()).toBe(before + 1);
    expect(screen.getByLabelText("Show the waitlist for a date")).toHaveValue("2026-12-01");
  });

  it("keeps a half-typed new entry and the focus in it", async () => {
    const { drop } = server();
    await open();
    const u = user();
    await u.click(add());
    await u.type(screen.getByLabelText("Guest name"), "Dor");

    drop("w1");
    await wait(30_000);

    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.getByLabelText("Guest name")).toHaveValue("Dor");
    expect(screen.getByLabelText("Guest name")).toHaveFocus();
  });
});

describe("an entry that another session took", () => {
  const seat = (u: ReturnType<typeof user>) => u.click(seatOf("Ana"));
  const remove = async (u: ReturnType<typeof user>) => {
    await u.click(removeOf("Ana"));
    await u.click(await screen.findByRole("button", { name: "Remove from waitlist" }));
  };

  it.each([
    ["seat", seat],
    ["remove", remove],
  ])("says so on %s and takes the row away", async (_, attempt) => {
    const { drop } = server();
    await open();
    drop("w1");

    await attempt(user());

    expect(await screen.findByText(GONE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
  });

  it("leaves the remove confirmation open, and then hands the focus to the next row", async () => {
    const { drop } = server();
    await open();
    const u = user();
    await u.click(removeOf("Berta"));
    const dialog = await screen.findByRole("dialog", { name: "Remove Berta from the waitlist?" });

    drop("w2");
    await wait(30_000);
    expect(screen.queryByText("Berta")).toBeNull();
    expect(dialog).toBeInTheDocument();

    await u.click(within(dialog).getByRole("button", { name: "Keep on waitlist" }));
    await waitFor(() => expect(rowOf("Carlos")).toHaveFocus());
  });
});

describe("the keyboard focus", () => {
  it("stays on a button whose row only moved up", async () => {
    const { drop } = server();
    await open();
    const button = seatOf("Berta");
    act(() => button.focus());

    drop("w1");
    await wait(30_000);

    expect(screen.queryByText("Ana")).toBeNull();
    expect(button).toHaveFocus();
  });

  it.each([
    ["the row that took its place", "Berta", "w2", "Carlos"],
    ["the row above when it was last", "Carlos", "w3", "Berta"],
  ])("goes to %s when a refresh removes the focused row, and not to its buttons", async (_, name, id, next) => {
    const { drop } = server();
    await open();
    act(() => seatOf(name).focus());

    drop(id);
    await wait(30_000);

    await waitFor(() => expect(rowOf(next)).toHaveFocus());
  });

  it("goes to Add when the last entry leaves", async () => {
    const { state } = server();
    await open();
    act(() => seatOf("Ana").focus());

    state.entries = [];
    await wait(30_000);

    await screen.findByText("No one is waiting");
    await waitFor(() => expect(add()).toHaveFocus());
  });

  it("is not moved when a row leaves and the focus was elsewhere", async () => {
    const { drop } = server();
    await open();
    const filter = screen.getByLabelText("Show the waitlist for a date");
    act(() => filter.focus());

    drop("w1");
    await wait(30_000);

    expect(filter).toHaveFocus();
  });

  it("goes to the next row after removing an entry by keyboard", async () => {
    server();
    await open();
    const u = user();
    act(() => removeOf("Ana").focus());
    await u.keyboard("{Enter}");
    const confirm = await screen.findByRole("button", { name: "Remove from waitlist" });
    act(() => confirm.focus());
    await u.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    await waitFor(() => expect(rowOf("Berta")).toHaveFocus());
  });

  it("goes to the next row after seating where there is no allergy shortcut", async () => {
    server();
    await open("read");
    act(() => seatOf("Ana").focus());
    await user().keyboard("{Enter}");

    await waitFor(() => expect(rowOf("Berta")).toHaveFocus());
  });

  it("goes to the allergy shortcut after seating, and a refresh leaves it there", async () => {
    const { drop } = server();
    await open();
    act(() => seatOf("Ana").focus());
    await user().keyboard("{Enter}");
    const shortcut = await screen.findByRole("button", { name: RECORD });
    await waitFor(() => expect(screen.queryByText("Ana", { selector: "li *" })).toBeNull());
    expect(shortcut).toHaveFocus();

    drop("w2");
    await wait(30_000);

    expect(screen.queryByText("Berta")).toBeNull();
    expect(shortcut).toHaveFocus();
    expect(shortcut).toHaveAccessibleDescription("You seated Ana.");
  });
});

describe("a row that a refresh moved", () => {
  const held = (name: string) => [seatOf(name), removeOf(name)].map((b) => b.getAttribute("aria-disabled") === "true");
  const writes = (api: ReturnType<typeof server>["api"]) => api.requests.filter((r) => r.method === "POST");

  it("ignores Seat and Remove for a second, and keeps the focus", async () => {
    const { api, drop } = server();
    await open();
    const u = user();
    const seat = seatOf("Berta");
    act(() => seat.focus());

    drop("w1");
    await wait(30_000);
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());

    expect(held("Berta")).toEqual([true, true]);
    expect(seat).toHaveFocus();
    await u.keyboard("{Enter}");
    await u.click(seat);
    await u.click(removeOf("Berta"));
    expect(writes(api)).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();

    await wait(1000);
    expect(held("Berta")).toEqual([false, false]);
    await u.click(seat);
    await waitFor(() => expect(writes(api)).toHaveLength(1));
  });

  it("is also one pushed down by an entry that appeared above it", async () => {
    const { state } = server();
    await open();

    state.entries = [...state.entries, entry("w4", "Dora", 30)];
    await wait(30_000);
    await screen.findByText("Dora");

    for (const name of ["Dora", "Ana", "Berta", "Carlos"]) expect(held(name)).toEqual([true, true]);
  });

  it("is not one above the change, nor one added at the end", async () => {
    const { state, drop } = server();
    await open();

    drop("w3");
    await wait(30_000);
    await waitFor(() => expect(screen.queryByText("Carlos")).toBeNull());
    expect(held("Ana")).toEqual([false, false]);
    expect(held("Berta")).toEqual([false, false]);

    state.entries = [...state.entries, entry("w4", "Dora", 0)];
    await wait(30_000);
    await screen.findByText("Dora");
    for (const name of ["Ana", "Berta", "Dora"]) expect(held(name)).toEqual([false, false]);
  });

  const seatAna = (u: ReturnType<typeof user>) => u.click(seatOf("Ana"));
  const removeAna = async (u: ReturnType<typeof user>) => {
    await u.click(removeOf("Ana"));
    await u.click(await screen.findByRole("button", { name: "Remove from waitlist" }));
  };

  it.each([
    ["seat", seatAna],
    ["removal", removeAna],
  ])("is not one that closed up after the user's own %s", async (_, attempt) => {
    server();
    await open();

    await attempt(user());
    await waitFor(() => expect(screen.queryByText("Ana", { selector: "li *" })).toBeNull());

    expect(held("Berta")).toEqual([false, false]);
    expect(held("Carlos")).toEqual([false, false]);
  });
});
