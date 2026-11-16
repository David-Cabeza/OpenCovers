import { membershipAudit } from "../db/schema";
import type { Db, Role } from "./memberships";

export type MembershipAuditEntry =
  | { action: "invited"; actorUserId: string; invitationId: string; role: Role }
  | { action: "invite_revoked"; actorUserId: string; invitationId: string; role: Role }
  | { action: "redeemed"; targetUserId: string; invitationId: string; role: Role }
  | { action: "member_removed"; actorUserId: string; targetUserId: string; role: Role };

export async function recordMembershipAudit(
  tx: Pick<Db, "insert">,
  venueId: string,
  entry: MembershipAuditEntry,
): Promise<void> {
  await tx.insert(membershipAudit).values({
    venueId,
    action: entry.action,
    actorUserId: "actorUserId" in entry ? entry.actorUserId : null,
    targetUserId: "targetUserId" in entry ? entry.targetUserId : null,
    invitationId: "invitationId" in entry ? entry.invitationId : null,
    role: entry.role,
  });
}
