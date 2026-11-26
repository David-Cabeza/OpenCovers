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
    expect(diner).toHaveAttribute("href", "/w/pk_abcdefghijklmnopqrstuv?scheme=light");
    expect(diner).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Restaurant")).toHaveAttribute("aria-current", "true");
  });

  it("links the Diner view to the widget's own origin when the API gives one", () => {
    search([]);
    renderWithApp(<DemoBar status={{ ...status, widgetOrigin: "https://book.demo.opencovers.dev" }} />);
    expect(screen.getByRole("link", { name: /Diner/ })).toHaveAttribute(
      "href",
      "https://book.demo.opencovers.dev/w/pk_abcdefghijklmnopqrstuv?scheme=light",
    );
  });

  it("opens the widget in the staff app's current look", () => {
    search([]);
    const origin = "https://book.demo.opencovers.dev";
    const link = () => screen.getByRole("link", { name: /Diner/ });
    document.documentElement.classList.remove("dark");
    const light = renderWithApp(<DemoBar status={{ ...status, widgetOrigin: origin }} />);
    expect(link()).toHaveAttribute("href", `${origin}/w/pk_abcdefghijklmnopqrstuv?scheme=light`);
    light.unmount();
    document.documentElement.classList.add("dark");
    renderWithApp(<DemoBar status={{ ...status, widgetOrigin: origin }} />);
    expect(link()).toHaveAttribute("href", `${origin}/w/pk_abcdefghijklmnopqrstuv?scheme=dark`);
    document.documentElement.classList.remove("dark");
  });

  it("lists the tour, and ticks steps from real bookings", async () => {
    search([reservation({ id: "a" }), reservation({ id: "b", status: "cancelled" })]);
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (2 of 4 done)")).toBeInTheDocument();
    expect(screen.getByText(/open View trace in its menu/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("names the time of the full evening, and keeps the table on Automatic", () => {
    search([]);
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText(/Tomorrow at 21:00 no table is left.*keep the table on Automatic/)).toBeInTheDocument();
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

  it("keeps the double-booking step as its own manual tick, apart from the agenda step", async () => {
    search([]);
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    const [agenda, rule] = screen.getAllByRole("button", { name: "Mark as done" });
    await user.click(rule!);
    expect(screen.getByText("Take the tour (1 of 4 done)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Mark as done" })).toHaveLength(1);
    expect(agenda).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("oc-demo-checklist:v1")!)).toEqual(["rule"]);
  });

  it("opens the agenda on the day of the diner's booking, not today", async () => {
    search([reservation({ id: "a", date: "2026-12-05" }), reservation({ id: "b", date: "2026-12-01" })]);
    const user = userEvent.setup();
    renderWithApp(<DemoBar status={status} />);
    await screen.findByText("Take the tour (1 of 4 done)");
    await user.click(screen.getByRole("button", { name: "Open agenda" }));
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-12-05");
    window.history.replaceState(null, "", "/");
  });

  it("speaks Spanish", async () => {
    search([]);
    useUiStore.setState({ locale: "es" });
    renderWithApp(<DemoBar status={status} />);
    expect(screen.getByText(/Se borrará el 3 de diciembre de 2026/)).toBeInTheDocument();
    expect(screen.getByText("Recorrido guiado: 0 de 4")).toBeInTheDocument();
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

  it("remembers the fold per sandbox, and starts open for a first visit", async () => {
    search([]);
    const user = userEvent.setup();
    const first = renderWithApp(<DemoBar status={status} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: /Take the tour/ }));
    expect(window.localStorage.getItem("oc-demo-folded:v1")).toBe("1");
    first.unmount();
    renderWithApp(<DemoBar status={status} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /Take the tour/ }));
    expect(window.localStorage.getItem("oc-demo-folded:v1")).toBe("0");
  });

  it("folds itself once all four steps are done, unless the visitor chose", async () => {
    search([reservation({ id: "a" }), reservation({ id: "b", status: "cancelled" })]);
    window.localStorage.setItem("oc-demo-checklist:v1", JSON.stringify(["agenda", "rule"]));
    renderWithApp(<DemoBar status={status} />);
    expect(await screen.findByText("Take the tour (4 of 4 done)")).toBeInTheDocument();
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
