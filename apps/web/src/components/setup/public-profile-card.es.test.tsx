import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { PublicProfileCard } from "./public-profile-card";

const PATH = "/v1/venues/v1/public-profile";
const PROFILE = {
  publicProfileEnabled: false,
  street: "Calle Mayor 1",
  locality: "Madrid",
  postalCode: null,
  region: null,
  country: "ES",
  phone: null,
  websiteUrl: null,
  bookingUrl: null,
  cuisine: "Spanish",
  priceRange: "$$",
  latitude: null,
  longitude: null,
};

describe("PublicProfileCard in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the card and its validation errors in Spanish", async () => {
    const user = userEvent.setup();
    mockApi({ [`GET ${PATH}`]: { body: PROFILE } });
    renderWithApp(<PublicProfileCard venueId="v1" />);

    const street = await screen.findByLabelText("Calle");
    await waitFor(() => expect(street).toHaveValue("Calle Mayor 1"));
    expect(screen.getByText("Perfil público")).toBeInTheDocument();
    expect(screen.getByLabelText("Publicar el perfil público")).toBeInTheDocument();
    expect(screen.queryByText("Public profile")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Street")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("País"));
    await user.type(screen.getByLabelText("País"), "xx");
    await user.type(screen.getByLabelText("Latitud"), "40");
    await user.click(screen.getByRole("button", { name: "Guardar perfil público" }));

    expect(await screen.findByText("Usa un código de país de 2 letras en mayúsculas, por ejemplo ES.")).toBeInTheDocument();
    expect(screen.getByText("Indica la latitud y la longitud, o ninguna.")).toBeInTheDocument();
    expect(screen.queryByText(/2-letter upper-case/)).not.toBeInTheDocument();
  });

  it("puts the label in the too-long message", async () => {
    const user = userEvent.setup();
    mockApi({ [`GET ${PATH}`]: { body: PROFILE } });
    renderWithApp(<PublicProfileCard venueId="v1" />);
    const street = await screen.findByLabelText("Calle");
    await waitFor(() => expect(street).toHaveValue("Calle Mayor 1"));
    await user.type(street, "x".repeat(200));
    await user.click(screen.getByRole("button", { name: "Guardar perfil público" }));
    expect(await screen.findByText("Calle: máximo 200 caracteres.")).toBeInTheDocument();
  });
});
