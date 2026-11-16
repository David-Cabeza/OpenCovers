import { and, asc, eq, sql } from "drizzle-orm";
import { user, venueMemberships } from "../db/schema";
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

export type RemoveResult =
  | { ok: true; member: { userId: string; role: Role } }
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
    return { ok: true, member: { userId: targetId, role: target.role as Role } };
  });
}
