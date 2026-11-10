import { and, eq, gt, gte, inArray, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  events,
  idempotencyKeys,
  reservations,
  services,
  tableAllocations,
  tables,
  tombstones,
  venues,
} from "../db/schema";
import * as schema from "../db/schema";
import { formatTime, generateSlots, nowInTimezone, toMinutes, toTimestamp } from "./time";

export type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CreateReservationInput {
  date: string;
  time: string;
  durationMinutes: number;
  partySize: number;
  tableIds?: string[];
  zone?: string;
  initialStatus?: "booked" | "seated";
  guestName?: string;
  guestContact?: string;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
}

export interface WalkInInput {
  date?: string;
  time?: string;
  partySize: number;
  tableIds?: string[];
  zone?: string;
  guestName?: string;
  guestContact?: string;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
}

export interface ModifyReservationInput {
  partySize?: number;
  tableIds?: string[];
}

export interface Reservation {
  id: string;
  date: string;
  time: string;
  service: string;
  zone: string;
  partySize: number;
  status: string;
  version: number;
  bookedVia: string;
  basis: string;
  ownerPrincipal: string;
  guestName: string;
  guestContact: string;
}

export interface Event {
  id: number;
  type: string;
  reservationId: string;
  version: number;
  tombstoneHash?: string;
  occurredAt: string;
}

export interface AvailabilitySlot {
  time: string;
  available: boolean;
  type: string;
}

export type StatusTransition = "seated" | "attended" | "no_show";

export type WriteErrorCode =
  | "slot_taken"
  | "invalid_transition"
  | "reservation_not_found"
  | "already_cancelled"
  | "invalid_request"
  | "party_size_too_large"
  | "no_suitable_table"
  | "outside_hours"
  | "lead_time_violation"
  | "venue_not_found";

export type WriteResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: WriteErrorCode };

export type CancelResult =
  | { ok: true; hash: string }
  | { ok: false; code: "reservation_not_found" | "already_cancelled" | "invalid_request" | "venue_not_found" };

const ACTIVE_STATUSES = ["booked", "seated"];
const ALLOWED_TRANSITIONS: Record<StatusTransition, string[]> = {
  seated: ["booked"],
  attended: ["seated"],
  no_show: ["booked"],
};
const DEFAULT_DURATION_SECONDS = 120 * 60;

class ReservationError extends Error {
  constructor(readonly code: WriteErrorCode) {
    super(code);
  }
}

function isExclusionViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; constraint?: string; cause?: unknown };
  if (e.code === "23P01" || e.constraint === "table_allocations_no_overlap") {
    return true;
  }
  return isExclusionViolation(e.cause);
}

async function venueOf(db: Db, venueId: string) {
  return (
    await db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
  )[0];
}

async function deriveService(
  db: Db,
  venueId: string,
  time: string,
): Promise<{ name: string; openStart: string; openEnd: string } | null> {
  const minute = toMinutes(time);
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.venueId, venueId));
  for (const service of rows) {
    if (
      minute >= toMinutes(service.openStart) &&
      minute < toMinutes(service.openEnd)
    ) {
      return {
        name: service.name,
        openStart: service.openStart,
        openEnd: service.openEnd,
      };
    }
  }
  return null;
}

async function totalSeats(db: Db, venueId: string, tableIds: string[]) {
  if (tableIds.length === 0) return 0;
  const rows = await db
    .select({ seats: tables.seats })
    .from(tables)
    .where(and(eq(tables.venueId, venueId), inArray(tables.id, tableIds)));
  return rows.reduce((sum, r) => sum + r.seats, 0);
}

