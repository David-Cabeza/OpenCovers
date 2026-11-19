import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: { data: null, isPending: false, error: null, refetch: vi.fn() } as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => session.current, signIn: { email: vi.fn() }, signUp: { email: vi.fn() } },
}));
vi.mock("@/components/dashboard", () => ({ Dashboard: () => <p>dashboard</p> }));

import App from "./App";

beforeEach(() => {
  session.current = { data: null, isPending: false, error: null, refetch: vi.fn() };
});

describe("App", () => {
  it("shows the sign-in screen when nobody is signed in and the server answered", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "OpenCovers" })).toBeInTheDocument();
    expect(screen.queryByText("We can't reach the server")).not.toBeInTheDocument();
  });

  it("says the server cannot be reached, instead of showing sign-in, when the session could not be read", () => {
    session.current = { data: null, isPending: false, error: {}, refetch: vi.fn() };
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("We can't reach the server");
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("alert"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("asks for the session again from Try again", async () => {
    const refetch = vi.fn();
    session.current = { data: null, isPending: false, error: { status: 502 }, refetch };
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the dashboard when there is a session, even if a later refresh failed", () => {
    session.current = { data: { user: { email: "a@b.co" } }, isPending: false, error: {}, refetch: vi.fn() };
    render(<App />);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });
});
