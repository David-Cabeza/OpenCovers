import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: vi.fn() }, signUp: { email: vi.fn() }, useSession: () => ({ data: null }) },
}));

import { renderWithApp } from "@/test/mock-api";
import { AuthScreen } from "./auth-screen";
import { InviteSignedOut } from "./invite-screen";

describe("the screens before sign-in", () => {
  it("put the sign-in form in the main landmark, under the one level-one heading", () => {
    renderWithApp(<AuthScreen />);
    expect(screen.getByRole("main")).toContainElement(screen.getByLabelText("Email"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("do the same for the invitation screen", () => {
    renderWithApp(<InviteSignedOut token="abc.def" onDone={() => {}} />);
    expect(screen.getByRole("main")).toContainElement(screen.getByLabelText("Email"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