async function autoAssignTables(
  tx: DbTx,
  venueId: string,
  startsAt: Date,
  endsAt: Date,
  partySize: number,
  zone?: string,
): Promise<string[]> {
  const allTables = await tx
    .select()
    .from(tables)
    .where(
      zone
        ? and(eq(tables.venueId, venueId), eq(tables.zone, zone))
        : eq(tables.venueId, venueId),
    );
  const totalCapacity = allTables.reduce((sum, t) => sum + t.seats, 0);
  if (partySize > totalCapacity) throw new ReservationError("party_size_too_large");

  const free: { id: string; seats: number }[] = [];
  for (const t of allTables) {
    const busy = await tx
      .select()
      .from(tableAllocations)
      .innerJoin(reservations, eq(tableAllocations.reservationId, reservations.id))
      .where(
        and(
          eq(tableAllocations.venueId, venueId),
          eq(tableAllocations.tableId, t.id),
          inArray(reservations.status, ACTIVE_STATUSES),
          lt(tableAllocations.startsAt, endsAt),
          gt(tableAllocations.endsAt, startsAt),
        ),
      )
      .limit(1);
    if (busy.length === 0) free.push({ id: t.id, seats: t.seats });
  }

  const picked = pickCombination(free, partySize);
  if (picked === null) throw new ReservationError("no_suitable_table");
  return picked;
}

function pickCombination(
  free: { id: string; seats: number }[],
  partySize: number,
): string[] | null {
  const sorted = [...free].sort((a, b) => a.seats - b.seats);
  const state: { best: { id: string; seats: number }[] | null; seats: number } = {
    best: null,
    seats: Number.POSITIVE_INFINITY,
  };

  (function search(
    start: number,
    chosen: { id: string; seats: number }[],
    total: number,
  ) {
    if (state.best && chosen.length > state.best.length) return;
    if (total >= partySize) {
      if (
        state.best === null ||
        chosen.length < state.best.length ||
        (chosen.length === state.best.length && total < state.seats)
      ) {
        state.best = chosen.slice();
        state.seats = total;
      }
      return;
    }
    for (let i = start; i < sorted.length; i++) {
      chosen.push(sorted[i]);
      search(i + 1, chosen, total + sorted[i].seats);
      chosen.pop();
    }
  })(0, [], 0);

  return state.best ? state.best.map((t) => t.id) : null;
}

function toReservation(row: typeof reservations.$inferSelect, timezone: string): Reservation {
  return {
    id: row.id,
    date: row.date,
    time: formatTime(row.startsAt, timezone),
    service: row.service,
    zone: row.zone,
    partySize: row.partySize,
    status: row.status,
    version: row.version,
    bookedVia: row.bookedVia,
    basis: row.basis,
    ownerPrincipal: row.ownerPrincipal,
    guestName: row.guestName,
    guestContact: row.guestContact,
  };
}

