import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AvailabilityView } from "./availability-view";

const ROUTE = "GET /v1/venues/v1/availability";

const EXPLAIN = "GET /v1/venues/v1/availability/explain";

const AVAILABILITY = {
  dinner: [
    { time: "20:00", available: true, type: "standard" },
    { time: "20:15", available: false, type: "standard" },
    { time: "20:30", available: true, type: "standard" },
  ],
};

function setup() {
  const api = mockApi({
    [ROUTE]: { body: { availability: AVAILABILITY } },
    "GET /v1/venues/v1/tables": { body: { tables: [] } },
  });
  renderWithApp(<AvailabilityView venueId="v1" />);
  return { api, user: userEvent.setup() };
}

function setup2(explain: { status?: number; body?: unknown } = {
  body: {
    available: false,
    reasons: [{ code: "no_suitable_table", message: "No table fits 2 guests.", details: {} }],
    nearest: ["20:30", "20:45"],
  },
}) {
  const api = mockApi({
    [ROUTE]: { body: { availability: AVAILABILITY } },
    "GET /v1/venues/v1/tables": { body: { tables: [] } },
    [EXPLAIN]: explain,
  });
  renderWithApp(<AvailabilityView venueId="v1" />);
  return { api, user: userEvent.setup() };
}

describe("AvailabilityView", () => {
  afterEach(resetApiMocks);

  it("lists each service's slots, counts the free ones and keeps the taken ones clickable", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "dinner" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 free")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "20:00" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "20:15" })).toBeEnabled();
  });

  it("asks again for the new party size when the stepper changes it", async () => {
    const { api, user } = setup();
    await screen.findByRole("heading", { name: "dinner" });
    await user.click(screen.getByRole("button", { name: "More guests" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.path.includes("partySize=3"))).toBe(true),
    );
    expect(screen.getByLabelText("Party size")).toHaveValue(3);
  });

  it("never goes below one guest", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { name: "dinner" });
    await user.click(screen.getByRole("button", { name: "Fewer guests" }));
    expect(screen.getByRole("button", { name: "Fewer guests" })).toBeDisabled();
    expect(screen.getByLabelText("Party size")).toHaveValue(1);
  });

  it("opens the new reservation dialog for the chosen time", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "20:30" }));
    expect(await screen.findByText("New reservation")).toBeInTheDocument();
  });

  it("explains an unavailable slot with the reasons and the nearest free times", async () => {
    const { api, user } = setup2();
    await user.click(await screen.findByRole("button", { name: "20:15" }));
    expect(await screen.findByText("Why 20:15 is not available")).toBeInTheDocument();
    expect(await screen.findByText("No table fits 2 guests.")).toBeInTheDocument();
    expect(screen.getByText("Nearest free times")).toBeInTheDocument();
    const req = api.requests.find((r) => r.path.includes("/availability/explain"));
    expect(req?.path).toContain("time=20:15");
    expect(req?.path).toContain("partySize=2");
    expect(req?.path).toContain("date=");
  });

  it("opens the new reservation dialog when a nearest time is picked", async () => {
    const { user } = setup2();
    await user.click(await screen.findByRole("button", { name: "20:15" }));
    await user.click(await screen.findByRole("button", { name: "20:45" }));
    expect(await screen.findByText("New reservation")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Why 20:15 is not available")).not.toBeInTheDocument(),
    );
  });

  it("shows an error line when the explanation cannot be loaded", async () => {
    const { user } = setup2({ status: 500, body: { code: "internal" } });
    await user.click(await screen.findByRole("button", { name: "20:15" }));
    expect(await screen.findByText("Could not load the explanation.")).toBeInTheDocument();
  });

  it("does not ask for an explanation when a free slot is clicked", async () => {
    const { api, user } = setup2();
    await user.click(await screen.findByRole("button", { name: "20:30" }));
    expect(await screen.findByText("New reservation")).toBeInTheDocument();
    expect(api.requests.some((r) => r.path.includes("/availability/explain"))).toBe(false);
  });

  it("points the host to Settings when no service is configured", async () => {
    mockApi({ [ROUTE]: { body: { availability: {} } } });
    renderWithApp(<AvailabilityView venueId="v1" />);
    expect(await screen.findByText("No services configured")).toBeInTheDocument();
  });
});
