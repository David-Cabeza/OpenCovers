import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/mock-api";
import { AgendaView } from "./agenda/agenda-view";
import { AvailabilityView } from "./availability/availability-view";
import { FloorView } from "./floor/floor-view";
import { PacingView } from "./pacing/pacing-view";
import { PreShiftView } from "./preshift/pre-shift-view";
import { SetupView } from "./setup/setup-view";
import { TeamView } from "./team/team-view";
import { WaitlistView } from "./waitlist/waitlist-view";

// A server that does not answer until the test says it does. Once it does, each path answers with the body it was given.
const server = vi.hoisted(() => ({ down: true, kind: "network" as "network" | "502" | "500", bodies: {} as Record<string, unknown> }));

beforeEach(() => {
  server.down = true;
  server.kind = "network";
  server.bodies = {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (server.down) {
      if (server.kind === "network") throw new TypeError("Failed to fetch");
      if (server.kind === "500") return new Response(JSON.stringify({ code: "transient" }), { status: 500, headers: { "Content-Type": "application/json" } });
      return new Response("bad gateway", { status: 502 });
    }
    const path = String(input).split("?")[0];
    const hit = Object.entries(server.bodies).find(([suffix]) => path.endsWith(suffix));
    return new Response(JSON.stringify(hit ? hit[1] : {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const SCREENS: [string, () => ReactElement, string, string][] = [
  ["the agenda", () => <AgendaView venueId="v1" />, "Could not load the agenda", "No reservations"],
  ["the pre-shift list", () => <PreShiftView venueId="v1" />, "Could not load the pre-shift list", "Nobody expected"],
  ["the floor plan", () => <FloorView venueId="v1" />, "Could not load the floor plan", "No tables yet"],
  ["availability", () => <AvailabilityView venueId="v1" />, "Could not load availability", "No services configured"],
  ["the waitlist", () => <WaitlistView venueId="v1" />, "Could not load the waitlist", "No one is waiting"],
  ["pacing", () => <PacingView venueId="v1" />, "Could not load pacing", "No services configured"],
];

describe.each(SCREENS)("%s when it cannot be loaded", (_what, view, title, emptyText) => {
  it("says so, and does not claim there is nothing", async () => {
    renderWithApp(view());
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The server could not be reached");
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
  });

  it("treats a 502 from the proxy in front of the API as the server not being reached", async () => {
    server.kind = "502";
    renderWithApp(view());
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The server could not be reached");
  });

  it("says the server answered with an error when the API itself reported one", async () => {
    server.kind = "500";
    renderWithApp(view());
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The server answered with an error");
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
  });
});

describe("Try again", () => {
  it("reads the data again, and shows it when the server is back", async () => {
    const user = userEvent.setup();
    renderWithApp(<AgendaView venueId="v1" />);
    await screen.findByText("Could not load the agenda");

    server.down = false;
    server.bodies = { "/agenda": { reservations: [] }, "/tables": { tables: [] } };
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No reservations")).toBeInTheDocument();
    expect(screen.queryByText("Could not load the agenda")).not.toBeInTheDocument();
  });

  it("stays on the error when the server is still down", async () => {
    const user = userEvent.setup();
    renderWithApp(<PacingView venueId="v1" />);
    await screen.findByText("Could not load pacing");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
    expect(screen.getByText("Could not load pacing")).toBeInTheDocument();
  });
});

describe("Settings when its cards cannot be loaded", () => {
  it("says so on each card, and offers no form that would save blanks over the real settings", async () => {
    const user = userEvent.setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const inSection = async (tab: string, whats: string[]) => {
      await user.click(screen.getByRole("tab", { name: tab }));
      for (const what of whats) {
        expect(await screen.findByText(`Could not load ${what}`), what).toBeInTheDocument();
      }
    };
    await inSection("General", ["the venue settings", "the booking policy"]);
    await inSection("Online", ["online booking", "the public profile"]);
    await inSection("Dining room", ["the services"]);
    // The tables are read by the list and by the floor editor, and both say so.
    expect(screen.getAllByText("Could not load the tables")).toHaveLength(2);
    await inSection("Developers", ["the API keys"]);
    for (const name of ["Save settings", "Save booking policy", "Save public profile", "Save online booking"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("No tables yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No services yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No keys yet.")).not.toBeInTheDocument();
  });

  it("shows a card again once its own data can be read", async () => {
    const user = userEvent.setup();
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    await user.click(screen.getByRole("tab", { name: "Dining room" }));
    await screen.findByText("Could not load the services");

    server.down = false;
    server.bodies = { "/services": { services: [] } };
    const retry = screen.getAllByRole("button", { name: "Try again" });
    // Every card has its own button; the one on the services card is the one that matters here.
    const card = screen.getByText("Could not load the services").closest("[role=alert]") as HTMLElement;
    await user.click(retry.find((b) => card.contains(b)) as HTMLElement);

    expect(await screen.findByText("No services yet.")).toBeInTheDocument();
  });
});

describe("Team when its cards cannot be loaded", () => {
  it("says so for the members and the invitations, not that there are none", async () => {
    renderWithApp(<TeamView venueId="v1" />);
    expect(await screen.findByText("Could not load the members")).toBeInTheDocument();
    expect(screen.getByText("Could not load the invitations")).toBeInTheDocument();
    expect(screen.queryByText("No members.")).not.toBeInTheDocument();
    expect(screen.queryByText("No invitations yet.")).not.toBeInTheDocument();
  });
});
