import { and, eq, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { idempotencyKeys, venues, waitlist } from "../db/schema";
import * as schema from "../db/schema";
import { claimKey } from "./idempotency";
import type { Origin } from "./origin";
import { boundLockWaits, isLockFailure, walkIn, type WriteErrorCode } from "./reservations";
import { localDateTime } from "./time";
import { enforceSandboxCap } from "../demo/limits";

export type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface WaitlistEntry {
  id: string;
  venueId: string;
  partySize: number;
  zone: string;
  guestName: string;
  guestContact: string;
  status: string;
  reservationId: string | null;
  createdAt: string;
  /** The local date a guest asked for through the public join, or null for the same-day queue (C76). */
  date: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  source: string;
}

export type AddResult =
  | { ok: true; id: string }
  | { ok: false; code: "venue_not_found" | "invalid_request" };

export type CancelResult =
  | { ok: true }
  | { ok: false; code: "waitlist_entry_not_found" | "invalid_transition" | "invalid_request" };

export type SeatResult =
  | { ok: true; reservationId: string }
  | { ok: false; code: "waitlist_entry_not_found" | "invalid_transition" | WriteErrorCode };

class WaitlistFailure extends Error {
  constructor(public code: "waitlist_entry_not_found" | "invalid_transition" | "invalid_request") {
    super(code);
  }
}

function toEntry(row: typeof waitlist.$inferSelect): WaitlistEntry {
  return {
    id: row.id,
    venueId: row.venueId,
    partySize: row.partySize,
    zone: row.zone,
    guestName: row.guestName,
    guestContact: row.guestContact,
    status: row.status,
    reservationId: row.reservationId,
    createdAt: row.createdAt.toISOString(),
    // Never the consent time or anything of the leave link (C76).
    date: row.date,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    source: row.source,
  };
}

/** Today's date in the venue's time zone, or null for an unknown venue. */
export async function venueToday(db: Db | DbTx, venueId: string): Promise<string | null> {
  const venue = (await db.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  return venue ? localDateTime(new Date(), venue.timezone).date : null;
}

export async function addWaitlist(
  db: Db,
  venueId: string,
  input: { partySize: number; zone?: string; guestName?: string; guestContact?: string },
  key?: string,
): Promise<AddResult> {
  try {
    return await db.transaction(async (tx) => {
      if (key !== undefined) {
        const stored = await claimKey(tx, venueId, key);
        if (stored) {
          if (stored.kind !== "waitlist_add") throw new WaitlistFailure("invalid_request");
          return { ok: true as const, id: stored.reservationId };
        }
      }
      await enforceSandboxCap(tx as unknown as Db, venueId, "waitlist");
      const id = crypto.randomUUID();
      await tx.insert(waitlist).values({
        id,
        venueId,
        partySize: input.partySize,
        zone: input.zone ?? "",
        guestName: input.guestName ?? "",
        guestContact: input.guestContact ?? "",
      });
      if (key !== undefined) {
        await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "waitlist_add", version: 1 });
      }
      return { ok: true as const, id };
    });
  } catch (error) {
    if (error instanceof WaitlistFailure) return { ok: false, code: "invalid_request" };
    throw error;
  }
}

/**
 * The waiting entries, oldest first (C76). Without `date`, or with today's, the same-day queue (a null date) and
 * today's entries; with another date, only the entries of that date.
 */
export async function listWaitlist(db: Db, venueId: string, date?: string): Promise<WaitlistEntry[]> {
  const today = (await venueToday(db, venueId)) ?? localDateTime(new Date()).date;
  const day = date ?? today;
  const rows = await db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.venueId, venueId),
        eq(waitlist.status, "waiting"),
        day === today ? or(isNull(waitlist.date), eq(waitlist.date, day)) : eq(waitlist.date, day),
      ),
    )
    .orderBy(waitlist.createdAt, waitlist.id);
  return rows.map(toEntry);
}

export async function seatWaitlist(
  db: Db,
  venueId: string,
  entryId: string,
  key: string,
  origin: Origin | null,
): Promise<SeatResult> {
  const seat = db.transaction(async (tx): Promise<SeatResult> => {
    await boundLockWaits(tx);
    // Key lock first, then the entry row, the order cancelWaitlist takes them in.
    const stored = await claimKey(tx, venueId, key);
    const row = (
      await tx
        .select()
        .from(waitlist)
        .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)))
        .for("update")
    )[0];
    if (!row) return { ok: false, code: "waitlist_entry_not_found" };
    if (stored) {
      if (stored.kind === "create" && row.reservationId === stored.reservationId) {
        return { ok: true, reservationId: stored.reservationId };
      }
      // Any other stored key (another entry's seat, an unrelated create or write) is a reused key.
      return { ok: false, code: "invalid_request" };
    }
    if (row.status !== "waiting") return { ok: false, code: "invalid_transition" };
    // A seat is a walk-in now, so only today's queue seats: an entry for another date stays waiting (C77, Q8).
    if (row.date !== null && row.date !== (await venueToday(tx, venueId))) return { ok: false, code: "invalid_transition" };

    const result = await walkIn(
      tx,
      venueId,
      {
        partySize: row.partySize,
        zone: row.zone || undefined,
        guestName: row.guestName || undefined,
        guestContact: row.guestContact || undefined,
        origin,
      },
      key,
    );
    if (!result.ok) return result;

    // After the walk-in's event, so it must not wait: this transaction already holds the entry's row lock.
    await tx
      .update(waitlist)
      .set({ status: "seated", reservationId: result.id })
      .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)));
    return { ok: true, reservationId: result.id };
  });
  return seat.catch((error): SeatResult => {
    if (isLockFailure(error)) return { ok: false, code: "venue_busy" };
    throw error;
  });
}

export async function cancelWaitlist(
  db: Db,
  venueId: string,
  entryId: string,
  key?: string,
): Promise<CancelResult> {
  try {
    return await db.transaction(async (tx) => {
      if (key !== undefined) {
        const stored = await claimKey(tx, venueId, key);
        if (stored) {
          if (stored.kind !== "waitlist_cancel" || stored.reservationId !== entryId) {
            throw new WaitlistFailure("invalid_request");
          }
          return { ok: true as const };
        }
      }
      const row = (
        await tx
          .select()
          .from(waitlist)
          .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)))
          .for("update")
      )[0];
      if (!row) throw new WaitlistFailure("waitlist_entry_not_found");
      if (row.status !== "waiting") throw new WaitlistFailure("invalid_transition");
      await markCancelled(tx, venueId, entryId);
      if (key !== undefined) {
        await tx
          .insert(idempotencyKeys)
          .values({ key, venueId, reservationId: entryId, kind: "waitlist_cancel", version: 1 });
      }
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof WaitlistFailure) return { ok: false, code: error.code };
    throw error;
  }
}

/**
 * The staff cancel's write, shared with the guest leave (C75). The caller holds the entry's row lock and has seen it
 * `waiting`. A staff cancel leaves a public entry's leave link alone (Q8): the guest still reads the entry.
 */
export async function markCancelled(tx: DbTx, venueId: string, entryId: string): Promise<void> {
  await tx
    .update(waitlist)
    .set({ status: "cancelled" })
    .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)));
}
