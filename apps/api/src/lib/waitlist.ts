import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { idempotencyKeys, waitlist } from "../db/schema";
import * as schema from "../db/schema";
import { claimKey, findKey } from "./idempotency";
import { walkIn, type WriteErrorCode } from "./reservations";

export type Db = NodePgDatabase<typeof schema>;

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
  };
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

export async function listWaitlist(db: Db, venueId: string): Promise<WaitlistEntry[]> {
  const rows = await db
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.venueId, venueId), eq(waitlist.status, "waiting")))
    .orderBy(waitlist.createdAt);
  return rows.map(toEntry);
}

export async function seatWaitlist(
  db: Db,
  venueId: string,
  entryId: string,
  key: string,
): Promise<SeatResult> {
  const row = (
    await db
      .select()
      .from(waitlist)
      .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, code: "waitlist_entry_not_found" };
  const stored = await findKey(db, venueId, key);
  if (stored) {
    if (stored.kind === "create" && row.reservationId === stored.reservationId) {
      return { ok: true, reservationId: stored.reservationId };
    }
    const seatedElsewhere = await db
      .select({ id: waitlist.id })
      .from(waitlist)
      .where(and(eq(waitlist.venueId, venueId), eq(waitlist.reservationId, stored.reservationId)))
      .limit(1);
    if (stored.kind !== "create" || seatedElsewhere.length > 0) return { ok: false, code: "invalid_request" };
  }
  if (row.status !== "waiting") return { ok: false, code: "invalid_transition" };

  const result = await walkIn(
    db,
    venueId,
    {
      partySize: row.partySize,
      zone: row.zone || undefined,
      guestName: row.guestName || undefined,
      guestContact: row.guestContact || undefined,
    },
    key,
  );
  if (!result.ok) return result;

  await db
    .update(waitlist)
    .set({ status: "seated", reservationId: result.id })
    .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)));
  return { ok: true, reservationId: result.id };
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
      await tx
        .update(waitlist)
        .set({ status: "cancelled" })
        .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)));
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
