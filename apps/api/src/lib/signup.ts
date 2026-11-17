import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { user, venueMemberships } from "../db/schema";
import { recordMembershipAudit } from "./membership-audit";

export const SIGNUP_MODES = ["open", "first-user", "closed"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export function signupMode(
  value: string | undefined = process.env.SIGNUP,
): SignupMode {
  if (value === undefined || value === "") return "open";
  if ((SIGNUP_MODES as readonly string[]).includes(value)) {
    return value as SignupMode;
  }
  throw new Error(
    `SIGNUP must be one of ${SIGNUP_MODES.join(", ")}. Got "${value}".`,
  );
}

export async function isCreator(
  db: NodePgDatabase<typeof schema>,
  userId: string,
): Promise<boolean> {
  const result = await db.execute<{ owner: boolean }>(
    sql`SELECT first_signup AS owner FROM "user" WHERE id = ${userId}`,
  );
  return result.rows[0]?.owner === true;
}

export async function mayCreateVenue(
  db: NodePgDatabase<typeof schema>,
  mode: SignupMode,
  userId: string,
): Promise<boolean> {
  if (mode === "open") return true;
  return isCreator(db, userId);
}

export type SignupDecision =
  | { allowed: false }
  | { allowed: true; firstSignup: boolean };

export async function decideSignup(
  db: NodePgDatabase<typeof schema>,
  mode: SignupMode,
): Promise<SignupDecision> {
  if (mode === "open") return { allowed: true, firstSignup: false };
  if (mode === "closed") return { allowed: false };
  const result = await db.execute<{ found: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM "user") AS found`,
  );
  if (result.rows[0]?.found) return { allowed: false };
  return { allowed: true, firstSignup: true };
}

export type TransferCreatorResult =
  | { ok: true; creator: { userId: string }; changed: boolean }
  | { ok: false; code: "forbidden" | "member_not_found" };

/**
 * Moves the `first_signup` owner mark from the caller to `targetId`. Only the
 * current owner may call it, and the target must be a member of a venue the
 * caller administers. The old mark is cleared before the new one is set
 * because the partial unique index is checked row by row.
 */
export async function transferCreator(
  db: NodePgDatabase<typeof schema>,
  actorId: string,
  targetId: string,
): Promise<TransferCreatorResult> {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ owner: user.firstSignup })
      .from(user)
      .where(eq(user.id, actorId))
      .for("update");
    if (!actor?.owner) return { ok: false, code: "forbidden" };

    const shared = await tx
      .select({ venueId: venueMemberships.venueId })
      .from(venueMemberships)
      .where(
        and(
          eq(venueMemberships.userId, targetId),
          sql`${venueMemberships.venueId} IN (
            SELECT venue_id FROM venue_memberships
            WHERE user_id = ${actorId} AND role = 'admin')`,
        ),
      );
    if (shared.length === 0 && targetId !== actorId) {
      return { ok: false, code: "member_not_found" };
    }
    if (targetId === actorId) return { ok: true, creator: { userId: actorId }, changed: false };

    await tx.update(user).set({ firstSignup: false }).where(eq(user.id, actorId));
    await tx.update(user).set({ firstSignup: true }).where(eq(user.id, targetId));
    for (const { venueId } of shared) {
      await recordMembershipAudit(tx, venueId, {
        action: "creator_transferred",
        actorUserId: actorId,
        targetUserId: targetId,
      });
    }
    return { ok: true, creator: { userId: targetId }, changed: true };
  });
}
