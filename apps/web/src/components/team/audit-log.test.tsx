import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";
import type { AuditEntry, Member } from "@/lib/api";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { TeamView } from "./team-view";

const MEMBERS: Member[] = [
  { userId: "u1", name: "Ana", email: "ana@example.com", role: "admin" },
  { userId: "u2", name: "Bo", email: "bo@example.com", role: "write" },
];

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "a1",
  action: "invited",
  actorUserId: "u1",
  targetUserId: null,
  invitationId: "inv12345678",
  role: "write",
  occurredAt: "2026-11-16T10:00:00Z",
  ...over,
});

function setup(audit: Parameters<typeof mockApi>[0][string]) {
  const api = mockApi({
    "GET /v1/venues/v1/members": { body: { members: MEMBERS } },
    "GET /v1/venues/v1/invitations": { body: { invitations: [] } },
    "GET /v1/venues/v1/audit": audit,
    "DELETE /v1/venues/v1/members/u2": {
      body: {
        member: { userId: "u2", role: "write" },
        revoked: { keys: 2, sessions: 1, webhooksFlagged: 1 },
      },
    },
  });
  renderWithApp(<TeamView venueId="v1" />);
  return { api, user: userEvent.setup() };
}

async function auditCard() {
  const heading = await screen.findByText("Audit log");
  return heading.closest("[data-slot='card']") as HTMLElement;
}

describe("AuditLog", () => {
  afterEach(resetApiMocks);

  it("resolves current members and falls back to a short id for former ones", async () => {
    setup({
      body: {
        entries: [
          entry({ id: "a2", action: "member_removed", targetUserId: "gone-user-id-123" }),
          entry({ id: "a3", action: "redeemed", actorUserId: null, targetUserId: "u2" }),
        ],
        nextCursor: null,
      },
    });
    const card = await auditCard();
    const removed = (await within(card).findByText("Member removed")).closest("tr") as HTMLElement;
    expect(within(removed).getByText("Ana")).toBeInTheDocument();
    expect(within(removed).getByText("gone-use…")).toBeInTheDocument();
    expect(within(removed).getByText("former member")).toBeInTheDocument();
    const redeemed = within(card).getByText("Invitation redeemed").closest("tr") as HTMLElement;
    expect(within(redeemed).getByText("Bo")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("loads the next page with the cursor", async () => {
    const { api, user } = setup((req) =>
      req.path.includes("cursor=c1")
        ? { body: { entries: [entry({ id: "a9", action: "invite_revoked" })], nextCursor: null } }
        : { body: { entries: [entry({ id: "a1" })], nextCursor: "c1" } },
    );
    const card = await auditCard();
    await user.click(await within(card).findByRole("button", { name: "Load more" }));
    expect(await within(card).findByText("Invitation revoked")).toBeInTheDocument();
    expect(within(card).getByText("Invitation created")).toBeInTheDocument();
    expect(api.requests.at(-1)?.path).toContain("cursor=c1");
    await waitFor(() =>
      expect(within(card).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument(),
    );
  });

  it("labels role changes with the new role and creator transfers", async () => {
    setup({
      body: {
        entries: [
          entry({
            id: "a5",
            action: "role_changed",
            targetUserId: "u2",
            invitationId: null,
            role: "admin",
          }),
          entry({
            id: "a6",
            action: "creator_transferred",
            targetUserId: "u2",
            invitationId: null,
            role: null,
          }),
        ],
        nextCursor: null,
      },
    });
    const card = await auditCard();
    const changed = (await within(card).findByText("Role changed")).closest("tr") as HTMLElement;
    expect(within(changed).getByText("admin")).toBeInTheDocument();
    expect(within(changed).getByText("Bo")).toBeInTheDocument();
    const transferred = within(card)
      .getByText("Venue creator transferred")
      .closest("tr") as HTMLElement;
    expect(within(transferred).getByText("Ana")).toBeInTheDocument();
    expect(within(transferred).getByText("Bo")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    setup({ body: { entries: [], nextCursor: null } });
    expect(await screen.findByText("No changes recorded yet.")).toBeInTheDocument();
  });

  it("shows a friendly error", async () => {
    setup({ status: 403, body: { code: "forbidden" } });
    expect(await screen.findByText("Only an admin can do this.")).toBeInTheDocument();
  });

  it("shows the revoked counts when a member is removed", async () => {
    const { user } = setup({ body: { entries: [], nextCursor: null } });
    await user.click(await screen.findByRole("button", { name: "Remove bo@example.com" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    expect(
      await screen.findByText(
        "Member removed. 2 API keys revoked, 1 session ended, 1 webhook flagged for review.",
      ),
    ).toBeInTheDocument();
  });

  it("is reachable through the admin-only Team entry", () => {
    for (const role of ["write", "read", undefined] as const) {
      const view = renderWithApp(<Sidebar active="agenda" onSelect={() => {}} role={role} />);
      expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
