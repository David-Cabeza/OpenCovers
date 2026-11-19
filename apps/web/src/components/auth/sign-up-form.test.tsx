import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "./sign-up-form";

// A plain function, not a vi.fn: the client's own promise is the only thing that should see a rejection.
const client = vi.hoisted(() => ({ answer: (): Promise<unknown> => Promise.resolve({ error: null }) }));

vi.mock("@/lib/auth-client", () => ({ authClient: { signUp: { email: () => client.answer() } } }));

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Ana");
  await user.type(screen.getByLabelText("Email"), "ana@example.com");
  await user.type(screen.getByLabelText("Password"), "una-clave-larga-123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("SignUpForm and a server that does not answer", () => {
  beforeEach(() => {
    client.answer = () => Promise.resolve({ error: null });
  });

  it("says the server cannot be reached when the client throws for a network failure", async () => {
    client.answer = () => Promise.reject(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<SignUpForm onSuccess={onSuccess} />);
    await fill(user);
    expect(await screen.findByText("Can't reach the server. Check your connection and try again in a moment.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("says the server is not responding for a server error", async () => {
    client.answer = () => Promise.resolve({ error: { status: 503, statusText: "" } });
    const user = userEvent.setup();
    render(<SignUpForm />);
    await fill(user);
    expect(await screen.findByText("The server is not responding right now. Try again in a moment.")).toBeInTheDocument();
  });

  it("still calls onSuccess when the account was created", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<SignUpForm onSuccess={onSuccess} />);
    await fill(user);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
