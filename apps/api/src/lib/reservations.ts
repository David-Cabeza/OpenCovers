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
import { consentColumns, type Consent } from "./consent";
import { normalizeContact, venueCountry } from "./contact";
import { linkGuest } from "./guests";
import { ratingColumns, type Rating } from "./rating";
import {
  addDays,
  formatTime,
  localDateTime,
  normalizeMinute,
  nowInTimezone,
  serviceWindow,
  toMinutes,
  toTime,
  toTimestamp,
} from "./time";

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
  consent?: Consent;
  rating?: Rating | null;
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
  consent?: Consent;
  rating?: Rating | null;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
}

export interface ModifyReservationInput {
  partySize?: number;
  tableIds?: string[];
  consent?: Consent;
  rating?: Rating | null;
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
  guestId: string | null;
  consent: Consent;
  consentRecordedAt: string | null;
  rating: Rating | null;
  ratingRecordedAt: string | null;
  tableIds: string[];
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

export type Reason =
  | {
      code: "outside_hours";
      message: string;
      details: { rule: "hours"; services: { name: string; openStart: string; openEnd: string }[] };
    }
  | {
      code: "outside_hours";
      message: string;
      details: {
        rule: "slot_grid";
        service: string;
        openStart: string;
        openEnd: string;
        slotIntervalMinutes: number;
        previous: string;
        next: string | null;
      };
    }
  | {
      code: "outside_hours";
      message: string;
      details: {
        rule: "last_seating";
        service: string;
        openEnd: string;
        lastSeatingOffsetMinutes: number;
        lastSeating: string;
      };
    }
  | {
      code: "lead_time_violation";
      message: string;
      details: { leadTimeMinutes: number; earliest: { date: string; time: string } };
    }
  | {
      code: "party_size_too_large";
      message: string;
      details: { partySize: number; largestParty: number; zone?: string };
    }
  | {
      code: "no_suitable_table";
      message: string;
      details: {
        partySize: number;
        tablesFree: number;
        tablesTotal: number;
        seatsFree: number;
        largestFreeTable: number;
        zone?: string;
      };
    };

export interface Explanation {
  date: string;
  time: string;
  partySize: number;
  zone?: string;
  available: boolean;
  reasons: Reason[];
  nearest: string[];
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
const MODIFIABLE_STATUSES = [...ACTIVE_STATUSES, "attended"];
const ALLOWED_TRANSITIONS: Record<StatusTransition, string[]> = {
  seated: ["booked"],
  attended: ["seated"],
  no_show: ["booked"],
};
export const DEFAULT_DURATION_MINUTES = 120;

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

type VenueRow = typeof venues.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

interface SlotRequest {
  date: string;
  time: string;
  partySize: number;
  zone: string;
  walkIn: boolean;
  durationMinutes: number;
}

function bookingWindow(venue: VenueRow, date: string, time: string, durationMinutes: number) {
  const startsAt = toTimestamp(date, time, venue.timezone);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60000) };
}

function serviceAt(serviceRows: ServiceRow[], time: string): ServiceRow | null {
  const minute = toMinutes(time);
  for (const service of serviceRows) {
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const m = normalizeMinute(minute, start);
    if (m >= start && m < end) return service;
  }
  return null;
}

