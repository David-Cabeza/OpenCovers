import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { apiKeys, grants } from "../db/schema";
import * as schema from "../db/schema";
import { sha256Hex } from "./reservations";
import { enforceSandboxCap } from "../demo/limits";
import { INVALID, oneOf, optional, text, type Check } from "./body";
import { venueExists } from "./catalog";

export type Db = NodePgDatabase<typeof schema>;
export type Role = "read" | "write" | "admin";

export type AuthResult =
  | { ok: true; principal: string; role: Role; keyId: string }
  | { ok: false; reason: "unauthorized" | "venue_not_found" };

export type AdminResult =
  | { ok: true; principal: string }
  | { ok: false; reason: "unauthorized" | "forbidden" };

// The key route bodies (C81). The length rule binds new registrations only: a key stored before it keeps
// authenticating, and the account revoke takes any key a header could carry so such a key can still be revoked.
const NEW_KEY = text(256, /^[!-~]{32,}$/);
const PRINCIPAL = text(200, /\S/);
const VENUE_ID = text(200, /./);
const venueIds: Check<string[]> = (value) =>
  Array.isArray(value) && value.every((id) => VENUE_ID(id) !== INVALID) ? (value as string[]) : INVALID;

export const VENUE_KEY_FIELDS = { key: NEW_KEY, principal: PRINCIPAL, role: oneOf(["read", "write"] as const) };
export const ACCOUNT_KEY_FIELDS = {
  key: NEW_KEY,
  principal: PRINCIPAL,
  role: oneOf(["read", "write", "admin"] as const),
  venues: optional(venueIds),
};
export const VENUE_KEY_REVOKE_FIELDS = { hash: text(64, /^[0-9a-f]{64}$/) };
export const ACCOUNT_KEY_REVOKE_FIELDS = { key: text(8192, /\S/) };

type KeyConflict = { ok: false; code: "key_conflict" };

/** A stable, non-secret reference to a key for audit trails: a prefix too short to authenticate with. */
export function keyIdOf(hash: string): string {
  return `key_${hash.slice(0, 12)}`;
}

export async function addKey(
  db: Db,
  key: string,
  principal: string,
  venues: string[],
  role: Role = "read",
  createdBy: string | null = null,
): Promise<{ ok: true } | KeyConflict> {
  const hash = await sha256Hex(key);
  return db.transaction(async (tx) => {
    const [made] = await tx
      .insert(apiKeys)
      .values({ hash, principal, role, createdBy })
      .onConflictDoNothing()
      .returning({ hash: apiKeys.hash });
    if (!made) {
      // A key is registered once. A repeat with the same principal and role only adds grants; any other changes
      // nothing, and the answer says nothing about the stored row.
      const [stored] = await tx
        .select({ principal: apiKeys.principal, role: apiKeys.role })
        .from(apiKeys)
        .where(eq(apiKeys.hash, hash))
        .for("update");
      if (stored?.principal !== principal || stored.role !== role) return { ok: false, code: "key_conflict" } as const;
    }
    for (const venue of venues) {
      await tx
        .insert(grants)
        .values({ keyHash: hash, venueId: venue })
        .onConflictDoNothing();
    }
    return { ok: true } as const;
  });
}

export async function authenticate(
  db: Db,
  key: string,
  venueId: string,
): Promise<AuthResult> {
  const hash = await sha256Hex(key);
  const row = (
    await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1)
  )[0];
  if (!row) return { ok: false, reason: "unauthorized" };
  const granted = (
    await db
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.keyHash, hash),
          or(eq(grants.venueId, venueId), eq(grants.venueId, "*")),
        ),
      )
      .limit(1)
  )[0];
  if (!granted) return { ok: false, reason: "venue_not_found" };
  return { ok: true, principal: row.principal, role: row.role as Role, keyId: keyIdOf(hash) };
}

/** The instance-wide key routes act on every venue, so they need an `admin` key that holds the all-venues grant. */
export async function authenticateAdmin(db: Db, key: string): Promise<AdminResult> {
  const hash = await sha256Hex(key);
  const row = (
    await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1)
  )[0];
  if (!row) return { ok: false, reason: "unauthorized" };
  if (row.role !== "admin") return { ok: false, reason: "forbidden" };
  const allVenues = (
    await db
      .select()
      .from(grants)
      .where(and(eq(grants.keyHash, hash), eq(grants.venueId, "*")))
      .limit(1)
  )[0];
  if (!allVenues) return { ok: false, reason: "forbidden" };
  return { ok: true, principal: row.principal };
}

export async function listKeys(db: Db) {
  return db
    .select({ principal: apiKeys.principal, role: apiKeys.role })
    .from(apiKeys)
    .orderBy(apiKeys.principal);
}

export async function revokeKey(db: Db, key: string): Promise<void> {
  const hash = await sha256Hex(key);
  await db.transaction(async (tx) => {
    await tx.delete(grants).where(eq(grants.keyHash, hash));
    await tx.delete(apiKeys).where(eq(apiKeys.hash, hash));
  });
}

export async function listVenueKeys(
  db: Db,
  venueId: string,
): Promise<{ principal: string; role: Role; hash: string }[]> {
  const rows = await db
    .select({ principal: apiKeys.principal, role: apiKeys.role, hash: apiKeys.hash })
    .from(grants)
    .innerJoin(apiKeys, eq(grants.keyHash, apiKeys.hash))
    .where(eq(grants.venueId, venueId))
    .orderBy(apiKeys.principal);
  return rows.map((r) => ({
    principal: r.principal,
    role: r.role as Role,
    hash: r.hash,
  }));
}

export async function addVenueKey(
  db: Db,
  venueId: string,
  key: string,
  principal: string,
  role: Role = "read",
  createdBy: string | null = null,
): Promise<{ ok: true } | KeyConflict | { ok: false; code: "venue_not_found" }> {
  const hash = await sha256Hex(key);
  return db.transaction(async (tx) => {
    const dbTx = tx as unknown as Db;
    if (!(await venueExists(dbTx, venueId))) return { ok: false, code: "venue_not_found" } as const;
    // A key made in a sandbox counts against the sandbox's cap, under its venue lock. A repeat of a key the venue
    // already holds adds no grant, so it is not refused at the cap.
    const [held] = await tx
      .select({ hash: grants.keyHash })
      .from(grants)
      .where(and(eq(grants.keyHash, hash), eq(grants.venueId, venueId)));
    if (!held) await enforceSandboxCap(dbTx, venueId, "apiKeys");
    return addKey(dbTx, key, principal, [venueId], role, createdBy);
  });
}

export async function revokeVenueKey(
  db: Db,
  venueId: string,
  hash: string,
): Promise<{ ok: true } | { ok: false; code: "venue_not_found" }> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .delete(grants)
      .where(and(eq(grants.keyHash, hash), eq(grants.venueId, venueId)))
      .returning({ hash: grants.keyHash });
    // Idempotent: a hash that is not a key of the venue revokes nothing and is still ok, unless the venue is unknown.
    if (revoked.length === 0 && !(await venueExists(tx as unknown as Db, venueId))) {
      return { ok: false, code: "venue_not_found" } as const;
    }
    const remaining = await tx
      .select()
      .from(grants)
      .where(eq(grants.keyHash, hash))
      .limit(1);
    if (remaining.length === 0) {
      await tx.delete(apiKeys).where(eq(apiKeys.hash, hash));
    }
    return { ok: true } as const;
  });
}
