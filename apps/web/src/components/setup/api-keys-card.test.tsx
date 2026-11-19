import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { ApiKeysCard } from "./api-keys-card";

const KEYS = [
  { principal: "demo-agent", role: "write", hash: "h1" },
  { principal: "reporting", role: "read", hash: "h2" },
];

describe("ApiKeysCard", () => {
  afterEach(resetApiMocks);

  it("lists each key with its principal and role", async () => {
    mockApi({ "GET /v1/venues/v1/keys": { body: { keys: KEYS } } });
    renderWithApp(<ApiKeysCard venueId="v1" />);
    const row = (await screen.findByText("demo-agent")).closest("li") as HTMLElement;
    expect(within(row).getByText("write")).toBeInTheDocument();
    const other = screen.getByText("reporting").closest("li") as HTMLElement;
    expect(within(other).getByText("read")).toBeInTheDocument();
  });

  it("revokes the key of the row that was clicked", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      "GET /v1/venues/v1/keys": { body: { keys: KEYS } },
      "DELETE /v1/venues/v1/keys": { body: { keys: [KEYS[1]] } },
    });
    renderWithApp(<ApiKeysCard venueId="v1" />);
    await user.click(await screen.findByRole("button", { name: "Revoke key for reporting" }));
    expect(api.calls("DELETE", "/v1/venues/v1/keys")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(api.calls("DELETE", "/v1/venues/v1/keys")).toHaveLength(1));
    expect(api.calls("DELETE", "/v1/venues/v1/keys")[0].body).toEqual({ hash: "h2" });
  });

  it("keeps the key when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const api = mockApi({ "GET /v1/venues/v1/keys": { body: { keys: KEYS } } });
    renderWithApp(<ApiKeysCard venueId="v1" />);
    await user.click(await screen.findByRole("button", { name: "Revoke key for reporting" }));
    expect(await screen.findByRole("heading", { name: "Revoke the key for reporting?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep key" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls("DELETE", "/v1/venues/v1/keys")).toHaveLength(0);
  });

  it("says when there are no keys", async () => {
    mockApi({ "GET /v1/venues/v1/keys": { body: { keys: [] } } });
    renderWithApp(<ApiKeysCard venueId="v1" />);
    expect(await screen.findByText("No keys yet.")).toBeInTheDocument();
  });
});
