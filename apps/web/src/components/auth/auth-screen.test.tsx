import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/mock-api";

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: vi.fn() }, signUp: { email: vi.fn() } },
}));

import { AuthScreen } from "./auth-screen";

describe("AuthScreen", () => {
  it("says Welcome back on the sign-in tab and Create your account on the sign-up tab", async () => {
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByText("Sign in to manage your venue's reservations.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sign up" }));
    expect(screen.getByText("Create your account")).toBeInTheDocument();
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in to manage your venue's reservations.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });
});
