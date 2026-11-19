import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { renderWithApp } from "@/test/mock-api";

const signInEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmail }, signUp: { email: vi.fn() } },
}));

import { AuthScreen } from "./auth-screen";
import { ServerUnreachable } from "./server-unreachable";

describe("Sign-in in Spanish", () => {
  beforeEach(() => {
    signInEmail.mockReset();
    useUiStore.setState({ locale: "es" });
  });

  it("shows the sign-in card in Spanish", async () => {
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    expect(screen.getByText("Bienvenido de nuevo")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sign up" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Registrarse" }));
    expect(screen.getByText("Crea tu cuenta")).toBeInTheDocument();
  });

  it("asks for the fields and shows the server error in Spanish", async () => {
    signInEmail.mockResolvedValue({ error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.click(screen.getAllByRole("button", { name: "Iniciar sesión" })[0]);
    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "hunter2hunter2");
    await user.click(screen.getAllByRole("button", { name: "Iniciar sesión" })[0]);
    expect(await screen.findByText("Email o contraseña incorrectos")).toBeInTheDocument();
  });

  it("says the server cannot be reached in Spanish", () => {
    renderWithApp(<ServerUnreachable onRetry={() => {}} />);
    expect(screen.getByText("No podemos conectar con el servidor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });
});
