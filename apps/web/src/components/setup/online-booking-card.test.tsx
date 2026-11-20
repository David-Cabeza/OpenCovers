import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, FONT_STACKS, isLogoUrl, isPrivacyNoticeUrl, DEFAULT_DARK_COLORS } from "@/lib/online-booking";
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
  privacyNoticeUrl: null as string | null,
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

  it("reverts the switch and lists only what is missing on online_booking_incomplete", async () => {
    const user = userEvent.setup();
    setup(
      {},
      {
        [`PUT ${PATH}`]: { status: 409, body: { code: "online_booking_incomplete" } },
        "GET /v1/venues": { body: { venues: [{ id: "v1", name: "Casa", timezone: "UTC", enabled: true, role: "admin" }] } },
        "GET /v1/venues/v1/services": { body: { services: [] } },
      },
    );
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await screen.findByLabelText("Largest party");

    await user.click(screen.getByLabelText("Accept online bookings"));
    expect(screen.getByLabelText("Accept online bookings")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    expect(await screen.findByText(/Nothing was saved/)).toBeInTheDocument();
    expect(screen.getByLabelText("Accept online bookings")).not.toBeChecked();
    expect(screen.getByText(/Add at least one service/)).toBeInTheDocument();
    expect(screen.queryByText(/The venue needs a name/)).not.toBeInTheDocument();
  });

  it("lists the missing venue name", async () => {
    const user = userEvent.setup();
    setup(
      {},
      {
        [`PUT ${PATH}`]: { status: 409, body: { code: "online_booking_incomplete" } },
        "GET /v1/venues": { body: { venues: [{ id: "v1", name: " ", timezone: "UTC", enabled: true, role: "admin" }] } },
      },
    );
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();
    await user.click(screen.getByLabelText("Accept online bookings"));
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    expect(await screen.findByText(/The venue needs a name/)).toBeInTheDocument();
    expect(screen.queryByText(/Add at least one service/)).not.toBeInTheDocument();
  });

  it("keeps unsaved edits when the settings refetch with the same values", async () => {
    const user = userEvent.setup();
    setup();
    const { queryClient } = renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByLabelText("Accept online bookings"));
    await user.clear(screen.getByLabelText("Largest party"));
    await user.type(screen.getByLabelText("Largest party"), "5");
    // A new object with the same saved values, as a refetch or a cache write can produce.
    act(() => {
      queryClient.setQueryData(["online-booking", "v1"], { ...SETTINGS, theme: {} });
    });
    await queryClient.invalidateQueries({ queryKey: ["online-booking", "v1"] });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(screen.getByLabelText("Accept online bookings")).toBeChecked();
    expect(screen.getByLabelText("Largest party")).toHaveValue("5");
  });


  it("shows the key and copies it", async () => {
    const user = userEvent.setup();
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(await screen.findByLabelText("Public booking key")).toHaveValue("pk_abc123");
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(writeText).toHaveBeenCalledWith("pk_abc123");
  });

  it("shows both embed snippets with the shared address, and copies each", async () => {
    const user = userEvent.setup();
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    const o = window.location.origin;
    const script = screen.getByLabelText(/Embed code with automatic height/);
    const frame = screen.getByLabelText("Embed code with a fixed height");
    expect(script).toHaveValue(`<script src="${o}/w/embed.js" data-key="pk_abc123" async></script>`);
    expect(frame).toHaveValue(
      `<iframe src="${o}/w/pk_abc123" title="Book a table" width="100%" height="640" style="border:0" loading="lazy"></iframe>`,
    );

    const host = screen.getByLabelText("Address of the booking page");
    await user.clear(host);
    await user.type(host, "https://reservas.example.com/");
    expect(script).toHaveValue(
      '<script src="https://reservas.example.com/w/embed.js" data-key="pk_abc123" async></script>',
    );
    expect(frame).toHaveValue(
      '<iframe src="https://reservas.example.com/w/pk_abc123" title="Book a table" width="100%" height="640" style="border:0" loading="lazy"></iframe>',
    );

    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy script embed code" }));
    expect(writeText).toHaveBeenLastCalledWith(
      '<script src="https://reservas.example.com/w/embed.js" data-key="pk_abc123" async></script>',
    );
    await user.click(screen.getByRole("button", { name: "Copy embed code" }));
    expect(writeText).toHaveBeenLastCalledWith((frame as HTMLTextAreaElement).value);
  });

  it("adds the dark-mode option to both snippets when asked", async () => {
    const user = userEvent.setup();
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    const o = window.location.origin;
    const script = screen.getByLabelText(/Embed code with automatic height/);
    const frame = screen.getByLabelText("Embed code with a fixed height");
    await user.click(screen.getByRole("switch", { name: /Follow my visitors/ }));
    expect(script).toHaveValue(`<script src="${o}/w/embed.js" data-key="pk_abc123" data-scheme="auto" async></script>`);
    expect(frame).toHaveValue(
      `<iframe src="${o}/w/pk_abc123?scheme=auto" title="Book a table" width="100%" height="640" style="border:0" loading="lazy"></iframe>`,
    );

    await user.click(screen.getByRole("switch", { name: /Follow my visitors/ }));
    expect(script).toHaveValue(`<script src="${o}/w/embed.js" data-key="pk_abc123" async></script>`);
  });

  it("flags an address that is not an origin and disables both copy buttons", async () => {
    const user = userEvent.setup();
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.queryByText(/Enter the address as https:\/\/host/)).not.toBeInTheDocument();
    const host = screen.getByLabelText("Address of the booking page");
    await user.clear(host);
    await user.type(host, "https://reservas.example.com/path");
    expect(screen.getByText(/Enter the address as https:\/\/host/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy script embed code" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy embed code" })).toBeDisabled();
  });

  it("tells which Content-Security-Policy directives each snippet needs", async () => {
    setup({ enabled: true, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.getByText(/lets you paste a script/).textContent).toMatch(/script-src and frame-src/);
    const fallback = screen.getByText(/removes scripts/).textContent ?? "";
    expect(fallback).toMatch(/frame-src/);
    expect(fallback).not.toMatch(/script-src/);
  });

  it("hides the embed code while online booking is off, even with a key", async () => {
    setup({ enabled: false, bookingKey: "pk_abc123" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(await screen.findByLabelText("Public booking key")).toHaveValue("pk_abc123");
    expect(screen.queryByLabelText("Embed code with a fixed height")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Embed code with automatic height/)).not.toBeInTheDocument();
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
    expect((screen.getByLabelText("Embed code with a fixed height") as HTMLTextAreaElement).value).toContain("/w/pk_new");
    expect((screen.getByLabelText(/Embed code with automatic height/) as HTMLTextAreaElement).value).toContain(
      'data-key="pk_new"',
    );
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

  it("shows the built-in look when the venue has no theme", async () => {
    setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.getByLabelText("Buttons")).toHaveValue(DEFAULT_THEME.colors.primary);
    expect(screen.getByLabelText("Text")).toHaveValue(DEFAULT_THEME.colors.text);
    expect(screen.getByLabelText("Corner radius (px)")).toHaveValue("8");
    expect(screen.getByLabelText("Font")).toHaveValue("system");
    expect(screen.getByLabelText("Logo address")).toHaveValue("");
    expect(screen.getByRole("img", { name: "Preview of the booking page" })).toHaveStyle({
      background: DEFAULT_THEME.colors.background,
    });
  });

  it("sends only the theme keys that differ from the built-in look, and the preview follows", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    fireEvent.change(screen.getByLabelText("Buttons"), { target: { value: "#aa0000" } });
    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "#fafafa" } });
    await user.clear(screen.getByLabelText("Corner radius (px)"));
    await user.type(screen.getByLabelText("Corner radius (px)"), "0");
    await user.selectOptions(screen.getByLabelText("Font"), "serif");
    await user.type(screen.getByLabelText("Logo address"), "https://cdn.example.com/logo.png");
    const preview = screen.getByRole("img", { name: "Preview of the booking page" });
    expect(preview).toHaveStyle({ background: "#fafafa", borderRadius: "0px" });
    expect(within(preview).getByText("Book")).toHaveStyle({ background: "#aa0000" });
    expect(within(preview).getByText("Logo")).toBeInTheDocument();
    expect(preview.querySelector("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({
      theme: {
        colors: { primary: "#aa0000", background: "#fafafa" },
        radius: 0,
        font: "serif",
        logoUrl: "https://cdn.example.com/logo.png",
      },
    });
  });

  it("refuses a logo that is not an https image address and sends nothing", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.type(screen.getByLabelText("Logo address"), "http://example.com/l.png");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    expect(
      await screen.findByText("An https address of an image, with no spaces, up to 2048 characters."),
    ).toBeInTheDocument();
    for (const bad of [
      "http://example.com/l.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pw@example.com/l.png",
      "https://example.com/a b.png",
      `https://example.com/${"a".repeat(2048)}`,
    ]) {
      expect(isLogoUrl(bad), bad).toBe(false);
    }
    expect(isLogoUrl("https://cdn.example.com/logo.png")).toBe(true);
    await user.clear(screen.getByLabelText("Corner radius (px)"));
    await user.type(screen.getByLabelText("Corner radius (px)"), "30");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    expect(await screen.findByText("Whole number of pixels from 0 to 24.")).toBeInTheDocument();
    expect(api.calls("PUT", PATH)).toHaveLength(0);
  });

  it("labels the privacy notice field and says the venue supplies its own notice", async () => {
    setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    const field = screen.getByLabelText("Privacy notice address");
    expect(field).toHaveValue("");
    expect(field).toHaveAccessibleDescription(/You write and host it\. OpenCovers writes no legal text/);
  });

  it("saves a privacy notice address, trimmed, and sends only that field", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.type(screen.getByLabelText("Privacy notice address"), "  https://example.com/privacy  ");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0]!.body).toEqual({ privacyNoticeUrl: "https://example.com/privacy" });
  });

  it("shows the stored address and clears it with null when emptied", async () => {
    const user = userEvent.setup();
    const api = setup({ privacyNoticeUrl: "https://example.com/privacy" });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    const field = screen.getByLabelText("Privacy notice address");
    await waitFor(() => expect(field).toHaveValue("https://example.com/privacy"));
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0]!.body).toEqual({ privacyNoticeUrl: null });
  });

  it("refuses a privacy notice address the API would refuse and sends nothing", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.type(screen.getByLabelText("Privacy notice address"), "http://example.com/privacy");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    const message = await screen.findByText("An https address with no spaces, up to 2048 characters.");
    expect(message).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Privacy notice address")).toHaveAttribute("aria-invalid", "true");
    expect(api.calls("PUT", PATH)).toHaveLength(0);

    for (const bad of [
      "http://example.com/p",
      "javascript:alert(1)",
      "data:text/html,hi",
      "example.com/p",
      "https://",
      "https:///p",
      "https:example.com/p",
      "https://user:pw@example.com/",
      "https://user@example.com/",
      "https://example.com/a b",
      "https://example.com/\n",
      `https://example.com/${"a".repeat(2049 - 20)}`,
    ]) {
      expect(isPrivacyNoticeUrl(bad), bad).toBe(false);
    }
    for (const good of ["https://example.com/privacy", "HTTPS://Example.com/P?x=1#y", "https://example.com:8443/"]) {
      expect(isPrivacyNoticeUrl(good), good).toBe(true);
    }
    expect(isPrivacyNoticeUrl(`https://example.com/${"a".repeat(2048 - 20)}`)).toBe(true);
  });

  it("resets the look to the built-in defaults with theme null", async () => {
    const user = userEvent.setup();
    const api = setup({ theme: { colors: { primary: "#aa0000" }, font: "rounded" } } as Partial<typeof SETTINGS>, {
      [`PUT ${PATH}`]: { body: { ...SETTINGS, warnings: [] } },
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await waitFor(() => expect(screen.getByLabelText("Buttons")).toHaveValue("#aa0000"));
    await user.click(screen.getByRole("button", { name: "Reset look to defaults" }));
    expect(screen.getByLabelText("Font")).toHaveValue("system");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: null });
  });

  it("shows the contrast warning after a save that the engine accepted with low_contrast", async () => {
    const user = userEvent.setup();
    setup({}, {
      [`PUT ${PATH}`]: (r) => ({
        body: {
          ...SETTINGS,
          ...(r.body as object),
          warnings: [{ code: "low_contrast", message: "low", ratio: 1.24 }],
        },
      }),
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "#dddddd" } });
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    const alert = await screen.findByText(/contrast of 1.24:1 against the background/);
    expect(alert).toHaveTextContent("Saved, but");
    expect(alert).toHaveTextContent("4.5:1");
  });

  it("offers a dark palette that starts from the built-in dark colors, with its own preview", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.queryByLabelText("Dark: background")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Preview of the booking page in dark mode" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));

    expect(screen.getByLabelText("Dark: buttons")).toHaveValue(DEFAULT_DARK_COLORS.primary);
    expect(screen.getByLabelText("Dark: text")).toHaveValue(DEFAULT_DARK_COLORS.text);
    const preview = screen.getByRole("img", { name: "Preview of the booking page in dark mode" });
    expect(preview).toHaveStyle({ background: DEFAULT_DARK_COLORS.background });
    fireEvent.change(screen.getByLabelText("Dark: background"), { target: { value: "#000000" } });
    expect(preview).toHaveStyle({ background: "#000000" });
    expect(screen.getByRole("img", { name: "Preview of the booking page" })).toHaveStyle({
      background: DEFAULT_THEME.colors.background,
    });
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: { darkColors: { background: "#000000" } } });
  });

  it("sends an empty dark palette when it is turned on and left as the built-in one", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    fireEvent.change(screen.getByLabelText("Buttons"), { target: { value: "#aa0000" } });
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: { colors: { primary: "#aa0000" }, darkColors: {} } });
  });

  it("loads a saved dark palette, and turning it off removes it", async () => {
    const user = userEvent.setup();
    const api = setup({ theme: { darkColors: { background: "#101010" } } } as Partial<typeof SETTINGS>, {
      [`PUT ${PATH}`]: { body: { ...SETTINGS, warnings: [] } },
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await waitFor(() => expect(screen.getByLabelText("Dark: background")).toHaveValue("#101010"));
    expect(screen.getByLabelText("Dark: text")).toHaveValue(DEFAULT_DARK_COLORS.text);
    expect(screen.getByRole("switch", { name: "Choose a look for dark mode" })).toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    expect(screen.queryByLabelText("Dark: background")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: null });
  });

  it("shows the dark contrast warning apart from the light one", async () => {
    const user = userEvent.setup();
    setup({}, {
      [`PUT ${PATH}`]: (r) => ({
        body: {
          ...SETTINGS,
          ...(r.body as object),
          warnings: [{ code: "low_contrast", message: "low", ratio: 2.1, palette: "dark" }],
        },
      }),
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    fireEvent.change(screen.getByLabelText("Dark: background"), { target: { value: "#eeeeee" } });
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    const alert = await screen.findByText(/dark text color has a contrast of 2.1:1/);
    expect(alert).toHaveTextContent("4.5:1");
    expect(screen.queryByText(/Saved, but the text color has a contrast/)).not.toBeInTheDocument();
  });

  it("lets the dark look have its own corner radius and font, and the preview follows", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.queryByLabelText("Corner radius in dark mode (px)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    const radius = screen.getByLabelText("Corner radius in dark mode (px)");
    expect(radius).toHaveValue("");
    expect(radius).toHaveAttribute("placeholder", "Same as light");
    expect(screen.getByLabelText("Font in dark mode")).toHaveValue("");

    await user.type(radius, "16");
    await user.selectOptions(screen.getByLabelText("Font in dark mode"), "serif");
    const dark = screen.getByRole("img", { name: "Preview of the booking page in dark mode" });
    expect(dark).toHaveStyle({ borderRadius: "16px" });
    expect(dark.getAttribute("style")).toContain("serif");
    expect(screen.getByRole("img", { name: "Preview of the booking page" })).toHaveStyle({ borderRadius: "8px" });
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: { darkColors: {}, darkRadius: 16, darkFont: "serif" } });
  });

  it("leaves out a dark radius or font that equals the light one", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.selectOptions(screen.getByLabelText("Font"), "serif");
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    await user.type(screen.getByLabelText("Corner radius in dark mode (px)"), "8");
    await user.selectOptions(screen.getByLabelText("Font in dark mode"), "serif");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: { font: "serif", darkColors: {} } });
  });

  it("refuses a dark corner radius outside 0 to 24 and sends nothing", async () => {
    const user = userEvent.setup();
    const api = setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    await user.type(screen.getByLabelText("Corner radius in dark mode (px)"), "30");
    await user.click(screen.getByRole("button", { name: "Save online booking" }));
    expect(
      await screen.findByText("Whole number of pixels from 0 to 24, or empty for the same as light mode."),
    ).toBeInTheDocument();
    expect(api.calls("PUT", PATH)).toHaveLength(0);
  });

  it("turns the switch on for a saved dark radius or font alone, and turning it off removes them", async () => {
    const user = userEvent.setup();
    const api = setup({ theme: { darkRadius: 16, darkFont: "rounded" } } as Partial<typeof SETTINGS>, {
      [`PUT ${PATH}`]: { body: { ...SETTINGS, warnings: [] } },
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await waitFor(() => expect(screen.getByLabelText("Corner radius in dark mode (px)")).toHaveValue("16"));
    expect(screen.getByLabelText("Font in dark mode")).toHaveValue("rounded");
    expect(screen.getByRole("switch", { name: "Choose a look for dark mode" })).toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Choose a look for dark mode" }));
    await user.click(screen.getByRole("button", { name: "Save online booking" }));

    await waitFor(() => expect(api.calls("PUT", PATH)).toHaveLength(1));
    expect(api.calls("PUT", PATH)[0].body).toEqual({ theme: null });
  });

  it("keeps the built-in dark look equal to the widget's stylesheet", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../../../widget/src/styles.css"), "utf8");
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));
    const vars = {
      primary: "--oc-primary",
      onPrimary: "--oc-on-primary",
      background: "--oc-background",
      surface: "--oc-surface",
      text: "--oc-text",
      muted: "--oc-muted",
      border: "--oc-border",
    } as const;
    for (const [key, name] of Object.entries(vars)) {
      expect(dark).toContain(`${name}: ${DEFAULT_DARK_COLORS[key as keyof typeof vars]};`);
    }
  });

  it("keeps the built-in look equal to the widget's stylesheet", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../../../widget/src/styles.css"), "utf8");
    const vars = {
      primary: "--oc-primary",
      onPrimary: "--oc-on-primary",
      background: "--oc-background",
      surface: "--oc-surface",
      text: "--oc-text",
      muted: "--oc-muted",
      border: "--oc-border",
    } as const;
    for (const [key, name] of Object.entries(vars)) {
      expect(css).toContain(`${name}: ${DEFAULT_THEME.colors[key as keyof typeof vars]};`);
    }
    expect(css).toContain(`--oc-radius: ${DEFAULT_THEME.radius}px;`);
    expect(css).toContain(`--oc-font: ${FONT_STACKS.system};`);
    const widgetTheme = readFileSync(path.resolve(import.meta.dirname, "../../../../widget/src/theme.ts"), "utf8");
    for (const stack of Object.values(FONT_STACKS)) expect(widgetTheme).toContain(`'${stack}'`);
  });

  it("is only shown to an admin in the Setup view", async () => {
    setup();
    const { unmount } = renderWithApp(<SetupView venueId="v1" role="write" />);
    await screen.findByText("Booking policy");
    expect(screen.queryByText("Online booking")).not.toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/?section=online");
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    expect(await screen.findByText("Online booking")).toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });
});
