import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { waitlist } from "../db/schema";
import * as schema from "../db/schema";
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
  | { ok: false; code: "venue_not_found" };

export type CancelResult =
  | { ok: true }
  | { ok: false; code: "waitlist_entry_not_found" | "invalid_transition" };

export type SeatResult =
  | { ok: true; reservationId: string }
  | { ok: false; code: "waitlist_entry_not_found" | "invalid_transition" | WriteErrorCode };

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
): Promise<AddResult> {
  const id = crypto.randomUUID();
  await db.insert(waitlist).values({
    id,
    venueId,
    partySize: input.partySize,
    zone: input.zone ?? "",
    guestName: input.guestName ?? "",
    guestContact: input.guestContact ?? "",
  });
  return { ok: true, id };
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
): Promise<CancelResult> {
  const row = (
    await db
      .select()
      .from(waitlist)
      .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, code: "waitlist_entry_not_found" };
  if (row.status !== "waiting") return { ok: false, code: "invalid_transition" };

  await db
    .update(waitlist)
    .set({ status: "cancelled" })
    .where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId)));
  return { ok: true };
}
