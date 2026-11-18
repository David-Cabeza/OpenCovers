import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AvailabilityView } from "./availability-view";

const ROUTE = "GET /v1/venues/v1/availability";

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

describe("AvailabilityView", () => {
  afterEach(resetApiMocks);

  it("lists each service's slots, counts the free ones and disables the taken ones", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "dinner" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 free")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "20:00" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "20:15" })).toBeDisabled();
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

  it("points the host to Settings when no service is configured", async () => {
    mockApi({ [ROUTE]: { body: { availability: {} } } });
    renderWithApp(<AvailabilityView venueId="v1" />);
    expect(await screen.findByText("No services configured")).toBeInTheDocument();
  });
});
