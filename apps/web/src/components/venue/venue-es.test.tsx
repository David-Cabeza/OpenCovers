import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { renderWithApp } from "@/test/mock-api";
import { EmptyVenues } from "./empty-venues";

describe("Venues in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));

  it("shows the empty screen and the creation dialog in Spanish", async () => {
    const user = userEvent.setup();
    renderWithApp(<EmptyVenues />);
    expect(screen.getByRole("heading", { name: "Aún no tienes locales" })).toBeInTheDocument();
    expect(screen.queryByText("No venues yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear tu primer local" }));
    expect(await screen.findByText("Crear un local")).toBeInTheDocument();
    expect(screen.getByText("Zona horaria")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear local" }));
    expect(await screen.findByText("El nombre es obligatorio.")).toBeInTheDocument();
    expect(screen.queryByText("Name is required.")).not.toBeInTheDocument();
  });
});
