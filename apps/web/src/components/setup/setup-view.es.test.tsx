import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { useUiStore } from "@/stores/ui-store";
import { SetupView } from "./setup-view";

const TABLES = {
  tables: [
    { id: "t1", name: "Mesa 1", seats: 4, zone: "Terraza", shape: "round", posX: 0, posY: 0, rotation: 0 },
    { id: "t2", name: "Mesa 2", seats: 1, zone: "", shape: "square", posX: 0, posY: 0, rotation: 0 },
  ],
};
const SERVICES = {
  services: [{ name: "dinner", openStart: "20:00", openEnd: "23:00", days: [1, 2, 3, 4, 5, 6, 7] }],
};

describe("SetupView in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(() => {
    useUiStore.setState({ locale: "en" });
    resetApiMocks();
  });

  it("shows the sections, the cards and the rows in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/tables": { body: TABLES },
      "GET /v1/venues/v1/services": { body: SERVICES },
    });
    renderWithApp(<SetupView venueId="v1" role="admin" />);
    const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
    for (const label of ["General", "En línea", "Sala", "Desarrolladores"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("button", { name: "Dining room" })).not.toBeInTheDocument();
    expect(screen.getByText("Ajustes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir mesa" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Editar Mesa 1" })).toBeInTheDocument();
    expect(screen.getByText("4 plazas")).toBeInTheDocument();
    expect(screen.getByText("1 plaza")).toBeInTheDocument();
    expect(screen.getByText("Sin zona")).toBeInTheDocument();
    expect(screen.getByText("Todos los días")).toBeInTheDocument();
    expect(screen.queryByText("Add table")).not.toBeInTheDocument();
    expect(screen.queryByText("4 seats")).not.toBeInTheDocument();
    expect(screen.queryByText("Every day")).not.toBeInTheDocument();
  });
});
