import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { idempotencyKeys, reservations, selfServiceLinks } from "../db/schema";
import { claimKey } from "./idempotency";

// The self-service link of ADR-0017: `<linkId>.<secret>`, stored as the SHA-256 of the secret only.

type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const TOKEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const LINK_LIFE_MS = 48 * 3_600_000;
const DUMMY_HASH = Buffer.alloc(32);
const LAPSED_ROW_MS = 30 * 86_400_000;

export type Compare = (a: Buffer, b: Buffer) => boolean;

export interface Link {
  id: string;
  venueId: string;
  reservationId: string;
  revokedAt: Date | null;
  cancelKey: string | null;
}

export interface IssuedLink {
  token: string;
  expiresAt: Date;
}

const digest = (secret: string) => createHash("sha256").update(secret).digest();

export const linkExpiry = (endsAt: Date) => new Date(endsAt.getTime() + LINK_LIFE_MS);

/**
 * The link a token names while it has not expired, revoked links included, or null. An unknown link id
 * runs the same compare against a dummy hash, so the time taken does not tell whether the id exists.
 */
export async function findLink(db: Db, token: string | undefined, compare: Compare = timingSafeEqual): Promise<Link | null> {
  const match = TOKEN.exec(token ?? "");
  if (!match) return null;
  const [, id, secret] = match;
  const row = (
    await db
      .select({
        id: selfServiceLinks.id,
        venueId: selfServiceLinks.venueId,
        reservationId: selfServiceLinks.reservationId,
        secretHash: selfServiceLinks.secretHash,
        revokedAt: selfServiceLinks.revokedAt,
        cancelKey: selfServiceLinks.cancelKey,
        live: sql<boolean>`${selfServiceLinks.expiresAt} > now()`,
      })
      .from(selfServiceLinks)
      .where(eq(selfServiceLinks.id, id))
      .limit(1)
  )[0];
  const same = compare(digest(secret), row ? Buffer.from(row.secretHash, "hex") : DUMMY_HASH);
  if (!row || !same || !row.live) return null;
  const { secretHash: _hash, live: _live, ...link } = row;
  return link;
}

export async function mintLink(tx: DbTx, venueId: string, reservationId: string, endsAt: Date): Promise<IssuedLink> {
  const id = crypto.randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = linkExpiry(endsAt);
  await tx.insert(selfServiceLinks).values({
    id,
    venueId,
    reservationId,
    secretHash: digest(secret).toString("hex"),
    expiresAt,
  });
  return { token: `${id}.${secret}`, expiresAt };
}

/** Revokes the reservation's live link and mints a new one. Only a `booked` reservation that is not erased gets one. */
export async function rotateLink(tx: DbTx, venueId: string, reservationId: string): Promise<IssuedLink | null> {
  const current = (
    await tx
      .select({ status: reservations.status, endsAt: reservations.endsAt, erased: reservations.erased })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, venueId)))
      .for("update")
      .limit(1)
  )[0];
  if (!current || current.status !== "booked" || current.erased) return null;
  await tx
    .update(selfServiceLinks)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(selfServiceLinks.reservationId, reservationId), isNull(selfServiceLinks.revokedAt)));
  return mintLink(tx, venueId, reservationId, current.endsAt);
}

/**
 * Whether the link still works inside a write transaction that holds the reservation's row lock, which
 * every writer of links takes first. A revoked link works only for a repeat of the cancel that revoked it.
 */
export async function linkWorks(tx: DbTx, linkId: string, cancelKey?: string): Promise<boolean> {
  const link = (
    await tx
      .select({ revokedAt: selfServiceLinks.revokedAt, cancelKey: selfServiceLinks.cancelKey })
      .from(selfServiceLinks)
      .where(eq(selfServiceLinks.id, linkId))
      .limit(1)
  )[0];
  if (!link) return false;
  return link.revokedAt === null || (cancelKey !== undefined && link.cancelKey === cancelKey);
}

export async function revokeForCancel(tx: DbTx, linkId: string, cancelKey: string): Promise<boolean> {
  const revoked = await tx
    .update(selfServiceLinks)
    .set({ revokedAt: sql`now()`, cancelKey })
    .where(and(eq(selfServiceLinks.id, linkId), isNull(selfServiceLinks.revokedAt)))
    .returning({ id: selfServiceLinks.id });
  return revoked.length === 1;
}

export async function deleteLinks(tx: DbTx, venueId: string, reservationIds: string[]): Promise<void> {
  if (reservationIds.length === 0) return;
  await tx
    .delete(selfServiceLinks)
    .where(and(eq(selfServiceLinks.venueId, venueId), inArray(selfServiceLinks.reservationId, reservationIds)));
}

export async function deleteLapsedLinks(db: Db, now: Date): Promise<void> {
  await db.delete(selfServiceLinks).where(lt(selfServiceLinks.expiresAt, new Date(now.getTime() - LAPSED_ROW_MS)));
}

export type ReissueResult =
  | { ok: true; link: IssuedLink }
  | { ok: false; code: "invalid_request" | "reservation_not_found" | "invalid_transition" };

/** The staff reissue. Every call, a repeat of the key included, revokes the link and mints a new one. */
export async function reissueLink(db: Db, venueId: string, reservationId: string, key: string): Promise<ReissueResult> {
  return db.transaction(async (tx): Promise<ReissueResult> => {
    const existing = await claimKey(tx, venueId, key);
    if (existing && (existing.kind !== "self_service_link" || existing.reservationId !== reservationId)) {
      return { ok: false, code: "invalid_request" };
    }
    const current = (
      await tx
        .select({ status: reservations.status, version: reservations.version, erased: reservations.erased })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, venueId)))
        .for("update")
        .limit(1)
    )[0];
    if (!current) return { ok: false, code: "reservation_not_found" };
    if (current.status !== "booked" || current.erased) return { ok: false, code: "invalid_transition" };
    if (!existing) {
      await tx
        .insert(idempotencyKeys)
        .values({ key, venueId, reservationId, kind: "self_service_link", version: current.version });
    }
    const link = await rotateLink(tx, venueId, reservationId);
    if (!link) return { ok: false, code: "invalid_transition" };
    return { ok: true, link };
  });
}