function timeReasons(
  venue: VenueRow,
  serviceRows: ServiceRow[],
  request: SlotRequest,
  startsAt: Date,
  now: number,
): { service: ServiceRow | null; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const service = serviceAt(serviceRows, request.time);
  if (!service) {
    reasons.push({
      code: "outside_hours",
      message: "The time is outside every service.",
      details: {
        rule: "hours",
        services: [...serviceRows]
          .sort((a, b) => a.openStart.localeCompare(b.openStart))
          .map((s) => ({ name: s.name, openStart: s.openStart, openEnd: s.openEnd })),
      },
    });
  } else {
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const minute = normalizeMinute(toMinutes(request.time), start);
    const interval = venue.slotIntervalMinutes;
    const lastSeating = end - venue.lastSeatingOffsetMinutes;
    if (!request.walkIn && (minute - start) % interval !== 0) {
      const previous = minute - ((minute - start) % interval);
      const next = previous + interval;
      reasons.push({
        code: "outside_hours",
        message: "The time is not on the slot grid.",
        details: {
          rule: "slot_grid",
          service: service.name,
          openStart: service.openStart,
          openEnd: service.openEnd,
          slotIntervalMinutes: interval,
          previous: toTime(previous % (24 * 60)),
          next: next < end && next <= lastSeating ? toTime(next % (24 * 60)) : null,
        },
      });
    }
    if (minute > lastSeating) {
      reasons.push({
        code: "outside_hours",
        message: "The time is after the last seating.",
        details: {
          rule: "last_seating",
          service: service.name,
          openEnd: service.openEnd,
          lastSeatingOffsetMinutes: venue.lastSeatingOffsetMinutes,
          lastSeating: toTime(lastSeating % (24 * 60)),
        },
      });
    }
  }
  const leadMs = venue.leadTimeMinutes * 60000;
  if (!request.walkIn && venue.leadTimeMinutes > 0 && startsAt.getTime() - now < leadMs) {
    const earliest = new Date(Math.ceil((now + leadMs) / 60000) * 60000);
    reasons.push({
      code: "lead_time_violation",
      message: "The time is within the lead time.",
      details: {
        leadTimeMinutes: venue.leadTimeMinutes,
        earliest: localDateTime(earliest, venue.timezone),
      },
    });
  }
  return { service, reasons };
}

async function tableReasons(
  exec: Db | DbTx,
  venueId: string,
  startsAt: Date,
  endsAt: Date,
  partySize: number,
  zone: string,
): Promise<{ ok: true; tableIds: string[] } | { ok: false; reason: Reason }> {
  const allTables = await exec
    .select({ id: tables.id, seats: tables.seats })
    .from(tables)
    .where(zone ? and(eq(tables.venueId, venueId), eq(tables.zone, zone)) : eq(tables.venueId, venueId));
  const zoneDetail = zone ? { zone } : {};
  const totalCapacity = allTables.reduce((sum, t) => sum + t.seats, 0);
  if (partySize > totalCapacity) {
    return {
      ok: false,
      reason: {
        code: "party_size_too_large",
        message: "The party is larger than the bookable capacity.",
        details: { partySize, largestParty: totalCapacity, ...zoneDetail },
      },
    };
  }
  const busy = await exec
    .selectDistinct({ tableId: tableAllocations.tableId })
    .from(tableAllocations)
    .where(
      and(
        eq(tableAllocations.venueId, venueId),
        eq(tableAllocations.active, true),
        lt(tableAllocations.startsAt, endsAt),
        gt(tableAllocations.endsAt, startsAt),
      ),
    );
  const busyIds = new Set(busy.map((b) => b.tableId));
  const free = allTables.filter((t) => !busyIds.has(t.id));
  const picked = pickCombination(free, partySize);
  if (picked !== null) return { ok: true, tableIds: picked };
  return {
    ok: false,
    reason: {
      code: "no_suitable_table",
      message: "No free table combination fits the party.",
      details: {
        partySize,
        tablesFree: free.length,
        tablesTotal: allTables.length,
        seatsFree: free.reduce((sum, t) => sum + t.seats, 0),
        largestFreeTable: free.reduce((max, t) => Math.max(max, t.seats), 0),
        ...zoneDetail,
      },
    },
  };
}

async function evaluateSlot(
  db: Db,
  venue: VenueRow,
  serviceRows: ServiceRow[],
  request: SlotRequest,
): Promise<Reason[]> {
  const { startsAt, endsAt } = bookingWindow(venue, request.date, request.time, request.durationMinutes);
  const { reasons } = timeReasons(venue, serviceRows, request, startsAt, Date.now());
  const fit = await tableReasons(db, venue.id, startsAt, endsAt, request.partySize, request.zone);
  return fit.ok ? reasons : [...reasons, fit.reason];
}