export async function createReservation(
  db: Db,
  venueId: string,
  input: CreateReservationInput,
  key: string,
): Promise<WriteResult> {
  const venue = await venueOf(db, venueId);
  if (!venue) return { ok: false, code: "venue_not_found" };
  const timezone = venue.timezone;
  const startsAt = toTimestamp(input.date, input.time, timezone);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60000);
  const service = await deriveService(db, venueId, input.time);
  if (!service) return { ok: false, code: "outside_hours" };
  const isWalkIn = input.initialStatus === "seated";
  const minute = toMinutes(input.time);
  if (
    !isWalkIn &&
    (minute - toMinutes(service.openStart)) % venue.slotIntervalMinutes !== 0
  ) {
    return { ok: false, code: "outside_hours" };
  }
  if (minute > toMinutes(service.openEnd) - venue.lastSeatingOffsetMinutes) {
    return { ok: false, code: "outside_hours" };
  }
  if (
    !isWalkIn &&
    venue.leadTimeMinutes > 0 &&
    startsAt.getTime() - Date.now() < venue.leadTimeMinutes * 60000
  ) {
    return { ok: false, code: "lead_time_violation" };
  }
  const autoAssign = !input.tableIds || input.tableIds.length === 0;
  const zone = input.zone ?? "";
  if (
    !autoAssign &&
    input.partySize > (await totalSeats(db, venueId, input.tableIds as string[]))
  ) {
    return { ok: false, code: "party_size_too_large" };
  }
  if (!autoAssign && zone !== "") {
    const inZone = await db
      .select({ id: tables.id })
      .from(tables)
      .where(
        and(
          eq(tables.venueId, venueId),
          inArray(tables.id, input.tableIds as string[]),
          eq(tables.zone, zone),
        ),
      );
    if (inZone.length !== (input.tableIds as string[]).length) {
      return { ok: false, code: "invalid_request" };
    }
  }
  const id = crypto.randomUUID();
  try {
    const result = await db.transaction(async (tx) => {
      const existing = (
        await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key))).limit(1)
      )[0];
      if (existing) {
        if (existing.kind !== "create") throw new ReservationError("invalid_request");
        return { id: existing.reservationId, version: existing.version };
      }
      let tableIds = input.tableIds ?? [];
      if (autoAssign) {
        tableIds = await autoAssignTables(
          tx,
          venueId,
          startsAt,
          endsAt,
          input.partySize,
          zone,
        );
      }
      await tx.insert(reservations).values({
        id,
        venueId,
        date: input.date,
        service: service.name,
        zone,
        startsAt,
        endsAt,
        partySize: input.partySize,
        status: input.initialStatus ?? "booked",
        version: 1,
        bookedVia: input.bookedVia ?? "",
        basis: input.basis ?? "",
        ownerPrincipal: input.ownerPrincipal ?? "",
        guestName: input.guestName ?? "",
        guestContact: input.guestContact ?? "",
      });
      for (const tableId of tableIds) {
        await tx.insert(tableAllocations).values({
          reservationId: id,
          venueId,
          tableId,
          startsAt,
          endsAt,
        });
      }
      await tx.insert(idempotencyKeys).values({
        key,
        venueId,
        reservationId: id,
        kind: "create",
        version: 1,
      });
      await tx.insert(events).values({
        venueId,
        type: "created",
        reservationId: id,
        version: 1,
      });
      return { id, version: 1 };
    });
    return { ok: true, id: result.id, version: result.version };
  } catch (error) {
    if (isExclusionViolation(error)) return { ok: false, code: "slot_taken" };
    if (error instanceof ReservationError) return { ok: false, code: error.code };
    throw error;
  }
}

export async function walkIn(
  db: Db,
  venueId: string,
  input: WalkInInput,
  key: string,
): Promise<WriteResult> {
  const venue = await venueOf(db, venueId);
  if (!venue) return { ok: false, code: "venue_not_found" };
  const now = nowInTimezone(venue.timezone);
  return createReservation(
    db,
    venueId,
    {
      date: input.date ?? now.date,
      time: input.time ?? now.time,
      durationMinutes: 120,
      partySize: input.partySize,
      tableIds: input.tableIds,
      zone: input.zone,
      initialStatus: "seated",
      guestName: input.guestName,
      guestContact: input.guestContact,
      bookedVia: input.bookedVia,
      basis: input.basis,
      ownerPrincipal: input.ownerPrincipal,
    },
    key,
  );
}

