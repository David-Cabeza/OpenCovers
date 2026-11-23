import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { OnlineBookingCard } from "./online-booking-card";

const PATH = "/v1/venues/v1/online-booking";

const SETTINGS = {
  enabled: true,
  bookingKey: "abc123" as string | null,
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
  publicZones: [] as string[],
  showServiceNames: false,
  waitlistEnabled: false,
  theme: {},
};

const SERVICES = {
  services: [{ name: "lunch", openStart: "13:00", openEnd: "16:00", days: [1, 2, 3, 4, 5] }],
};

function setup(warnings: unknown[] = []) {
  return mockApi({
    [`GET ${PATH}`]: { body: SETTINGS },
    [`PUT ${PATH}`]: (r) => ({ body: { ...SETTINGS, ...(r.body as object), warnings } }),
    "GET /v1/venues/v1/services": { body: SERVICES },
  });
}

async function loaded() {
  await screen.findByLabelText("Grupo más grande");
  await screen.findByLabelText("lunch");
}

describe("OnlineBookingCard in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the card, the switches and the embed section in Spanish", async () => {
    setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.getByText("Reserva en línea")).toBeInTheDocument();
    expect(screen.getByLabelText("Aceptar reservas en línea")).toBeChecked();
    expect(screen.getByLabelText("Elegir un aspecto para el modo oscuro")).toBeInTheDocument();
    expect(screen.getByLabelText("Lun")).toBeInTheDocument();
    expect(screen.getByText("20:00 · 2 personas")).toBeInTheDocument();
    expect(screen.getByText("Página de reservas y código para incrustar")).toBeInTheDocument();
    expect((screen.getByLabelText("Código para incrustar con altura fija") as HTMLTextAreaElement).value).toContain(
      'title="Book a table"',
    );
    expect(screen.getByText(/Úsalo cuando el editor de tu web elimina los scripts/)).toBeInTheDocument();
    expect(screen.getAllByText("frame-src")[0].tagName).toBe("CODE");
    expect(screen.queryByText("Online booking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Largest party")).not.toBeInTheDocument();
  });

  it("shows validation errors in Spanish", async () => {
    const user = userEvent.setup();
    setup();
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    const max = screen.getByLabelText("Grupo más grande");
    await user.clear(max);
    await user.type(max, "500");
    await user.click(screen.getByRole("button", { name: "Guardar reserva en línea" }));

    expect(await screen.findByText("Un número entero de 1 a 100.")).toBeInTheDocument();
    expect(screen.queryByText("Whole number from 1 to 100.")).not.toBeInTheDocument();
  });

  it("shows the contrast warning in Spanish", async () => {
    const user = userEvent.setup();
    setup([{ code: "low_contrast", message: "x", ratio: 2.5 }]);
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    await user.click(screen.getByLabelText("Lun"));
    await user.click(screen.getByRole("button", { name: "Guardar reserva en línea" }));

    await waitFor(() =>
      expect(screen.getByText(/Guardado, pero el color del texto tiene un contraste de 2.5:1 con el fondo/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Saved, but/)).not.toBeInTheDocument();
  });

  it("shows the zones and service names fields and their errors in Spanish", async () => {
    const user = userEvent.setup();
    mockApi({
      [`GET ${PATH}`]: { body: SETTINGS },
      [`PUT ${PATH}`]: (r) => ({ body: { ...SETTINGS, ...(r.body as object), warnings: [] } }),
      "GET /v1/venues/v1/services": { body: SERVICES },
      "GET /v1/venues/v1/tables": {
        body: {
          tables: [
            { id: "a", name: "A", seats: 4, zone: "terraza", shape: "round", posX: 0, posY: 0, rotation: 0 },
            { id: "b", name: "B", seats: 4, zone: "sala", shape: "round", posX: 0, posY: 0, rotation: 0 },
          ],
        },
      },
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();

    expect(screen.getByText("Zonas públicas")).toBeInTheDocument();
    expect(screen.getByLabelText("Mostrar los nombres de los servicios")).toBeInTheDocument();
    await user.click(await screen.findByLabelText("terraza"));
    await user.click(screen.getByRole("button", { name: "Guardar reserva en línea" }));
    expect(await screen.findByText("Elige al menos dos zonas, o ninguna.")).toBeInTheDocument();
    expect(screen.queryByText(/Pick at least two zones/)).not.toBeInTheDocument();
  });

  it("disables the waitlist switch in the demo with a Spanish note", async () => {
    mockApi({
      [`GET ${PATH}`]: { body: SETTINGS },
      "GET /v1/venues/v1/services": { body: SERVICES },
      "GET /api/demo/status": { body: { enabled: true, googleEnabled: false } },
    });
    renderWithApp(<OnlineBookingCard venueId="v1" />);
    await loaded();
    await screen.findByText("No disponible en la demo.");
    expect(screen.getByLabelText("Lista de espera para días completos")).toBeDisabled();
  });
});
