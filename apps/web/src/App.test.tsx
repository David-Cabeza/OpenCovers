import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: { data: null, isPending: false, error: null, refetch: vi.fn() } as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => session.current, signIn: { email: vi.fn() }, signUp: { email: vi.fn() } },
}));
vi.mock("@/components/dashboard", () => ({ Dashboard: () => <p>dashboard</p> }));
vi.mock("@/components/auth/invite-screen", () => ({
  InviteGate: ({ onDone }: { onDone: () => void }) => <button onClick={onDone}>close invitation</button>,
}));

import App from "./App";
import { useUiStore } from "@/stores/ui-store";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
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

describe("an address the app does not have", () => {
  const signedIn = { data: { user: { email: "a@b.co" } }, isPending: false, error: null, refetch: vi.fn() };

  it.each(["/nada", "/agenda", "/demo", "/nada?view=floor"])("says %s was not found, with one way back to the agenda", (path) => {
    session.current = signedIn;
    window.history.replaceState(null, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the agenda" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
    expect(document.title).toBe("Page not found · OpenCovers");
  });

  it("says it in Spanish too, also to someone signed out", () => {
    useUiStore.setState({ locale: "es" });
    window.history.replaceState(null, "", "/nada");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a la agenda" })).toBeInTheDocument();
  });

  it.each(["/", "/index.html", "/?view=floor&date=2026-12-06", "/?error=INVALID_TOKEN", "/oauth/consent", "/oauth/consent/?client_id=x"])(
    "keeps loading the app at %s",
    (path) => {
      session.current = signedIn;
      window.history.replaceState(null, "", path);
      render(<App />);
      expect(screen.getByText("dashboard")).toBeInTheDocument();
    },
  );

  it("still opens an invitation that arrived on another path, and does not lose the app afterwards", async () => {
    window.history.replaceState(null, "", "/nada");
    const user = userEvent.setup();
    session.current = signedIn;
    render(<App inviteToken="t" />);
    await user.click(screen.getByRole("button", { name: "close invitation" }));
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("opens an invitation pasted while the page was not found", () => {
    session.current = signedIn;
    window.history.replaceState(null, "", "/nada");
    render(<App />);
    act(() => {
      window.history.replaceState(null, "", "/nada#/invite?token=t");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("button", { name: "close invitation" })).toBeInTheDocument();
  });
});
