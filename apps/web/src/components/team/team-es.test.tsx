import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, Invitation, Member } from "@/lib/api";
import { useUiStore } from "@/stores/ui-store";
import { mockApi, renderWithApp, resetApiMocks } from "@/test/mock-api";
import { removalMessage } from "./removal-message";
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

const ENTRY: AuditEntry = {
  id: "a1",
  action: "member_removed",
  actorUserId: "u1",
  targetUserId: "u2",
  invitationId: null,
  role: "write",
  blocklistEntryId: null,
  occurredAt: "2026-11-16T10:00:00Z",
};

describe("Team in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(resetApiMocks);

  it("shows the screen, the roles and the audit log in Spanish", async () => {
    mockApi({
      "GET /v1/venues/v1/members": { body: { members: MEMBERS } },
      "GET /v1/venues/v1/invitations": { body: { invitations: [INVITATION] } },
      "GET /v1/venues/v1/audit": { body: { entries: [ENTRY], nextCursor: null } },
      "DELETE /v1/venues/v1/members/u2": {
        body: { member: { userId: "u2", role: "write" }, revoked: { keys: 2, sessions: 1, webhooksFlagged: 1 } },
      },
    });
    const user = userEvent.setup();
    renderWithApp(<TeamView venueId="v1" />);

    expect(await screen.findByRole("heading", { name: "Equipo" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Rol de bo@example.com" })).toHaveDisplayValue("escritura");
    expect(await screen.findByText("Registro de auditoría")).toBeInTheDocument();
    expect(await screen.findByText("Miembro quitado")).toBeInTheDocument();
    expect(screen.getByText("pendiente")).toBeInTheDocument();
    expect(screen.queryByText("Audit log")).not.toBeInTheDocument();
    expect(screen.queryByText("Members")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Quitar a bo@example.com" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Quitar" }));
    expect(
      await screen.findByText(
        "Miembro quitado. 2 claves de API revocadas, 1 sesión cerrada, 1 webhook marcado para revisión.",
      ),
    ).toBeInTheDocument();
  });

  it("builds the removal message as a whole sentence", () => {
    expect(removalMessage({ keys: 0, sessions: 0, webhooksFlagged: 0 })).toBe(
      "Miembro quitado. No había nada más que revocar.",
    );
    expect(removalMessage(undefined)).toBe("Miembro quitado");
  });
});
