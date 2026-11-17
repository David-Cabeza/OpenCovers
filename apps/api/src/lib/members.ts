import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { apiKeys, grants, session, user, venueMemberships, webhookEndpoints } from "../db/schema";
import { recordMembershipAudit } from "./membership-audit";
import type { Db, Role } from "./memberships";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export async function listMembers(db: Db, venueId: string): Promise<MemberView[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: venueMemberships.role,
    })
    .from(venueMemberships)
    .innerJoin(user, eq(user.id, venueMemberships.userId))
    .where(eq(venueMemberships.venueId, venueId))
    .orderBy(asc(user.email), asc(user.id));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export type ChangeRoleResult =
  | { ok: true; member: { userId: string; role: Role }; changed: boolean }
  | { ok: false; code: "venue_not_found" | "member_not_found" | "last_admin" };

export async function changeMemberRole(
  db: Db,
  venueId: string,
  actorId: string,
  targetId: string,
  role: Role,
): Promise<ChangeRoleResult> {
  return db.transaction(async (tx) => {
    const admins = await tx
      .select({ userId: venueMemberships.userId })
      .from(venueMemberships)
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.role, "admin")))
      .orderBy(asc(venueMemberships.userId))
      .for("update");
    if (!admins.some((a) => a.userId === actorId)) {
      return { ok: false, code: "venue_not_found" };
    }
    const [target] = await tx
      .select({ role: venueMemberships.role })
      .from(venueMemberships)
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.userId, targetId)))
      .limit(1);
    if (!target) return { ok: false, code: "member_not_found" };
    if (target.role === role) return { ok: true, member: { userId: targetId, role }, changed: false };
    if (target.role === "admin" && admins.length === 1) {
      return { ok: false, code: "last_admin" };
    }
    await tx
      .update(venueMemberships)
      .set({ role })
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.userId, targetId)));
    await recordMembershipAudit(tx, venueId, {
      action: "role_changed",
      actorUserId: actorId,
      targetUserId: targetId,
      role,
    });
    return { ok: true, member: { userId: targetId, role }, changed: true };
  });
}

export type RemoveResult =
  | {
      ok: true;
      member: { userId: string; role: Role };
      revoked: { keys: number; sessions: number; webhooksFlagged: number };
    }
  | { ok: false; code: "venue_not_found" | "member_not_found" | "last_admin" };

export async function removeMember(
  db: Db,
  venueId: string,
  actorId: string,
  targetId: string,
): Promise<RemoveResult> {
  return db.transaction(async (tx) => {
    const admins = await tx
      .select({ userId: venueMemberships.userId })
      .from(venueMemberships)
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.role, "admin")))
      .orderBy(asc(venueMemberships.userId))
      .for("update");
    if (!admins.some((a) => a.userId === actorId)) {
      return { ok: false, code: "venue_not_found" };
    }
    const [target] = await tx
      .select({ role: venueMemberships.role })
      .from(venueMemberships)
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.userId, targetId)))
      .limit(1);
    if (!target) return { ok: false, code: "member_not_found" };
    if (target.role === "admin" && admins.length === 1) {
      return { ok: false, code: "last_admin" };
    }
    await tx
      .delete(venueMemberships)
      .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.userId, targetId)));
    await recordMembershipAudit(tx, venueId, {
      action: "member_removed",
      actorUserId: actorId,
      targetUserId: targetId,
      role: target.role as Role,
    });

    // Keys this person minted for this venue lose this venue's grant, the same
    // as an admin revoking them. A key with no grant left is deleted.
    const mine = await tx
      .select({ hash: apiKeys.hash })
      .from(apiKeys)
      .innerJoin(grants, eq(grants.keyHash, apiKeys.hash))
      .where(and(eq(apiKeys.createdBy, targetId), eq(grants.venueId, venueId)));
    for (const { hash } of mine) {
      await tx.delete(grants).where(and(eq(grants.keyHash, hash), eq(grants.venueId, venueId)));
      const left = await tx.select().from(grants).where(eq(grants.keyHash, hash)).limit(1);
      if (left.length === 0) await tx.delete(apiKeys).where(eq(apiKeys.hash, hash));
    }

    // Sessions belong to the account, not to a venue. Revoke them only when
    // this was the account's last membership, so other venues keep working.
    const [stillMember] = await tx
      .select({ venueId: venueMemberships.venueId })
      .from(venueMemberships)
      .where(eq(venueMemberships.userId, targetId))
      .limit(1);
    const sessionsRevoked = stillMember
      ? 0
      : (await tx.delete(session).where(eq(session.userId, targetId)).returning({ id: session.id }))
          .length;

    // Webhooks keep delivering. Mark them so an admin can review.
    const flagged = await tx
      .update(webhookEndpoints)
      .set({ creatorDepartedAt: sql`now()` })
      .where(
        and(
          eq(webhookEndpoints.venueId, venueId),
          eq(webhookEndpoints.createdBy, targetId),
          isNull(webhookEndpoints.creatorDepartedAt),
        ),
      )
      .returning({ id: webhookEndpoints.id });

    return {
      ok: true,
      member: { userId: targetId, role: target.role as Role },
      revoked: { keys: mine.length, sessions: sessionsRevoked, webhooksFlagged: flagged.length },
    };
  });
}
