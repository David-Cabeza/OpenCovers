import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { apiKeys, grants } from "../db/schema";
import * as schema from "../db/schema";
import { sha256Hex } from "./reservations";

export type Db = NodePgDatabase<typeof schema>;
export type Role = "read" | "write" | "admin";

export type AuthResult =
  | { ok: true; principal: string; role: Role }
  | { ok: false; reason: "unauthorized" | "venue_not_found" };

export type AdminResult =
  | { ok: true; principal: string }
  | { ok: false; reason: "unauthorized" | "forbidden" };

export async function addKey(
  db: Db,
  key: string,
  principal: string,
  venues: string[],
  role: Role = "read",
): Promise<void> {
  const hash = await sha256Hex(key);
  await db.transaction(async (tx) => {
    await tx
      .insert(apiKeys)
      .values({ hash, principal, role })
      .onConflictDoNothing();
    for (const venue of venues) {
      await tx
        .insert(grants)
        .values({ keyHash: hash, venueId: venue })
        .onConflictDoNothing();
    }
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
  return { ok: true, principal: row.principal, role: row.role as Role };
}

export async function authenticateAdmin(db: Db, key: string): Promise<AdminResult> {
  const hash = await sha256Hex(key);
  const row = (
    await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1)
  )[0];
  if (!row) return { ok: false, reason: "unauthorized" };
  if (row.role !== "admin") return { ok: false, reason: "forbidden" };
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
): Promise<void> {
  await addKey(db, key, principal, [venueId], role);
}

export async function revokeVenueKey(
  db: Db,
  venueId: string,
  hash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(grants)
      .where(and(eq(grants.keyHash, hash), eq(grants.venueId, venueId)));
    const remaining = await tx
      .select()
      .from(grants)
      .where(eq(grants.keyHash, hash))
      .limit(1);
    if (remaining.length === 0) {
      await tx.delete(apiKeys).where(eq(apiKeys.hash, hash));
    }
  });
}
