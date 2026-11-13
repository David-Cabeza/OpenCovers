import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notExists, or } from "drizzle-orm";
import { guestAudit, guests, reservations, venues, waitlist } from "../db/schema";
import { forgetMergeState } from "./guests";
import { pruneEvents } from "./reservations";
import { eraseReservations, withMerged, type Db } from "./venue";

export interface RetentionBatch {
  size: number;
  perRun: number;
}

export const RETENTION_BATCH: RetentionBatch = { size: 200, perRun: 25 };

const DAY_MS = 86_400_000;

export async function runRetention(
  db: Db,
  now = new Date(),
  batch: RetentionBatch = RETENTION_BATCH,
): Promise<void> {
  const all = await db.select({ id: venues.id, retentionDays: venues.retentionDays }).from(venues);
  for (const venue of all) {
    const cutoff = new Date(now.getTime() - venue.retentionDays * DAY_MS);
    await pruneEvents(db, venue.id, cutoff);
    await inBatches(batch, (limit) => expireGuests(db, venue.id, cutoff, limit));
    await inBatches(batch, (limit) => expireUnlinkedReservations(db, venue.id, cutoff, limit));
    await inBatches(batch, (limit) => expireWaitlist(db, venue.id, cutoff, limit));
  }
}

async function inBatches(batch: RetentionBatch, step: (limit: number) => Promise<number>): Promise<void> {
  for (let i = 0; i < batch.perRun; i++) {
    if ((await step(batch.size)) < batch.size) return;
  }
}

async function expireGuests(db: Db, venueId: string, cutoff: Date, limit: number): Promise<number> {
  return db.transaction(async (tx) => {
    const roots = await tx
      .select()
      .from(guests)
      .where(
        and(
          eq(guests.venueId, venueId),
          isNull(guests.mergedInto),
          lt(guests.lastVisitAt, cutoff),
          or(isNotNull(guests.email), isNotNull(guests.phone), ne(guests.name, "")),
          notExists(
            tx
              .select({ id: reservations.id })
              .from(reservations)
              .where(
                and(
                  eq(reservations.venueId, venueId),
                  eq(reservations.guestId, guests.id),
                  eq(reservations.erased, false),
                  gte(reservations.endsAt, cutoff),
                ),
              ),
          ),
        ),
      )
      .orderBy(guests.lastVisitAt, guests.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (roots.length === 0) return 0;

    const ids = (await withMerged(tx, venueId, roots)).map((g) => g.id);
    const visits = await tx
      .select({ id: reservations.id, version: reservations.version })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, venueId),
          inArray(reservations.guestId, ids),
          eq(reservations.erased, false),
        ),
      );
    await eraseReservations(tx, venueId, visits);
    await tx
      .update(guests)
      .set({ email: null, phone: null, name: "" })
      .where(and(eq(guests.venueId, venueId), inArray(guests.id, ids)));
    await tx
      .insert(guestAudit)
      .values(ids.map((id) => ({ venueId, guestId: id, action: "expired" as const, principal: "retention" })));
    await forgetMergeState(tx, venueId, ids);
    return roots.length;
  });
}

async function expireUnlinkedReservations(
  db: Db,
  venueId: string,
  cutoff: Date,
  limit: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: reservations.id, version: reservations.version })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, venueId),
          isNull(reservations.guestId),
          eq(reservations.erased, false),
          lt(reservations.endsAt, cutoff),
          or(ne(reservations.guestName, ""), ne(reservations.guestContact, "")),
        ),
      )
      .orderBy(reservations.endsAt, reservations.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    await eraseReservations(tx, venueId, due);
    return due.length;
  });
}

async function expireWaitlist(db: Db, venueId: string, cutoff: Date, limit: number): Promise<number> {
  const due = db
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(
      and(
        eq(waitlist.venueId, venueId),
        lt(waitlist.createdAt, cutoff),
        or(ne(waitlist.guestName, ""), ne(waitlist.guestContact, "")),
      ),
    )
    .orderBy(waitlist.createdAt, waitlist.id)
    .limit(limit)
    .for("update", { skipLocked: true });
  const deleted = await db
    .delete(waitlist)
    .where(and(eq(waitlist.venueId, venueId), inArray(waitlist.id, due)))
    .returning({ id: waitlist.id });
  return deleted.length;
}
