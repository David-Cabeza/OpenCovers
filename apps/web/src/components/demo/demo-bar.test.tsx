import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { useUiStore } from "@/stores/ui-store";
import { DemoBar } from "./demo-bar";

const status = {
  enabled: true,
  googleEnabled: false,
  venueId: "v1",
  bookingKey: "pk_abcdefghijklmnopqrstuv",
  expiresAt: "2026-12-03T10:00:00.000Z",
};

const reservation = (over: Record<string, unknown>) => ({
  id: "r1",
  venueId: "v1",
  date: "2026-11-20",
  time: "20:00",
  service: "dinner",
  partySize: 2,
  status: "booked",
  version: 1,
  bookedVia: "widget",
  guest: { name: "Ana" },
  ...over,
});

function search(reservations: unknown[]) {
  mockApi({ "GET /v1/venues/v1/reservations/search": { body: { reservations } } });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApiMocks);

describe("the demo bar", () => {
  it("is a labelled region, so it sits inside a landmark", () => {
    search([]);
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByRole("region", { name: "Demo sandbox" })).toBeInTheDocument();
  });

  it("shows the expiry date, a deploy link, and a Diner link that opens the widget in a new tab", async () => {
    search([]);
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText(/deleted on December 3, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deploy it yourself" })).toHaveAttribute("href", expect.stringContaining("deploy"));
    const diner = screen.getByRole("link", { name: /Diner/ });
    expect(diner).toHaveAttribute("href", "/w/pk_abcdefghijklmnopqrstuv");
    expect(diner).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Restaurant")).toHaveAttribute("aria-current", "true");
  });

  it("lists the tour with a trace step, and ticks steps from real bookings", async () => {
    search([reservation({ id: "a" }), reservation({ id: "b", status: "cancelled" })]);
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (2 of 4 done)")).toBeInTheDocument();
    expect(screen.getByText(/Open its trace from the booking's menu/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("does not count a booking staff made as the diner's", async () => {
    search([reservation({ bookedVia: "staff" })]);
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (0 of 4 done)")).toBeInTheDocument();
  });

  it("keeps the manual tick for finding the booking in the agenda, and remembers it", async () => {
    search([]);
    const user = userEvent.setup();
    const first = renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getAllByRole("button", { name: "Mark as done" })[0]!);
    expect(screen.getByText("Take the tour (1 of 4 done)")).toBeInTheDocument();
    first.unmount();
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText("Take the tour (1 of 4 done)")).toBeInTheDocument();
  });

  it("keeps the trace step as its own manual tick, apart from the agenda step", async () => {
    search([]);
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    const [agenda, trace] = screen.getAllByRole("button", { name: "Mark as done" });
    await user.click(trace!);
    expect(screen.getByText("Take the tour (1 of 4 done)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Mark as done" })).toHaveLength(1);
    expect(agenda).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("oc-demo-checklist:v1")!)).toEqual(["trace"]);
  });

  it("sends a remembered consent once the visitor has a sandbox, then forgets it", async () => {
    window.localStorage.setItem("oc-demo-consent", JSON.stringify({ version: "v1" }));
    const api = mockApi({
      "GET /v1/venues/v1/reservations/search": { body: { reservations: [] } },
      // The API answers 204; the test mock cannot send an empty body, and the code treats any answer but 401 alike.
      "POST /api/demo/consent": { status: 200 },
    });
    renderWithApp(<DemoBar status={status} />);
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]!.body).toEqual({ version: "v1", locale: "en" });
    await waitFor(() => expect(window.localStorage.getItem("oc-demo-consent")).toBeNull());
  });

  it("speaks Spanish", async () => {
    search([]);
    useUiStore.setState({ locale: "es" });
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText(/Se borra el 3 de diciembre de 2026/)).toBeInTheDocument();
    expect(screen.getByText("Haz el recorrido (0 de 4 hechos)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Cliente/ })).toBeInTheDocument();
  });

  it("works when the browser refuses storage", async () => {
    search([]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getAllByRole("button", { name: "Mark as done" })[0]!);
    expect(screen.getByText("Take the tour (1 of 4 done)")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("collapses the checklist", async () => {
    search([]);
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    await user.click(screen.getByRole("button", { name: /Take the tour/ }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("the agenda this tab already loaded", () => {
  it("is asked again when the diner's booking arrives", async () => {
    let calls = 0;
    mockApi({
      "GET /v1/venues/v1/reservations/search": () => {
        calls += 1;
        return { body: { reservations: calls > 1 ? [reservation({ id: "a" })] : [] } };
      },
    });
    const { queryClient } = renderWithApp(<DemoBar status={status} />);
    await waitFor(() => expect(queryClient.getQueryData(["demo-widget-bookings", "v1"])).toBeDefined());
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await queryClient.invalidateQueries({ queryKey: ["demo-widget-bookings", "v1"] });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["agenda", "v1"] }));
  });
});