export async function modifyReservation(
  db: Db,
  venueId: string,
  id: string,
  input: ModifyReservationInput,
  key: string,
): Promise<WriteResult> {
  try {
    const version = await db.transaction(async (tx) => {
      const existing = (
        await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key))).limit(1)
      )[0];
      if (existing) {
        if (existing.kind !== "modify" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return existing.version;
      }
      const current = (
        await tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.venueId, venueId))).limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      if (!ACTIVE_STATUSES.includes(current.status)) {
        throw new ReservationError("invalid_transition");
      }

      const partyChanged =
        input.partySize !== undefined && input.partySize !== current.partySize;
      let tablesChanged = false;
      if (input.tableIds !== undefined) {
        const currentTables = await tx
          .select({ tableId: tableAllocations.tableId })
          .from(tableAllocations)
          .where(eq(tableAllocations.reservationId, id));
        const currentIds = currentTables.map((t) => t.tableId).sort();
        const nextIds = [...input.tableIds].sort();
        tablesChanged =
          currentIds.length !== nextIds.length ||
          currentIds.some((v, i) => v !== nextIds[i]);
      }

      if (!partyChanged && !tablesChanged) {
        return current.version;
      }

      const nextVersion = current.version + 1;
      if (partyChanged) {
        await tx
          .update(reservations)
          .set({ partySize: input.partySize!, version: nextVersion })
          .where(eq(reservations.id, id));
      } else {
        await tx
          .update(reservations)
          .set({ version: nextVersion })
          .where(eq(reservations.id, id));
      }
      if (tablesChanged) {
        await tx.delete(tableAllocations).where(eq(tableAllocations.reservationId, id));
        for (const tableId of input.tableIds!) {
          await tx.insert(tableAllocations).values({
            reservationId: id, venueId, tableId,
            startsAt: current.startsAt, endsAt: current.endsAt,
          });
        }
      }
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "modify", version: nextVersion });
      await tx.insert(events).values({ venueId, type: "modified", reservationId: id, version: nextVersion });
      return nextVersion;
    });
    return { ok: true, id, version };
  } catch (error) {
    if (isExclusionViolation(error)) return { ok: false, code: "slot_taken" };
    if (error instanceof ReservationError) return { ok: false, code: error.code };
    throw error;
  }
}

export async function cancelReservation(
  db: Db,
  venueId: string,
  id: string,
  key: string,
): Promise<CancelResult> {
  const hash = await sha256Hex(id);
  try {
    await db.transaction(async (tx) => {
      const existing = (
        await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key))).limit(1)
      )[0];
      if (existing) {
        if (existing.kind !== "cancel" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return;
      }
      const current = (
        await tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.venueId, venueId))).limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      if (current.status === "cancelled") throw new ReservationError("already_cancelled");
      const nextVersion = current.version + 1;
      await tx.update(reservations).set({ status: "cancelled", version: nextVersion }).where(eq(reservations.id, id));
      await tx.delete(tableAllocations).where(eq(tableAllocations.reservationId, id));
      await tx.insert(tombstones).values({ reservationId: id, venueId, hash });
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "cancel", version: nextVersion });
      await tx.insert(events).values({ venueId, type: "cancelled", reservationId: id, version: nextVersion });
    });
    return { ok: true, hash };
  } catch (error) {
    if (error instanceof ReservationError) {
      return {
        ok: false,
        code: error.code as "reservation_not_found" | "already_cancelled" | "invalid_request",
      };
    }
    throw error;
  }
}

export async function setStatus(
  db: Db,
  venueId: string,
  id: string,
  status: StatusTransition,
  key: string,
): Promise<WriteResult> {
  try {
    const version = await db.transaction(async (tx) => {
      const existing = (
        await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key))).limit(1)
      )[0];
      if (existing) {
        if (existing.kind !== "status" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return existing.version;
      }
      const current = (
        await tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.venueId, venueId))).limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      const allowed = ALLOWED_TRANSITIONS[status];
      if (!allowed || !allowed.includes(current.status)) {
        throw new ReservationError("invalid_transition");
      }
      const nextVersion = current.version + 1;
      await tx.update(reservations).set({ status, version: nextVersion }).where(eq(reservations.id, id));
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "status", version: nextVersion });
      await tx.insert(events).values({ venueId, type: status, reservationId: id, version: nextVersion });
      return nextVersion;
    });
    return { ok: true, id, version };
  } catch (error) {
    if (error instanceof ReservationError) return { ok: false, code: error.code };
    throw error;
  }
}

export async function getReservation(db: Db, venueId: string, id: string): Promise<Reservation | null> {
  const venue = await venueOf(db, venueId);
  if (!venue) return null;
  const row = (
    await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.venueId, venueId))).limit(1)
  )[0];
  if (!row) return null;
  return toReservation(row, venue.timezone);
}

export async function listByDate(db: Db, venueId: string, date: string): Promise<Reservation[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const rows = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), eq(reservations.date, date)))
    .orderBy(reservations.startsAt);
  return rows.map((r) => toReservation(r, venue.timezone));
}

