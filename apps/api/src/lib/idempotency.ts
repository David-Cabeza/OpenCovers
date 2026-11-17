import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { idempotencyKeys } from "../db/schema";

type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type StoredKey = typeof idempotencyKeys.$inferSelect;

// The lock lasts until commit, so a duplicate sent while the first request runs waits and then replays it.
export async function claimKey(tx: DbTx, venueId: string, key: string): Promise<StoredKey | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`idempotency:${venueId}:${key}`}, 0))`);
  return findKey(tx, venueId, key);
}

export async function findKey(db: Db | DbTx, venueId: string, key: string): Promise<StoredKey | undefined> {
  return (
    await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key)))
      .limit(1)
  )[0];
}
