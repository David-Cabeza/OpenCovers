import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { takeInviteToken } from "@/lib/invite-link";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { useUiStore } from "@/stores/ui-store";

const auth = vi.hoisted(() => ({
  session: null as unknown,
  signUpEmail: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: auth.session, isPending: false }),
    signUp: { email: auth.signUpEmail },
    signIn: { email: auth.signInEmail },
  },
}));

vi.mock("@/components/dashboard", () => ({ Dashboard: () => <div>dashboard</div> }));

const TOKEN = "11111111-1111-4111-8111-111111111111.c2VjcmV0";

describe("takeInviteToken", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads the token and strips the fragment from the URL", () => {
    window.history.replaceState(null, "", `/staff?x=1#/invite?token=${TOKEN}`);
    expect(takeInviteToken()).toBe(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/staff?x=1");
    expect(takeInviteToken()).toBeNull();
  });

  it("ignores other fragments and leaves them alone", () => {
    window.history.replaceState(null, "", "/#/other?token=abc");
    expect(takeInviteToken()).toBeNull();
    expect(window.location.hash).toBe("#/other?token=abc");
  });
});

describe("invitation redeem flow", () => {
  beforeEach(() => {
    auth.session = null;
    auth.signUpEmail.mockReset();
    useUiStore.setState({ venueId: null });
  });
  afterEach(resetApiMocks);

  it("signs up with the token in the X-Invitation-Token header", async () => {
    auth.signUpEmail.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<App inviteToken={TOKEN} />);

    await user.type(screen.getByLabelText("Name"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(auth.signUpEmail).toHaveBeenCalledWith({
        name: "Ana",
        email: "ana@example.com",
        password: "hunter2hunter2",
        fetchOptions: { headers: { "X-Invitation-Token": TOKEN } },
      }),
    );
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("shows the invalid invitation message when sign-up is refused", async () => {
    auth.signUpEmail.mockResolvedValue({
      error: { status: 403, code: "INVALID_INVITATION", message: "Invalid invitation" },
    });
    const user = userEvent.setup();
    renderWithApp(<App inviteToken={TOKEN} />);

    await user.type(screen.getByLabelText("Name"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      (await screen.findAllByText("This invitation link is not valid. Ask for a new one.")).length,
    ).toBeGreaterThan(0);
  });

  it("shows the instance message when a closed instance refuses a plain sign-up", async () => {
    auth.signUpEmail.mockResolvedValue({
      error: { status: 403, code: "SIGNUP_CLOSED", message: "Sign-up is closed on this instance." },
    });
    const user = userEvent.setup();
    renderWithApp(<App inviteToken={TOKEN} />);

    await user.type(screen.getByLabelText("Name"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      (await screen.findAllByText("Sign-up is closed on this instance.")).length,
    ).toBeGreaterThan(0);
  });

  it("lets a signed-in user join, selects the venue and opens the dashboard", async () => {
    auth.session = { user: { email: "ana@example.com" } };
    const api = mockApi({
      "POST /v1/invitations/redeem": { body: { membership: { venueId: "v9", role: "write" } } },
      "GET /v1/venues": { body: { venues: [] } },
    });
    const user = userEvent.setup();
    renderWithApp(<App inviteToken={TOKEN} />);

    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(api.calls("POST", "/v1/invitations/redeem")[0].body).toEqual({ token: TOKEN });
    expect(useUiStore.getState().venueId).toBe("v9");
  });

  it("shows the invalid invitation error and stays on the page", async () => {
    auth.session = { user: { email: "ana@example.com" } };
    mockApi({
      "POST /v1/invitations/redeem": { status: 400, body: { code: "invalid_invitation" } },
    });
    const user = userEvent.setup();
    renderWithApp(<App inviteToken={TOKEN} />);

    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(
      await screen.findByText("This invitation link is not valid. Ask for a new one."),
    ).toBeInTheDocument();
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
  });
});