export async function listByPrincipal(
  db: Db,
  venueId: string,
  principal: string,
): Promise<Reservation[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(eq(reservations.venueId, venueId), eq(reservations.ownerPrincipal, principal)),
    )
    .orderBy(reservations.startsAt);
  return rows.map((r) => toReservation(r, venue.timezone));
}

export async function searchReservations(
  db: Db,
  venueId: string,
  dateStart: string,
  dateEnd: string,
  statuses?: string[],
): Promise<Reservation[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const conditions = [
    eq(reservations.venueId, venueId),
    gte(reservations.date, dateStart),
    lt(reservations.date, dateEnd),
  ];
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(reservations.status, statuses));
  }
  const rows = await db.select().from(reservations).where(and(...conditions)).orderBy(reservations.startsAt);
  return rows.map((r) => toReservation(r, venue.timezone));
}

export async function getEvents(db: Db, venueId: string, afterId: number, limit: number) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.venueId, venueId), gt(events.id, afterId)))
    .orderBy(events.id)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    reservationId: r.reservationId,
    version: r.version,
    tombstoneHash: r.tombstoneHash ?? undefined,
    occurredAt: r.occurredAt.toISOString(),
  }));
}

export async function getEventsWatermark(db: Db, venueId: string): Promise<number> {
  const venue = await venueOf(db, venueId);
  return venue?.eventsWatermark ?? 0;
}

export async function pruneEvents(db: Db, venueId: string, cutoff: Date): Promise<void> {
  const pruned = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.venueId, venueId), lt(events.occurredAt, cutoff)));
  if (pruned.length === 0) return;
  const maxId = Math.max(...pruned.map((e) => e.id));
  await db
    .delete(events)
    .where(and(eq(events.venueId, venueId), lt(events.occurredAt, cutoff)));
  await db
    .update(venues)
    .set({ eventsWatermark: maxId })
    .where(eq(venues.id, venueId));
}

export async function runRetention(db: Db, now = new Date()): Promise<void> {
  const all = await db.select().from(venues);
  for (const venue of all) {
    const cutoff = new Date(now.getTime() - venue.retentionDays * 86400000);
    await pruneEvents(db, venue.id, cutoff);
  }
}

export async function getAvailability(db: Db, venueId: string, date: string, partySize: number): Promise<Record<string, AvailabilitySlot[]>> {
  const venue = await venueOf(db, venueId);
  if (!venue) return {};
  const rows = await db.select().from(services).where(eq(services.venueId, venueId));
  const result: Record<string, AvailabilitySlot[]> = {};
  for (const service of rows) {
    const close = toTimestamp(date, service.openEnd, venue.timezone);
    const slots: AvailabilitySlot[] = [];
    for (const time of generateSlots(service.openStart, service.openEnd, venue.slotIntervalMinutes)) {
      const start = toTimestamp(date, time, venue.timezone);
      const end = new Date(start.getTime() + DEFAULT_DURATION_SECONDS * 1000);
      if (end > close) continue;
      slots.push({
        time,
        available: await hasFreeTable(db, venueId, start, end, partySize),
        type: "free",
      });
    }
    result[service.name] = slots;
  }
  return result;
}

async function hasFreeTable(db: Db, venueId: string, start: Date, end: Date, partySize: number): Promise<boolean> {
  const fitting = await db
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.venueId, venueId), gte(tables.seats, partySize)));
  for (const t of fitting) {
    const busy = await db
      .select()
      .from(tableAllocations)
      .innerJoin(reservations, eq(tableAllocations.reservationId, reservations.id))
      .where(
        and(
          eq(tableAllocations.venueId, venueId),
          eq(tableAllocations.tableId, t.id),
          inArray(reservations.status, ACTIVE_STATUSES),
          lt(tableAllocations.startsAt, end),
          gt(tableAllocations.endsAt, start),
        ),
      )
      .limit(1);
    if (busy.length === 0) return true;
  }
  return false;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
