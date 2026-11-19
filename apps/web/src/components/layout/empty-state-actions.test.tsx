import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/api";
import { AvailabilityView } from "../availability/availability-view";
import { FloorView } from "../floor/floor-view";
import { PacingView } from "../pacing/pacing-view";
import { NavigationProvider } from "./navigation";

// Every call answers with an empty venue: no tables, no floor items, no services.
function emptyVenue() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes("/floor-items")
        ? { items: [] }
        : u.includes("/floor")
          ? { tables: [] }
          : u.includes("/pacing")
            ? { pacing: [] }
            : u.includes("/availability")
              ? { availability: {} }
              : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
}

function show(view: ReactElement, nav?: { role?: Role; goTo: () => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {nav ? <NavigationProvider value={nav}>{view}</NavigationProvider> : view}
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const CASES: [string, () => ReactElement, string, string, string][] = [
  ["Floor plan", () => <FloorView venueId="v1" />, "No tables yet", "Add tables", "room"],
  ["Availability", () => <AvailabilityView venueId="v1" />, "No services configured", "Add services", "services"],
  ["Pacing", () => <PacingView venueId="v1" />, "No services configured", "Add services", "services"],
];

describe.each(CASES)("the empty state of %s", (_name, view, title, label, target) => {
  it.each<Role>(["write", "admin"])("takes a %s to the right place in Settings", async (role) => {
    emptyVenue();
    const goTo = vi.fn();
    const user = userEvent.setup();
    show(view(), { role, goTo });
    expect(await screen.findByText(title)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: label }));

    expect(goTo).toHaveBeenCalledExactlyOnceWith("setup", target);
  });

  it("offers nothing to a read-only role, which cannot add anything", async () => {
    emptyVenue();
    show(view(), { role: "read", goTo: vi.fn() });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });

  it("offers nothing while the role is not known yet", async () => {
    emptyVenue();
    show(view(), { goTo: vi.fn() });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });

  it("offers nothing outside the dashboard, where there is nowhere to go", async () => {
    emptyVenue();
    show(view());
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });
});
