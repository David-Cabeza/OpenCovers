import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { invitations } from "../db/schema";
import { grantMembership, type Db, type Role } from "./memberships";
import { recordMembershipAudit } from "./membership-audit";
import { sha256Hex } from "./reservations";

export const INVITATION_TOKEN_HEADER = "x-invitation-token";
export const DEFAULT_EXPIRY_HOURS = 72;
export const MAX_EXPIRY_HOURS = 336;
export const KEEP_DAYS_AFTER_EXPIRY = 30;

const DUMMY_HASH = "0".repeat(64);
const DAY_MS = 86_400_000;

export type InvitationStatus = "pending" | "redeemed" | "revoked" | "expired";

export interface InvitationView {
  id: string;
  role: Role;
  email: string | null;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

type Row = typeof invitations.$inferSelect;

function toView(row: Row, now = new Date()): InvitationView {
  const status: InvitationStatus = row.redeemedAt
    ? "redeemed"
    : row.revokedAt
      ? "revoked"
      : row.expiresAt <= now
        ? "expired"
        : "pending";
  return {
    id: row.id,
    role: row.role as Role,
    email: row.email,
    status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export function isInvitationEmail(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function isExpiryHours(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_EXPIRY_HOURS;
}

export async function createInvitation(
  db: Db,
  venueId: string,
  invitedBy: string,
  input: { role: Role; email?: string; expiresInHours?: number },
): Promise<{ invitation: InvitationView; token: string }> {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const hours = input.expiresInHours ?? DEFAULT_EXPIRY_HOURS;
  const tokenHash = await sha256Hex(secret);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(invitations)
      .values({
        id,
        venueId,
        role: input.role,
        email: input.email?.trim().toLowerCase() ?? null,
        tokenHash,
        invitedBy,
        expiresAt: sql`now() + ${hours} * interval '1 hour'`,
      })
      .returning();
    await recordMembershipAudit(tx, venueId, {
      action: "invited",
      actorUserId: invitedBy,
      invitationId: id,
      role: input.role,
    });
    return created;
  });
  return { invitation: toView(row), token: `${id}.${secret}` };
}

export async function listInvitations(db: Db, venueId: string): Promise<InvitationView[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.venueId, venueId))
    .orderBy(desc(invitations.createdAt), desc(invitations.id));
  const now = new Date();
  return rows.map((r) => toView(r, now));
}

export type RevokeResult =
  | { ok: true; invitation: InvitationView }
  | { ok: false; code: "invitation_not_found" | "invitation_redeemed" };

export async function revokeInvitation(
  db: Db,
  venueId: string,
  id: string,
  actorId: string,
): Promise<RevokeResult> {
  const where = and(eq(invitations.id, id), eq(invitations.venueId, venueId));
  const revoked = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(invitations)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          where,
          isNull(invitations.redeemedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (row) {
      await recordMembershipAudit(tx, venueId, {
        action: "invite_revoked",
        actorUserId: actorId,
        invitationId: id,
        role: row.role as Role,
      });
    }
    return row;
  });
  if (revoked) return { ok: true, invitation: toView(revoked) };
  const [row] = await db.select().from(invitations).where(where).limit(1);
  if (!row) return { ok: false, code: "invitation_not_found" };
  if (row.redeemedAt) return { ok: false, code: "invitation_redeemed" };
  return { ok: true, invitation: toView(row) };
}

function parseToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

async function verifiedId(db: Pick<Db, "select">, token: string): Promise<string | null> {
  const parts = parseToken(token);
  const row = parts
    ? (
        await db
          .select({ id: invitations.id, tokenHash: invitations.tokenHash })
          .from(invitations)
          .where(eq(invitations.id, parts.id))
          .limit(1)
      )[0]
    : undefined;
  const presented = Buffer.from(await sha256Hex(parts?.secret ?? ""), "hex");
  const expected = Buffer.from(row?.tokenHash ?? DUMMY_HASH, "hex");
  const same = presented.length === expected.length && timingSafeEqual(presented, expected);
  return row && same ? row.id : null;
}

async function claim(
  db: Pick<Db, "update">,
  id: string,
  email: string,
  redeemedBy: string | null,
): Promise<{ venueId: string; role: Role } | null> {
  const [row] = await db
    .update(invitations)
    .set({ redeemedAt: sql`now()`, redeemedBy })
    .where(
      and(
        eq(invitations.id, id),
        isNull(invitations.redeemedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, sql`now()`),
        or(isNull(invitations.email), eq(invitations.email, email.trim().toLowerCase())),
      ),
    )
    .returning({ venueId: invitations.venueId, role: invitations.role });
  return row ? { venueId: row.venueId, role: row.role as Role } : null;
}

export async function redeemInvitation(
  db: Db,
  token: string,
  account: { id: string; email: string },
): Promise<{ venueId: string; role: Role } | null> {
  return db.transaction(async (tx) => {
    const id = await verifiedId(tx, token);
    if (!id) return null;
    const claimed = await claim(tx, id, account.email, account.id);
    if (!claimed) return null;
    await grantMembership(tx, account.id, claimed.venueId, claimed.role);
    await recordMembershipAudit(tx, claimed.venueId, {
      action: "redeemed",
      targetUserId: account.id,
      invitationId: id,
      role: claimed.role,
    });
    return claimed;
  });
}

export async function claimForSignup(db: Db, token: string, email: string): Promise<boolean> {
  const id = await verifiedId(db, token);
  if (!id) return false;
  return (await claim(db, id, email, null)) !== null;
}

export async function grantClaimedInvitation(
  db: Db,
  token: string,
  userId: string,
): Promise<void> {
  const id = await verifiedId(db, token);
  if (!id) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(invitations)
      .set({ redeemedBy: userId })
      .where(
        and(
          eq(invitations.id, id),
          isNotNull(invitations.redeemedAt),
          isNull(invitations.redeemedBy),
        ),
      )
      .returning({ venueId: invitations.venueId, role: invitations.role });
    if (row) {
      await grantMembership(tx, userId, row.venueId, row.role as Role);
      await recordMembershipAudit(tx, row.venueId, {
        action: "redeemed",
        targetUserId: userId,
        invitationId: id,
        role: row.role as Role,
      });
    }
  });
}

export async function deleteLapsedInvitations(db: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS_AFTER_EXPIRY * DAY_MS);
  await db.delete(invitations).where(lt(invitations.expiresAt, cutoff));
}
