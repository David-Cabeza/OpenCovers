import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";
import { ServiceFormDialog } from "./service-form-dialog";
import { TableFormDialog } from "./table-form-dialog";

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("setup dialogs in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(() => useUiStore.setState({ locale: "en" }));

  it("shows the table dialog with Spanish shapes and required messages", async () => {
    const user = userEvent.setup();
    renderWith(<TableFormDialog venueId="v1" open onOpenChange={() => {}} initial={null} />);
    expect(screen.getByRole("heading", { name: "Añadir mesa" })).toBeInTheDocument();
    for (const shape of ["Redonda", "Ovalada", "Cuadrada", "Rectangular", "Alargada"]) {
      expect(screen.getByRole("option", { name: shape })).toBeInTheDocument();
    }
    expect(screen.queryByRole("option", { name: "Round" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Añadir mesa" }));
    expect(await screen.findByText("El ID es obligatorio.")).toBeInTheDocument();
    expect(screen.queryByText("ID is required.")).not.toBeInTheDocument();
  });

  it("shows the service dialog with Spanish weekday names", () => {
    renderWith(<ServiceFormDialog venueId="v1" open onOpenChange={() => {}} initial={null} />);
    expect(screen.getByRole("heading", { name: "Añadir servicio" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Lunes" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Monday" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });
});