async function totalSeats(db: Db, venueId: string, tableIds: string[]) {
  if (tableIds.length === 0) return 0;
  const rows = await db
    .select({ seats: tables.seats })
    .from(tables)
    .where(and(eq(tables.venueId, venueId), inArray(tables.id, tableIds)));
  return rows.reduce((sum, r) => sum + r.seats, 0);
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

function toReservation(
  row: typeof reservations.$inferSelect,
  timezone: string,
  tableIds: string[],
): Reservation {
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
    guestId: row.guestId,
    consent: row.consent,
    consentRecordedAt: row.consentRecordedAt ? row.consentRecordedAt.toISOString() : null,
    rating: row.rating,
    ratingRecordedAt: row.ratingRecordedAt ? row.ratingRecordedAt.toISOString() : null,
    tableIds,
  };
}

async function withTables(
  db: Db,
  rows: (typeof reservations.$inferSelect)[],
  timezone: string,
): Promise<Reservation[]> {
  if (rows.length === 0) return [];
  const allocations = await db
    .select({ reservationId: tableAllocations.reservationId, tableId: tableAllocations.tableId })
    .from(tableAllocations)
    .where(inArray(tableAllocations.reservationId, rows.map((r) => r.id)));
  const byReservation = new Map<string, string[]>();
  for (const a of allocations) {
    const held = byReservation.get(a.reservationId) ?? [];
    held.push(a.tableId);
    byReservation.set(a.reservationId, held);
  }
  return rows.map((r) => toReservation(r, timezone, (byReservation.get(r.id) ?? []).sort()));
}

export async function createReservation(
  db: Db,
  venueId: string,
  input: CreateReservationInput,
  key: string,
): Promise<WriteResult> {
  const venue = await venueOf(db, venueId);
  if (!venue) return { ok: false, code: "venue_not_found" };
  const serviceRows = await db.select().from(services).where(eq(services.venueId, venueId));
  const zone = input.zone ?? "";
  const request: SlotRequest = {
    date: input.date,
    time: input.time,
    partySize: input.partySize,
    zone,
    walkIn: input.initialStatus === "seated",
    durationMinutes: input.durationMinutes,
  };
  const { startsAt, endsAt } = bookingWindow(venue, input.date, input.time, input.durationMinutes);
  const { service, reasons } = timeReasons(venue, serviceRows, request, startsAt, Date.now());
  if (reasons.length > 0) return { ok: false, code: reasons[0].code };
  if (!service) return { ok: false, code: "outside_hours" };
  const autoAssign = !input.tableIds || input.tableIds.length === 0;
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
  const contactKey = input.guestContact != null ? normalizeContact(String(input.guestContact), venueCountry(venue)) : null;
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
        const fit = await tableReasons(tx, venueId, startsAt, endsAt, input.partySize, zone);
        if (!fit.ok) throw new ReservationError(fit.reason.code);
        tableIds = fit.tableIds;
      }
      const guest = contactKey
        ? await linkGuest(tx, venueId, contactKey, input.guestName ?? "", startsAt, input.ownerPrincipal ?? "")
        : null;
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
        guestId: guest?.id ?? null,
        ...consentColumns(input.consent ?? "unknown"),
        ...ratingColumns(input.rating ?? null),
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
      durationMinutes: DEFAULT_DURATION_MINUTES,
      partySize: input.partySize,
      tableIds: input.tableIds,
      zone: input.zone,
      initialStatus: "seated",
      guestName: input.guestName,
      guestContact: input.guestContact,
      consent: input.consent,
      rating: input.rating,
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
      if (!MODIFIABLE_STATUSES.includes(current.status)) {
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

      if (
        (partyChanged || tablesChanged) &&
        !ACTIVE_STATUSES.includes(current.status)
      ) {
        throw new ReservationError("invalid_transition");
      }

      const consentChanged =
        input.consent !== undefined && input.consent !== current.consent;
      const ratingChanged =
        input.rating !== undefined && input.rating !== current.rating;
      if ((consentChanged || ratingChanged) && current.erased) {
        throw new ReservationError("invalid_request");
      }

      if (!partyChanged && !tablesChanged && !consentChanged && !ratingChanged) {
        return current.version;
      }

      const nextVersion = current.version + 1;
      await tx
        .update(reservations)
        .set({
          version: nextVersion,
          ...(partyChanged ? { partySize: input.partySize! } : {}),
          ...(consentChanged ? consentColumns(input.consent!) : {}),
          ...(ratingChanged ? ratingColumns(input.rating!) : {}),
        })
        .where(eq(reservations.id, id));
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
      if (!ACTIVE_STATUSES.includes(status)) {
        await tx.update(tableAllocations).set({ active: false }).where(eq(tableAllocations.reservationId, id));
      }
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
  return (await withTables(db, [row], venue.timezone))[0];
}

