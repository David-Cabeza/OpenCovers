import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LoadError } from "@/components/load-error";
import { Sidebar, viewLabel } from "@/components/layout/sidebar";
import { useUiStore } from "@/stores/ui-store";
import { renderWithApp } from "@/test/mock-api";

describe("Layout in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es", sidebarCollapsed: false }));

  it("names the sidebar entries in Spanish", () => {
    renderWithApp(<Sidebar active="agenda" onSelect={() => {}} role="admin" />);
    for (const name of ["Previo al servicio", "Plano de sala", "Disponibilidad", "Lista de espera", "Ritmo", "Ajustes", "Equipo"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Contraer barra lateral" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waitlist" })).not.toBeInTheDocument();
    expect(viewLabel("waitlist")).toBe("Lista de espera");
  });

  it("writes the load error as a whole translated message", () => {
    renderWithApp(<LoadError title="No se pudo cargar la agenda" onRetry={() => {}} />);
    expect(screen.getByText("No se pudo cargar la agenda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });
});
