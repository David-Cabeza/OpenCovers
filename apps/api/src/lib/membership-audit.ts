import { and, desc, eq, lt } from "drizzle-orm";
import { membershipAudit } from "../db/schema";
import type { Db, Role } from "./memberships";

export type MembershipAuditEntry =
  | { action: "invited"; actorUserId: string; invitationId: string; role: Role }
  | { action: "invite_revoked"; actorUserId: string; invitationId: string; role: Role }
  | { action: "redeemed"; targetUserId: string; invitationId: string; role: Role }
  | { action: "member_removed"; actorUserId: string; targetUserId: string; role: Role }
  | { action: "role_changed"; actorUserId: string; targetUserId: string; role: Role }
  | { action: "creator_transferred"; actorUserId: string; targetUserId: string }
  | { action: "guest_blocked"; actorUserId: string; blocklistEntryId: string }
  | { action: "guest_unblocked"; actorUserId: string; blocklistEntryId: string };

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
    role: "role" in entry ? entry.role : null,
    blocklistEntryId: "blocklistEntryId" in entry ? entry.blocklistEntryId : null,
  });
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

export type MembershipAuditAction = MembershipAuditEntry["action"];

export interface MembershipAuditView {
  id: string;
  action: MembershipAuditAction;
  actorUserId: string | null;
  targetUserId: string | null;
  invitationId: string | null;
  role: string | null;
  blocklistEntryId: string | null;
  occurredAt: string;
}

export function encodeAuditCursor(venueId: string, id: number): string {
  return `${venueId}:${id}`;
}

export function decodeAuditCursor(venueId: string, raw: string): number | null {
  const at = raw.lastIndexOf(":");
  if (at <= 0 || raw.slice(0, at) !== venueId) return null;
  const digits = raw.slice(at + 1);
  if (!/^\d{1,15}$/.test(digits)) return null;
  const id = Number(digits);
  return id >= 1 ? id : null;
}

/** Newest first. `next` is the id to pass back as the cursor, or null on the last page. */
export async function listMembershipAudit(
  db: Pick<Db, "select">,
  venueId: string,
  opts: { after?: number; limit: number },
): Promise<{ entries: MembershipAuditView[]; next: number | null }> {
  const rows = await db
    .select()
    .from(membershipAudit)
    .where(
      and(
        eq(membershipAudit.venueId, venueId),
        opts.after === undefined ? undefined : lt(membershipAudit.id, opts.after),
      ),
    )
    .orderBy(desc(membershipAudit.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  return {
    entries: page.map((r) => ({
      id: String(r.id),
      action: r.action,
      actorUserId: r.actorUserId,
      targetUserId: r.targetUserId,
      invitationId: r.invitationId,
      role: r.role,
      blocklistEntryId: r.blocklistEntryId,
      occurredAt: r.occurredAt.toISOString(),
    })),
    next: rows.length > opts.limit ? page[page.length - 1].id : null,
  };
}
