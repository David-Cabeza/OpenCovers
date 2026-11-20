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
import { useUiStore } from "@/stores/ui-store";
import { AuthScreen } from "./auth-screen";

const challenge = { nonce: "n0nce", issuedAt: 1, difficulty: 6, signature: "sig" };
let requests: ReturnType<typeof mockApi>["requests"];

function demoOn(googleEnabled = false, challengeAnswer: { status?: number; body?: unknown } = { body: { challenge, expiresAt: "2026-11-20T10:05:00Z" } }) {
  requests = mockApi({
    "GET /api/demo/status": { body: { enabled: true, googleEnabled } },
    "POST /api/demo/magic-link-challenge": challengeAnswer,
  }).requests;
}

beforeEach(() => {
  magicLink.mockReset();
  social.mockReset();
  window.localStorage.clear();
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

  it("solves a challenge for the typed address and sends it with the magic-link request", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    // The challenge request and its proof of work are asynchronous, so the link request follows the click later.
    await waitFor(() => expect(magicLink).toHaveBeenCalled());
    const [body, options] = magicLink.mock.calls[0]!;
    expect(body.email).toBe("ana@example.com");
    const asked = requests.filter((r) => r.path === "/api/demo/magic-link-challenge");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.body).toEqual({ email: "ana@example.com" });
    expect(JSON.parse(options.headers["X-Demo-Challenge"])).toEqual(challenge);
    // The solution is a counter whose SHA-256 of "n0nce:<counter>" has 6 leading zero bits.
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`n0nce:${options.headers["X-Demo-Solution"]}`)));
    expect(digest[0]! >> 2).toBe(0);
    expect(options.headers["Accept-Language"]).toBe("en");
    expect(options.headers).not.toHaveProperty("X-Demo-Consent");
    expect(window.localStorage.getItem("oc-demo-consent")).toBeNull();
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/ana@example\.com/)).toBeInTheDocument();
  });

  it("remembers the tick for after sign-in, and sends no consent with the request", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(magicLink.mock.calls[0]![1].headers).not.toHaveProperty("X-Demo-Consent");
    expect(JSON.parse(window.localStorage.getItem("oc-demo-consent")!)).toEqual({ version: "v1" });
  });

  it("remembers the tick before Google sign-in too", async () => {
    demoOn(true);
    social.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(social.mock.calls[0]![0]).toMatchObject({ provider: "google" });
    expect(JSON.parse(window.localStorage.getItem("oc-demo-consent")!)).toEqual({ version: "v1" });
  });

  it("shows Preparing your link while the challenge is on its way", async () => {
    demoOn();
    let release: (v: unknown) => void = () => {};
    magicLink.mockReturnValue(new Promise((r) => (release = r)));
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("button", { name: "Preparing your link…" })).toBeDisabled();
    release({ error: null });
    await screen.findByRole("heading", { name: "Check your email" });
  });

  it("explains a challenge the server refuses", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: { status: 400, code: "CHALLENGE_INVALID", message: "raw" } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expired or was already used");
  });

  it.each([
    ["en", "Some of the details are not valid"],
    ["es", "Algunos datos no son válidos"],
  ] as const)("shows the catalog message, not the raw code, when the challenge refuses the address (%s)", async (locale, text) => {
    useUiStore.setState({ locale });
    demoOn(false, { status: 400, body: { code: "invalid_request" } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "nope@example.com");
    await user.click(await screen.findByRole("button", { name: /^(Email me a sign-in link|Envíame un enlace de acceso)$/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent("invalid_request");
    useUiStore.setState({ locale: "en" });
  });

  it("waits when the challenge request is rate limited, and sends no link", async () => {
    demoOn(false, { status: 429, body: { code: "rate_limited" } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(screen.getByRole("button", { name: /Try again in \d+s/ })).toBeDisabled();
    expect(magicLink).not.toHaveBeenCalled();
  });

  it("speaks Spanish and asks for the mail in Spanish when the app is in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    demoOn();
    magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.click(await screen.findByRole("button", { name: "Envíame un enlace de acceso" }));
    expect(await screen.findByRole("heading", { name: "Revisa tu email" })).toBeInTheDocument();
    expect(magicLink.mock.calls[0]![1].headers["Accept-Language"]).toBe("es");
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

  it("shows a guest-readable message when the validator rejects the address", async () => {
    demoOn();
    magicLink.mockResolvedValue({ error: { status: 400, code: "VALIDATION_ERROR", message: "[body.email] Invalid email address" } });
    const user = userEvent.setup();
    renderWithApp(<AuthScreen />);
    const input = await screen.findByLabelText("Email");
    await user.type(input, "a@b.c");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not look right");
    expect(input).toHaveAttribute("aria-invalid", "true");
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
      // A challenge is single use, so the resend asked for its own.
      expect(requests.filter((r) => r.path === "/api/demo/magic-link-challenge")).toHaveLength(2);
      expect(magicLink.mock.calls[1]![1].headers["X-Demo-Challenge"]).toBeDefined();
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