export async function listByDate(db: Db, venueId: string, date: string): Promise<Reservation[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const rows = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), eq(reservations.date, date)))
    .orderBy(reservations.startsAt);
  return withTables(db, rows, venue.timezone);
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
  return withTables(db, rows, venue.timezone);
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
  return withTables(db, rows, venue.timezone);
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

export interface FloorTable {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
  posX: number;
  posY: number;
  rotation: number;
  occupied: boolean;
  reservationId?: string;
  partySize?: number;
  guestName?: string;
}

export async function getFloorPlan(
  db: Db,
  venueId: string,
  date?: string,
  time?: string,
): Promise<FloorTable[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const now = nowInTimezone(venue.timezone);
  const point = toTimestamp(date ?? now.date, time ?? now.time, venue.timezone);
  const allTables = await db
    .select()
    .from(tables)
    .where(eq(tables.venueId, venueId))
    .orderBy(tables.name);
  const result: FloorTable[] = [];
  for (const t of allTables) {
    const alloc = (
      await db
        .select({
          reservationId: tableAllocations.reservationId,
          partySize: reservations.partySize,
          guestName: reservations.guestName,
        })
        .from(tableAllocations)
        .innerJoin(reservations, eq(tableAllocations.reservationId, reservations.id))
        .where(
          and(
            eq(tableAllocations.venueId, venueId),
            eq(tableAllocations.tableId, t.id),
            eq(tableAllocations.active, true),
            lt(tableAllocations.startsAt, point),
            gt(tableAllocations.endsAt, point),
          ),
        )
        .limit(1)
    )[0];
    result.push({
      id: t.id,
      name: t.name,
      seats: t.seats,
      zone: t.zone,
      shape: t.shape,
      posX: t.posX,
      posY: t.posY,
      rotation: t.rotation,
      occupied: alloc !== undefined,
      reservationId: alloc?.reservationId,
      partySize: alloc?.partySize,
      guestName: alloc?.guestName,
    });
  }
  return result;
}

export interface PacingSlot {
  time: string;
  capacity: number;
  covers: number;
}

export interface PacingService {
  service: string;
  slots: PacingSlot[];
}

export async function getPacing(
  db: Db,
  venueId: string,
  date: string,
): Promise<PacingService[]> {
  const venue = await venueOf(db, venueId);
  if (!venue) return [];
  const servicesRows = await db
    .select()
    .from(services)
    .where(eq(services.venueId, venueId));
  const tablesRows = await db
    .select()
    .from(tables)
    .where(eq(tables.venueId, venueId));
  const capacity = tablesRows.reduce((sum, t) => sum + t.seats, 0);
  const activeReservations = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, venueId),
        eq(reservations.date, date),
        inArray(reservations.status, ACTIVE_STATUSES),
      ),
    );
  const result: PacingService[] = [];
  for (const service of servicesRows) {
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const slots: PacingSlot[] = [];
    for (let m = start; m < end; m += venue.slotIntervalMinutes) {
      const point = slotTimestamp(date, m, venue.timezone);
      const covers = activeReservations
        .filter((r) => r.startsAt <= point && r.endsAt > point)
        .reduce((sum, r) => sum + r.partySize, 0);
      slots.push({ time: toTime(m % (24 * 60)), capacity, covers });
    }
    result.push({ service: service.name, slots });
  }
  return result;
}

