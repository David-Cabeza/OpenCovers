import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./sign-in-form";

const signInEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmail } },
}));

describe("SignInForm", () => {
  beforeEach(() => {
    signInEmail.mockReset();
  });

  it("submits the email and password the user typed", async () => {
    signInEmail.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({
        email: "host@example.com",
        password: "hunter2hunter2",
      }),
    );
  });

  it("asks for both fields and does not call the server when they are empty", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("shows the server error when sign-in is refused", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password" } });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("says the server cannot be reached when the client throws for a network failure", async () => {
    // A thenable, not a rejected promise: vitest's own tracking of a mock's promises would report the rejection.
    signInEmail.mockImplementation(() => ({ then: (_: unknown, reject: (e: unknown) => void) => reject(new TypeError("Failed to fetch")) }));
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Can't reach the server. Check your connection and try again in a moment.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("says the server is not responding when it answers with a server error", async () => {
    signInEmail.mockResolvedValue({ error: { status: 502, statusText: "" } });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("The server is not responding right now. Try again in a moment.")).toBeInTheDocument();
  });

  it("shows a refused sign-in once, as an alert next to the form, and not also as a toast", async () => {
    const toastError = vi.spyOn(toast, "error");
    signInEmail.mockResolvedValue({ error: { status: 401, message: "Invalid email or password" } });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getAllByText("Invalid email or password")).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

  it("does not raise a toast for a server that does not answer either", async () => {
    const toastError = vi.spyOn(toast, "error");
    signInEmail.mockResolvedValue({ error: { status: 503, statusText: "" } });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "host@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The server is not responding");
    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

  it("leaves the empty password field looking empty", () => {
    render(<SignInForm />);
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("placeholder");
  });
});
