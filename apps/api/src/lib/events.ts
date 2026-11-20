import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { originColumns, type Origin } from "./origin";

type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface NewEvent {
  type: string;
  reservationId: string;
  version: number;
  tombstoneHash?: string;
  origin?: Origin | null;
}

/**
 * The only way to write events. Event ids come from one sequence and a row is visible only at commit, so without
 * this lock a later id of a venue could commit while an earlier one is still pending, and a cursor reader would
 * pass the earlier one for good (C11). The per-venue lock, held to commit, makes a venue's commit order its id
 * order: the next writer takes its ids only after the previous one committed (ADR-0024).
 *
 * Lock order: this lock is the last one a write takes, after the idempotency key, guest-day, online-open, the
 * planner, the reservation, link, waitlist and guest rows, and overbooking. Call it as the last statement of the
 * transaction: nothing after it may wait on a lock, or a writer queued here could close a cycle. Writers queued
 * here each hold a pool connection, so the lock must be held only for this insert and the commit: a write passes
 * all of its events in this one call.
 */
export async function appendEvents(tx: DbTx, venueId: string, rows: NewEvent[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`events:${venueId}`}, 0))`);
  // One statement for any count: a multi-row VALUES would hit the 65,535 bind parameter limit on a large erasure.
  const payload = JSON.stringify(
    rows.map((r) => ({
      type: r.type,
      reservation_id: r.reservationId,
      version: r.version,
      tombstone_hash: r.tombstoneHash ?? null,
      ...originColumns(r.origin),
    })),
  );
  await tx.execute(sql`
    insert into events (venue_id, type, reservation_id, version, tombstone_hash, channel, actor)
    select ${venueId}, e->>'type', e->>'reservation_id', (e->>'version')::int, e->>'tombstone_hash', e->>'channel', e->>'actor'
    from jsonb_array_elements(${payload}::jsonb) with ordinality as rows(e, n)
    order by n`);
}
