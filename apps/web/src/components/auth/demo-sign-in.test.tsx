import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const magicLink = vi.hoisted(() => vi.fn());
const social = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn(), magicLink, social },
    signUp: { email: vi.fn() },
    useSession: () => ({ data: null }),
  },
}));

import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { AuthScreen } from "./auth-screen";

function demoOn(googleEnabled = false) {
  mockApi({ "GET /api/demo/status": { body: { enabled: true, googleEnabled } } });
}

beforeEach(() => {
  magicLink.mockReset();
  social.mockReset();
});
afterEach(resetApiMocks);

describe("the sign-in screen on a demo", () => {
  it("offers a magic link, hides the password forms, and leaves the consent box unticked", async () => {
    demoOn();
    renderWithApp(<AuthScreen />);
    expect(await screen.findByRole("button", { name: "Email me a sign-in link" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sign up" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href");
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("shows Google only when the server has it", async () => {
    demoOn(true);
    renderWithApp(<AuthScreen />);
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("sends the language, and no consent header, when the box is not ticked", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    const [body, options] = magicLink.mock.calls[0]!;
    expect(body.email).toBe("ana@example.com");
    expect(options.headers["X-Demo-Locale"]).toMatch(/^(en|es)$/);
    expect(options.headers).not.toHaveProperty("X-Demo-Consent");
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  });

  it("sends the consent text version only when the box is ticked", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(magicLink.mock.calls[0]![1].headers["X-Demo-Consent"]).toBe("demo-consent-v0-placeholder");
  });

  it("passes the same headers to Google sign-in", async () => {
    demoOn(true);
    social.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social.mock.calls[0]![0]).toMatchObject({ provider: "google" });
    expect(social.mock.calls[0]![1].headers["X-Demo-Consent"]).toBe("demo-consent-v0-placeholder");
  });

  it("says why an address is refused", async () => {
    demoOn();
    magicLink.mockResolvedValue({
      error: { status: 400, code: "DISPOSABLE_EMAIL", message: "Disposable email addresses are not accepted. Use your own address." },
    });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "x@mailinator.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disposable email addresses are not accepted");
    expect(screen.queryByRole("heading", { name: "Check your email" })).not.toBeInTheDocument();
  });

  it("says the server cannot be reached when no answer comes back", async () => {
    demoOn();
    magicLink.mockImplementation(() => ({ then: (_: unknown, reject: (e: unknown) => void) => reject(new TypeError("Failed to fetch")) }));
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
  });

  it("holds the resend button for the rate-limit window, then lets the visitor send again", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    renderWithApp(<AuthScreen />);
    const email = await screen.findByLabelText("Email");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(email, "ana@example.com");
      await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
      const resend = await screen.findByRole("button", { name: /Send again in \d+s/ });
      expect(resend).toBeDisabled();
      // The countdown re-arms itself after each render, so tick it one second at a time.
      for (let i = 0; i < 61; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      const ready = screen.getByRole("button", { name: "Send the link again" });
      expect(ready).toBeEnabled();
      await user.click(ready);
      await waitFor(() => expect(magicLink).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the rate-limit message and waits when the server says too many requests", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: { status: 429, message: "Too many requests. Try again later." } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(screen.getByRole("button", { name: /Try again in \d+s/ })).toBeDisabled();
  });
});

describe("the sign-in screen when the demo is off", () => {
  it("is the normal one, with password sign-in and sign-up", async () => {
    mockApi({ "GET /api/demo/status": { body: { enabled: false, googleEnabled: false } } });
    renderWithApp(<AuthScreen />);
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("is the normal one when the status route does not answer", async () => {
    mockApi({});
    renderWithApp(<AuthScreen />);
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });
});