interface GridSlot {
  date: string;
  time: string;
  available: boolean;
}

async function gridAvailability(
  db: Db,
  venue: VenueRow,
  serviceRows: ServiceRow[],
  date: string,
  partySize: number,
  zone: string,
): Promise<Record<string, GridSlot[]>> {
  const result: Record<string, GridSlot[]> = {};
  for (const service of serviceRows) {
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const slots: GridSlot[] = [];
    for (let m = start; m < end; m += venue.slotIntervalMinutes) {
      const request: SlotRequest = {
        date: addDays(date, Math.floor(m / (24 * 60))),
        time: toTime(m % (24 * 60)),
        partySize,
        zone,
        walkIn: false,
        durationMinutes: DEFAULT_DURATION_MINUTES,
      };
      const reasons = await evaluateSlot(db, venue, serviceRows, request);
      if (reasons.some((r) => r.code === "outside_hours")) continue;
      slots.push({ date: request.date, time: request.time, available: reasons.length === 0 });
    }
    result[service.name] = slots;
  }
  return result;
}

export async function getAvailability(db: Db, venueId: string, date: string, partySize: number): Promise<Record<string, AvailabilitySlot[]>> {
  const venue = await venueOf(db, venueId);
  if (!venue) return {};
  const serviceRows = await db.select().from(services).where(eq(services.venueId, venueId));
  const grid = await gridAvailability(db, venue, serviceRows, date, partySize, "");
  const result: Record<string, AvailabilitySlot[]> = {};
  for (const [name, slots] of Object.entries(grid)) {
    result[name] = slots.map((s) => ({ time: s.time, available: s.available, type: "free" }));
  }
  return result;
}

export async function explainSlot(
  db: Db,
  venueId: string,
  query: { date: string; time: string; partySize: number; zone?: string },
): Promise<Explanation | null> {
  const venue = await venueOf(db, venueId);
  if (!venue) return null;
  const serviceRows = await db.select().from(services).where(eq(services.venueId, venueId));
  const zone = query.zone ?? "";
  const reasons = await evaluateSlot(db, venue, serviceRows, {
    date: query.date,
    time: query.time,
    partySize: query.partySize,
    zone,
    walkIn: false,
    durationMinutes: DEFAULT_DURATION_MINUTES,
  });
  const nearest: string[] = [];
  if (reasons.length > 0) {
    const grid = await gridAvailability(db, venue, serviceRows, query.date, query.partySize, zone);
    const asked = toMinutes(query.time);
    const times = new Set(
      Object.values(grid)
        .flat()
        .filter((s) => s.available && s.date === query.date)
        .map((s) => s.time),
    );
    const byDistance = [...times].sort(
      (a, b) => Math.abs(toMinutes(a) - asked) - Math.abs(toMinutes(b) - asked) || a.localeCompare(b),
    );
    nearest.push(...byDistance.slice(0, 3));
  }
  return {
    date: query.date,
    time: query.time,
    partySize: query.partySize,
    ...(zone ? { zone } : {}),
    available: reasons.length === 0,
    reasons,
    nearest,
  };
}

function slotTimestamp(date: string, minutes: number, timezone: string): Date {
  const day = Math.floor(minutes / (24 * 60));
  const minuteOfDay = minutes % (24 * 60);
  const ts = toTimestamp(date, toTime(minuteOfDay), timezone);
  return new Date(ts.getTime() + day * 86400000);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
