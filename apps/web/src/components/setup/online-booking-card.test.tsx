import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { OnlineBookingCard } from "./online-booking-card";
import { SetupView } from "./setup-view";

const PATH = "/v1/venues/v1/online-booking";
const ROTATE = `${PATH}/rotate-key`;

const SETTINGS = {
  enabled: false,
  bookingKey: null as string | null,
  allowedOrigins: [] as string[],
  services: null,
  weekdays: null,
  minPartySize: 1,
  maxPartySize: 8,
  leadTimeMinutes: 0,
  maxAdvanceDays: null,
  selfServiceCutoffMinutes: 120,
  maxOpenBookingsPerContact: 2,
  confirmationMode: "auto",
  askConsent: false,
  locale: "es",
  theme: {},
};

const SERVICES = {
  services: [
    { name: "lunch", openStart: "13:00", openEnd: "16:00", days: [1, 2, 3, 4, 5] },
    { name: "dinner", openStart: "20:00", openEnd: "23:00", days: [1, 2, 3, 4, 5, 6, 7] },
  ],
};

function setup(settings: Partial<typeof SETTINGS> = {}, extra: Parameters<typeof mockApi>[0] = {}) {
  const current = { ...SETTINGS, ...settings };
  return mockApi({
    [`GET ${PATH}`]: { body: current },
    [`PUT ${PATH}`]: (r) => ({ body: { ...current, ...(r.body as object), warnings: [] } }),
    "GET /v1/venues/v1/services": { body: SERVICES },
    ...extra,
  });
}

async function loaded() {
  await screen.findByLabelText("Largest party");
  await screen.findByLabelText("lunch");
}

describe("OnlineBookingCard", () => {
  afterEach(resetApiMocks);

  it("loads the settings", async () => {
    setup({ maxPartySize: 6, allowedOrigins: ["https://example.com"] });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await waitFor(() => expect(screen.getByLabelText("Largest party")).toHaveValue("6"));
    expect(screen.getByLabelText("Websites that may embed the page")).toHaveValue("https://example.com");
    expect(screen.getByLabelText("Accept online bookings")).not.toBeChecked();
    expect(screen.getByLabelText("lunch")).toBeChecked();
    expect(screen.getByText(/created the first time you turn online booking on/)).toBeInTheDocument();
  });

  it("sends only the changed fields when saving", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByLabelText("Accept online bookings"));
    const max = screen.getByLabelText("Largest party");
    await user.clear(max);
    await user.type(max, "10");
    await user.click(screen.getByLabelText("Sun"));
    await user.click(screen.getByLabelText("lunch"));
    await user.type(screen.getByLabelText("Websites that may embed the page"), "https://Example.com");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({
      enabled: true,
      maxPartySize: 10,
      weekdays: [1, 2, 3, 4, 5, 6],
      services: ["dinner"],
      allowedOrigins: ["https://example.com"],
    });
    expect(api.calls("PUT", PATH)[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText("Online booking saved")).toBeInTheDocument();
  });

  it("sends nothing when nothing changed", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    expect(await screen.findByText("Nothing to save")).toBeInTheDocument();
    expect(api.calls("PUT", PATH)).toHaveLength(0);
  });

  it("rejects invalid input in the form and sends nothing", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.clear(screen.getByLabelText("Largest party"));
    await user.type(screen.getByLabelText("Largest party"), "500");
    await user.type(screen.getByLabelText("Websites that may embed the page"), "http://example.com/path");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    expect(await screen.findByText("Whole number from 1 to 100.")).toBeInTheDocument();
    expect(screen.getByText(/Each address is https:\/\/host/)).toBeInTheDocument();
    expect(api.calls("PUT", PATH)).toHaveLength(0);
  });

  it("explains what is missing on online_booking_incomplete", async () => {
    const user = userEvent.setup();
    setup({}, { [`PUT ${PATH}`]: { status: 409, body: { code: "online_booking_incomplete" } } });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByLabelText("Accept online bookings"));
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    expect(await screen.findByText("Online booking cannot be turned on yet.")).toBeInTheDocument();
    expect(screen.getByText(/The venue needs a name/)).toBeInTheDocument();
    expect(screen.getByText(/has to open on at least one ticked day/)).toBeInTheDocument();
  });

  it("shows the key, copies it, and shows the embed code only while enabled", async () => {
    const user = userEvent.setup();
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(await screen.findByLabelText("Public booking key")).toHaveValue("pk_abc123");
    expect(screen.getByLabelText("Embed code")).toHaveValue(
      `<iframe src="${window.location.origin}/w/pk_abc123" title="Reservas" width="100%" height="640" style="border:0"></iframe>`,
    );

    const host = screen.getByLabelText("Address of the booking page");
    await user.clear(host);
    await user.type(host, "https://reservas.example.com/");
    expect(screen.getByLabelText("Embed code")).toHaveValue(
      '<iframe src="https://reservas.example.com/w/pk_abc123" title="Reservas" width="100%" height="640" style="border:0"></iframe>',
    );

    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(writeText).toHaveBeenCalledWith("pk_abc123");
  });

  it("hides the embed code while online booking is off, even with a key", async () => {
    setup({ enabled: false, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(await screen.findByLabelText("Public booking key")).toHaveValue("pk_abc123");
    expect(screen.queryByLabelText("Embed code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Address of the booking page")).not.toBeInTheDocument();
  });

  it("rotates the key only after confirmation, and says the old key stops at once", async () => {
    const user = userEvent.setup();
    const api = setup(
      { enabled: true, bookingKey: "pk_old" },
      { [`POST ${ROTATE}`]: { body: { ...SETTINGS, enabled: true, bookingKey: "pk_new" } } },
    );
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();
    await screen.findByLabelText("Public booking key");

    await user.click(screen.getByRole("button", { name: "Rotate key" }));
    expect(await screen.findByText(/stop working immediately/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.calls("POST", ROTATE)).toHaveLength(0);
    expect(screen.getByLabelText("Public booking key")).toHaveValue("pk_old");

    await user.click(screen.getByRole("button", { name: "Rotate key" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Rotate key") as HTMLElement,
    );

    await waitFor(() => expect(api.calls("POST", ROTATE)).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("Public booking key")).toHaveValue("pk_new"));
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).toContain("/w/pk_new");
  });

  it("shows a friendly message when the rotate is refused", async () => {
    const user = userEvent.setup();
    setup(
      { enabled: true, bookingKey: "pk_old" },
      { [`POST ${ROTATE}`]: { status: 403, body: { code: "forbidden" } } },
    );
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();
    await screen.findByLabelText("Public booking key");

    await user.click(screen.getByRole("button", { name: "Rotate key" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Rotate key") as HTMLElement,
    );

    expect(await screen.findByText("Only an admin can rotate the booking key.")).toBeInTheDocument();
    expect(screen.getByLabelText("Public booking key")).toHaveValue("pk_old");
  });

  it("is only shown to an admin in the Setup view", async () => {
    setup();
    const { unmount } = renderWithApp(<SetupView venueId="v1" role="write" />);
    await screen.findByText("Booking policy");
    expect(screen.queryByText("Online booking")).not.toBeInTheDocument();
    unmount();

    renderWithApp(<SetupView venueId="v1" role="admin" />);
    expect(await screen.findByText("Online booking")).toBeInTheDocument();
  });
});
