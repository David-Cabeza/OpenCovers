import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";
import type { Invitation, Member } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { TeamView } from "./team-view";

const MEMBERS: Member[] = [
  { userId: "u1", name: "Ana", email: "ana@example.com", role: "admin" },
  { userId: "u2", name: "Bo", email: "bo@example.com", role: "write" },
];

const INVITATION: Invitation = {
  id: "i1",
  role: "read",
  email: "new@example.com",
  status: "pending",
  createdAt: "2026-11-16T10:00:00Z",
  expiresAt: "2026-11-19T10:00:00Z",
  redeemedAt: null,
  revokedAt: null,
};

const LIST_MEMBERS = "GET /v1/venues/v1/members";
const LIST_INV = "GET /v1/venues/v1/invitations";
const CREATE_INV = "POST /v1/venues/v1/invitations";

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    [LIST_MEMBERS]: { body: { members: MEMBERS } },
    [LIST_INV]: { body: { invitations: [INVITATION] } },
    ...extra,
  });
  renderWithApp(<TeamView venueId="v1" />);
  return { api, user: userEvent.setup() };
}

describe("TeamView", () => {
  afterEach(resetApiMocks);

  it("lists members with their role", async () => {
    setup();
    expect(await screen.findByLabelText("Role of bo@example.com")).toHaveValue("write");
    expect(screen.getByLabelText("Role of ana@example.com")).toHaveValue("admin");
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  });

  it("removes a member only after the confirm dialog", async () => {
    const { api, user } = setup({
      "DELETE /v1/venues/v1/members/u2": { body: { member: { userId: "u2", role: "write" } } },
    });
    await user.click(await screen.findByRole("button", { name: "Remove bo@example.com" }));
    expect(api.calls("DELETE", "/v1/venues/v1/members/u2")).toHaveLength(0);

    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() =>
      expect(api.calls("DELETE", "/v1/venues/v1/members/u2")).toHaveLength(1),
    );
  });

  it("surfaces the last_admin error", async () => {
    const { user } = setup({
      "DELETE /v1/venues/v1/members/u1": { status: 409, body: { code: "last_admin" } },
    });
    await user.click(await screen.findByRole("button", { name: "Remove ana@example.com" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    expect(await screen.findByText(
      "A venue needs at least one admin. Make someone else an admin first.",
    )).toBeInTheDocument();
  });

  it("changes a member's role from the selector", async () => {
    const { api, user } = setup({
      "PATCH /v1/venues/v1/members/u2": { body: { member: { userId: "u2", role: "admin" } } },
    });
    await user.selectOptions(await screen.findByLabelText("Role of bo@example.com"), "admin");
    await waitFor(() =>
      expect(api.calls("PATCH", "/v1/venues/v1/members/u2")).toHaveLength(1),
    );
    expect(api.calls("PATCH", "/v1/venues/v1/members/u2")[0].body).toEqual({ role: "admin" });
    expect(await screen.findByText("Role updated")).toBeInTheDocument();
  });

  it("surfaces last_admin when demoting the only admin", async () => {
    const { user } = setup({
      "PATCH /v1/venues/v1/members/u1": { status: 409, body: { code: "last_admin" } },
    });
    await user.selectOptions(await screen.findByLabelText("Role of ana@example.com"), "read");
    expect(await screen.findByText(
      "A venue needs at least one admin. Make someone else an admin first.",
    )).toBeInTheDocument();
  });

  it("offers Make creator only to the instance creator, for other members", async () => {
    const { api, user } = setup({
      "GET /v1/account": { body: { account: { userId: "u1", isCreator: true } } },
      "POST /v1/account/transfer-creator": { body: { creator: { userId: "u2" } } },
    });
    expect(
      await screen.findByRole("button", { name: "Make bo@example.com the venue creator" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make ana@example.com the venue creator" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make bo@example.com the venue creator" }));
    expect(api.calls("POST", "/v1/account/transfer-creator")).toHaveLength(0);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Make creator" }),
    );
    await waitFor(() =>
      expect(api.calls("POST", "/v1/account/transfer-creator")).toHaveLength(1),
    );
    expect(api.calls("POST", "/v1/account/transfer-creator")[0].body).toEqual({ userId: "u2" });
  });

  it("hides Make creator from everyone else", async () => {
    setup({ "GET /v1/account": { body: { account: { userId: "u1", isCreator: false } } } });
    await screen.findByText("bo@example.com");
    expect(screen.queryByRole("button", { name: /venue creator/ })).not.toBeInTheDocument();
  });

  it("creates an invitation and shows the token once", async () => {
    const { api, user } = setup({
      [CREATE_INV]: {
        status: 201,
        body: { invitation: { ...INVITATION, id: "i2", email: null, token: "i2.secret" } },
      },
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(await screen.findByRole("button", { name: /Invite/ }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "write");
    await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));

    expect(await within(dialog).findByText("i2.secret")).toBeInTheDocument();
    expect(api.calls("POST", "/v1/venues/v1/invitations")[0].body).toEqual({ role: "write" });
    await user.click(within(dialog).getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith("i2.secret");

    const link = `${window.location.origin}/#/invite?token=i2.secret`;
    expect(within(dialog).getByTestId("invite-link")).toHaveTextContent(link);
    await user.click(within(dialog).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(link);

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("i2.secret")).not.toBeInTheDocument());
  });

  it("revokes a pending invitation", async () => {
    const { api, user } = setup({
      "DELETE /v1/venues/v1/invitations/i1": {
        body: { invitation: { ...INVITATION, status: "revoked" } },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.calls("DELETE", "/v1/venues/v1/invitations/i1")).toHaveLength(1),
    );
  });
});

describe("Sidebar", () => {
  it("shows the Team entry to admins only", () => {
    const admin = renderWithApp(<Sidebar active="agenda" onSelect={() => {}} role="admin" />);
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
    admin.unmount();
    for (const role of ["write", "read", undefined] as const) {
      const other = renderWithApp(<Sidebar active="agenda" onSelect={() => {}} role={role} />);
      expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
      other.unmount();
    }
  });
});
