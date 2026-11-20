import { and, count, eq, gt, gte, inArray, lt, ne, notExists, sql } from "drizzle-orm";
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
import { countBlocklistEntries } from "./blocklist";
import { blockedRange } from "./booking-policy";
import { normalizeCommentary } from "./commentary";
import { consentColumns, type Consent } from "./consent";
import { normalizeContact, venueCountry } from "./contact";
import { linkGuest } from "./guests";
import { sandboxGuestsFull, sandboxReservationsFull } from "../demo/limits";
import { demoMode } from "../demo/settings";
import { claimKey } from "./idempotency";
import { originColumns, type Origin } from "./origin";
import { ratingColumns, type Rating } from "./rating";
import { reconfirmationColumns, type Reconfirmation } from "./reconfirmation";
import { linkWorks, mintLink, revokeForCancel, rotateLink } from "./self-service";
import {
  addDays,
  formatTime,
  isCalendarDate,
  isoWeekday,
  localDateTime,
  normalizeMinute,
  nowInTimezone,
  serviceWindow,
  toMinutes,
  toTime,
  toTimestamp,
} from "./time";
import { turnMinutes } from "./turn-times";

export type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CreateReservationInput {
  date: string;
  time: string;
  durationMinutes?: number;
  partySize: number;
  tableIds?: string[];
  zone?: string;
  initialStatus?: "booked" | "seated";
  guestName?: string;
  guestContact?: string;
  consent?: Consent;
  rating?: Rating | null;
  commentary?: string;
  reconfirmation?: Reconfirmation;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
  channel?: Channel;
  origin?: Origin | null;
}

/** The online limits of ADR-0017 that tighten a venue's own rules for the public channel. */
export interface OnlineRules {
  services: string[] | null;
  weekdays: number[] | null;
  minPartySize: number;
  maxPartySize: number;
  leadTimeMinutes: number;
  maxAdvanceDays: number | null;
  maxOpenBookingsPerContact: number | null;
}

/** A venue as a channel sees it. `refusePast` is set for the public channel: it never takes a start earlier than now. */
export type ChannelVenue = VenueRow & { refusePast?: boolean };

export type Channel = { kind: "staff" } | { kind: "public"; rules: OnlineRules };

const STAFF: Channel = { kind: "staff" };

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
  commentary?: string;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
  origin?: Origin | null;
}

export interface ModifyReservationInput {
  partySize?: number;
  tableIds?: string[];
  consent?: Consent;
  rating?: Rating | null;
  commentary?: string;
  reconfirmation?: Reconfirmation;
  selfService?: SelfServiceWrite & { version: number; rules: OnlineRules };
  origin?: Origin | null;
}

/** A guest write through a self-service link (ADR-0017). The checks run inside the write transaction. */
export interface SelfServiceWrite {
  linkId: string;
  cutoffMinutes: number;
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
  commentary: string;
  reconfirmation: Reconfirmation;
  reconfirmationRecordedAt: string | null;
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
        rule: "weekday";
        date: string;
        weekday: number;
        services: { name: string; openStart: string; openEnd: string; days: number[] }[];
      };
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
      code: "beyond_booking_horizon";
      message: string;
      details: { maxAdvanceDays: number; latest: string };
    }
  | {
      code: "date_blocked";
      message: string;
      details: { from: string; to: string };
    }
  | {
      code: "party_size_too_small";
      message: string;
      details: { rule: "service_limit"; service: string; partySize: number; minPartySize: number };
    }
  | {
      code: "party_size_too_large";
      message: string;
      details: { rule: "service_limit"; service: string; partySize: number; maxPartySize: number };
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
  | "party_size_too_small"
  | "no_suitable_table"
  | "table_required"
  | "outside_hours"
  | "lead_time_violation"
  | "beyond_booking_horizon"
  | "date_blocked"
  | "guest_booking_limit"
  | "online_booking_limit"
  | "booking_declined"
  | "venue_not_found"
  | "self_service_link_invalid"
  | "self_service_closed"
  | "reservation_changed";

/** `selfServiceToken` is set only by a public create: the new link, or null on a repeat for a booking no longer `booked`. */
export type WriteResult =
  | { ok: true; id: string; version: number; selfServiceToken?: string | null }
  | { ok: false; code: WriteErrorCode };

export type CancelResult =
  | { ok: true; hash: string }
  | {
      ok: false;
      code:
        | "reservation_not_found"
        | "already_cancelled"
        | "invalid_request"
        | "venue_not_found"
        | "self_service_link_invalid"
        | "self_service_closed";
    };

const ACTIVE_STATUSES = ["booked", "seated"];
const MODIFIABLE_STATUSES = [...ACTIVE_STATUSES, "attended"];
const ALLOWED_TRANSITIONS: Record<StatusTransition, string[]> = {
  seated: ["booked"],
  attended: ["seated"],
  no_show: ["booked"],
};

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

/**
 * Serializes table planning per venue until the transaction ends, so a planner reads the allocations the previous
 * plan inserted. Without it concurrent auto-assigns choose the same free tables and the loser gets slot_taken while
 * others are free. Every path that takes it does so before the overbooking lock, never after.
 */
async function lockPlanner(tx: DbTx, venueId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`planner:${venueId}`}, 0))`);
}

// A write that names its tables can still take a planned table between plan and insert. The database refuses it
// (23P01), so a planned write replans a bounded number of times before it reports the conflict.
const PLAN_ATTEMPTS = 3;

async function replanOnConflict<T>(planned: boolean, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!planned || attempt >= PLAN_ATTEMPTS || !isExclusionViolation(error)) throw error;
    }
  }
}

async function venueOf(db: Db, venueId: string) {
  return (
    await db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
  )[0];
}

type VenueRow = typeof venues.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

const stricterHorizon = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/** The public horizon when neither the venue nor its online settings set one (ADR-0017, amendment of 2026-11-17). */
export const PUBLIC_DEFAULT_MAX_ADVANCE_DAYS = 365;

/**
 * The venue and services as the channel sees them. The public channel narrows
 * them with the online limits and turns the overbooking ceiling off, so every
 * reason function below applies the online rules without knowing about them.
 */
export function applyChannel(
  venue: VenueRow,
  serviceRows: ServiceRow[],
  channel: Channel,
): { venue: ChannelVenue; serviceRows: ServiceRow[] } {
  if (channel.kind === "staff") return { venue, serviceRows };
  const { rules } = channel;
  return {
    venue: {
      ...venue,
      overbookingCeiling: 0,
      refusePast: true,
      leadTimeMinutes: Math.max(venue.leadTimeMinutes, rules.leadTimeMinutes),
      maxAdvanceDays: stricterHorizon(venue.maxAdvanceDays, rules.maxAdvanceDays) ?? PUBLIC_DEFAULT_MAX_ADVANCE_DAYS,
    },
    serviceRows: serviceRows
      .filter((s) => rules.services === null || rules.services.includes(s.name))
      .map((s) => ({
        ...s,
        days: rules.weekdays === null ? s.days : s.days.filter((d) => rules.weekdays!.includes(d)),
        minPartySize: Math.max(s.minPartySize ?? 1, rules.minPartySize),
        maxPartySize: Math.min(s.maxPartySize ?? rules.maxPartySize, rules.maxPartySize),
      })),
  };
}

interface SlotRequest {
  date: string;
  time: string;
  partySize: number;
  zone: string;
  walkIn: boolean;
  durationMinutes?: number;
}

function bookingWindow(venue: VenueRow, request: SlotRequest) {
  const minutes = request.durationMinutes ?? turnMinutes(venue.turnTimes, request.partySize);
  const startsAt = toTimestamp(request.date, request.time, venue.timezone);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60000) };
}

// The service that covers a local date and time. A service belongs to the weekday it
// opens on, so the part of an overnight service after midnight counts against the
// previous date's weekday. `ignoreDays` finds a service by time alone.
function serviceAt(
  serviceRows: ServiceRow[],
  date: string,
  time: string,
  ignoreDays = false,
): ServiceRow | null {
  const minute = toMinutes(time);
  for (const service of serviceRows) {
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const m = normalizeMinute(minute, start);
    if (m < start || m >= end) continue;
    if (ignoreDays) return service;
    const openedOn = m === minute ? date : addDays(date, -1);
    if (service.days.includes(isoWeekday(openedOn))) return service;
  }
  return null;
}

function servesDate(service: ServiceRow, date: string): boolean {
  return service.days.includes(isoWeekday(date));
}

function timeReasons(
  venue: ChannelVenue,
  serviceRows: ServiceRow[],
  request: SlotRequest,
  startsAt: Date,
  now: number,
): { service: ServiceRow | null; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const service = serviceAt(serviceRows, request.date, request.time);
  const closedDay = service ? null : serviceAt(serviceRows, request.date, request.time, true);
  if (!service && closedDay) {
    reasons.push({
      code: "outside_hours",
      message: "The venue does not serve that weekday.",
      details: {
        rule: "weekday",
        date: request.date,
        weekday: isoWeekday(request.date),
        services: [...serviceRows]
          .filter((s) => serviceAt([s], request.date, request.time, true))
          .sort((a, b) => a.openStart.localeCompare(b.openStart))
          .map((s) => ({
            name: s.name,
            openStart: s.openStart,
            openEnd: s.openEnd,
            days: [...s.days].sort((a, b) => a - b),
          })),
      },
    });
  } else if (!service) {
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
  if (!request.walkIn && (venue.leadTimeMinutes > 0 || venue.refusePast) && startsAt.getTime() - now < leadMs) {
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
  if (!request.walkIn && venue.maxAdvanceDays !== null) {
    const latest = addDays(localDateTime(new Date(now), venue.timezone).date, venue.maxAdvanceDays);
    if (request.date > latest) {
      reasons.push({
        code: "beyond_booking_horizon",
        message: "The date is further ahead than the venue takes bookings.",
        details: { maxAdvanceDays: venue.maxAdvanceDays, latest },
      });
    }
  }
  const blocked = request.walkIn ? undefined : blockedRange(venue.blockedDates, request.date);
  if (blocked) {
    reasons.push({
      code: "date_blocked",
      message: "The venue takes no bookings on that date.",
      details: { from: blocked.from, to: blocked.to },
    });
  }
  return { service, reasons };
}

function serviceReasons(service: ServiceRow | null, request: SlotRequest): Reason[] {
  if (!service || request.walkIn) return [];
  const { partySize } = request;
  if (service.minPartySize !== null && partySize < service.minPartySize) {
    return [
      {
        code: "party_size_too_small",
        message: "The party is smaller than the service minimum.",
        details: { rule: "service_limit", service: service.name, partySize, minPartySize: service.minPartySize },
      },
    ];
  }
  if (service.maxPartySize !== null && partySize > service.maxPartySize) {
    return [
      {
        code: "party_size_too_large",
        message: "The party is larger than the service maximum.",
        details: { rule: "service_limit", service: service.name, partySize, maxPartySize: service.maxPartySize },
      },
    ];
  }
  return [];
}

async function tableReasons(
  exec: Db | DbTx,
  venueId: string,
  startsAt: Date,
  endsAt: Date,
  partySize: number,
  zone: string,
  exceptId?: string,
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
        exceptId ? ne(tableAllocations.reservationId, exceptId) : undefined,
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
  venue: ChannelVenue,
  serviceRows: ServiceRow[],
  request: SlotRequest,
): Promise<Reason[]> {
  const { startsAt, endsAt } = bookingWindow(venue, request);
  const { service, reasons } = timeReasons(venue, serviceRows, request, startsAt, Date.now());
  reasons.push(...serviceReasons(service, request));
  const fit = await tableReasons(db, venue.id, startsAt, endsAt, request.partySize, request.zone);
  if (fit.ok) return reasons;
  if (
    fit.reason.code === "no_suitable_table" &&
    !request.walkIn &&
    (await hasOverbookRoom(db, venue, startsAt, endsAt, request.partySize))
  ) {
    return reasons;
  }
  return [...reasons, fit.reason];
}

async function totalSeats(db: Db, venueId: string, tableIds: string[]) {
  if (tableIds.length === 0) return 0;
  const rows = await db
    .select({ seats: tables.seats })
    .from(tables)
    .where(and(eq(tables.venueId, venueId), inArray(tables.id, tableIds)));
  return rows.reduce((sum, r) => sum + r.seats, 0);
}

async function hasOverbookRoom(
  exec: Db | DbTx,
  venue: VenueRow,
  startsAt: Date,
  endsAt: Date,
  covers: number,
  opts: { lock?: boolean; exceptId?: string } = {},
): Promise<boolean> {
  if (covers > venue.overbookingCeiling) return false;
  if (opts.lock) {
    await exec.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`overbooking:${venue.id}`}, 0))`);
  }
  const unseated = await exec
    .select({ partySize: reservations.partySize })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, venue.id),
        inArray(reservations.status, ACTIVE_STATUSES),
        lt(reservations.startsAt, endsAt),
        gt(reservations.endsAt, startsAt),
        notExists(
          exec
            .select({ one: tableAllocations.reservationId })
            .from(tableAllocations)
            .where(eq(tableAllocations.reservationId, reservations.id)),
        ),
        opts.exceptId ? ne(reservations.id, opts.exceptId) : undefined,
      ),
    );
  const used = unseated.reduce((sum, r) => sum + r.partySize, 0);
  return used + covers <= venue.overbookingCeiling;
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
    commentary: row.commentary,
    reconfirmation: row.reconfirmation,
    reconfirmationRecordedAt: row.reconfirmationRecordedAt ? row.reconfirmationRecordedAt.toISOString() : null,
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

// An erased booking answers a public replay like a malformed body: nothing of it comes back (C53).
async function isErased(tx: DbTx, venueId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ erased: reservations.erased })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.venueId, venueId)));
  return row?.erased ?? true;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createReservation(
  db: Db,
  venueId: string,
  input: CreateReservationInput,
  key: string,
): Promise<WriteResult> {
  const storedVenue = await venueOf(db, venueId);
  if (!storedVenue) return { ok: false, code: "venue_not_found" };
  if (!isCalendarDate(input.date) || !TIME.test(input.time)) return { ok: false, code: "invalid_request" };
  const channel = input.channel ?? STAFF;
  const { venue, serviceRows } = applyChannel(
    storedVenue,
    await db.select().from(services).where(eq(services.venueId, venueId)),
    channel,
  );
  const openCap = channel.kind === "public" ? channel.rules.maxOpenBookingsPerContact : null;
  const zone = input.zone ?? "";
  const request: SlotRequest = {
    date: input.date,
    time: input.time,
    partySize: input.partySize,
    zone,
    walkIn: input.initialStatus === "seated",
    durationMinutes: input.durationMinutes,
  };
  const { startsAt, endsAt } = bookingWindow(venue, request);
  const { service, reasons } = timeReasons(venue, serviceRows, request, startsAt, Date.now());
  reasons.push(...serviceReasons(service, request));
  // A refusal binds a first attempt only. The key is looked up first, so a replay of a create that succeeded
  // returns the stored answer whatever the rules or the clock say now (C2, C58).
  let refusal: WriteErrorCode | null = reasons[0]?.code ?? (service ? null : "outside_hours");
  const autoAssign = !input.tableIds || input.tableIds.length === 0;
  if (!refusal && !autoAssign) {
    if (input.partySize > (await totalSeats(db, venueId, input.tableIds as string[]))) {
      refusal = "party_size_too_large";
    } else if (zone !== "") {
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
      if (inZone.length !== (input.tableIds as string[]).length) refusal = "invalid_request";
    }
  }
  const id = crypto.randomUUID();
  const contactKey = input.guestContact != null ? normalizeContact(String(input.guestContact), venueCountry(venue)) : null;
  try {
    const result = await replanOnConflict(autoAssign, () => db.transaction(async (tx) => {
      const existing = await claimKey(tx, venueId, key);
      if (existing) {
        if (existing.kind !== "create") throw new ReservationError("invalid_request");
        if (channel.kind === "public" && (await isErased(tx, venueId, existing.reservationId))) {
          throw new ReservationError("invalid_request");
        }
        // Only a hash of the token is stored, so a public repeat cannot return the first token. It rotates.
        const link = channel.kind === "public" ? await rotateLink(tx, venueId, existing.reservationId) : undefined;
        return { id: existing.reservationId, version: existing.version, selfServiceToken: link && link.token };
      }
      if (refusal || !service) throw new ReservationError(refusal ?? "outside_hours");
      // A demo sandbox has lower caps (ADR-0022), counted here under a per-venue lock so concurrent bookings cannot
      // pass the last free place. A replayed key replayed above. Skipped, with no query, unless DEMO_MODE=1: the API
      // does not start with the flag off over a database that holds sandboxes (demo/guard.ts).
      const sandbox = demoMode();
      if (sandbox && (await sandboxReservationsFull(tx as unknown as Db, venueId))) {
        throw new ReservationError("guest_booking_limit");
      }
      const cap = request.walkIn ? null : venue.maxActivePerGuestPerDay;
      // linkGuest also row-locks the guest, but only as a side effect. This lock keeps count-then-insert serial on its own.
      if (cap !== null && contactKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`guest-day:${venueId}:${contactKey.kind}:${contactKey.value}:${input.date}`}, 0))`,
        );
      }
      if (openCap !== null && contactKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`online-open:${venueId}:${contactKey.kind}:${contactKey.value}`}, 0))`,
        );
      }
      const guest = contactKey
        ? await linkGuest(tx, venueId, contactKey, input.guestName ?? "", startsAt, input.ownerPrincipal ?? "")
        : null;
      if (sandbox && guest && (await sandboxGuestsFull(tx as unknown as Db, venueId))) {
        throw new ReservationError("guest_booking_limit");
      }
      if (cap !== null && guest) {
        const [{ held }] = await tx
          .select({ held: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.venueId, venueId),
              eq(reservations.guestId, guest.id),
              eq(reservations.date, input.date),
              inArray(reservations.status, ACTIVE_STATUSES),
            ),
          );
        if (held >= cap) throw new ReservationError("guest_booking_limit");
      }
      if (openCap !== null && guest) {
        const [{ held }] = await tx
          .select({ held: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.venueId, venueId),
              eq(reservations.guestId, guest.id),
              eq(reservations.bookedVia, "widget"),
              eq(reservations.status, "booked"),
              gt(reservations.startsAt, sql`now()`),
            ),
          );
        if (held >= openCap) throw new ReservationError("online_booking_limit");
      }
      let tableIds = input.tableIds ?? [];
      if (autoAssign) {
        await lockPlanner(tx, venueId);
        const fit = await tableReasons(tx, venueId, startsAt, endsAt, input.partySize, zone);
        if (fit.ok) {
          tableIds = fit.tableIds;
        } else if (channel.kind === "public" && fit.reason.code === "no_suitable_table") {
          throw new ReservationError("slot_taken");
        } else if (
          fit.reason.code === "no_suitable_table" &&
          !request.walkIn &&
          (await hasOverbookRoom(tx, venue, startsAt, endsAt, input.partySize, { lock: true }))
        ) {
          tableIds = [];
        } else {
          throw new ReservationError(fit.reason.code);
        }
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
        guestId: guest?.id ?? null,
        ...consentColumns(input.consent ?? "unknown"),
        ...ratingColumns(input.rating ?? null),
        commentary: normalizeCommentary(input.commentary ?? ""),
        ...reconfirmationColumns(input.reconfirmation ?? "none"),
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
      // ADR-0018: last, after the allocations, so a closed, full or taken time fails as it would for anyone.
      if (!request.walkIn && contactKey && (await countBlocklistEntries(tx, venueId, [contactKey])) > 0) {
        throw new ReservationError("booking_declined");
      }
      const link = channel.kind === "public" ? await mintLink(tx, venueId, id, endsAt) : undefined;
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
        ...originColumns(input.origin),
      });
      return { id, version: 1, selfServiceToken: link?.token };
    }));
    return { ok: true, ...result };
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
      partySize: input.partySize,
      tableIds: input.tableIds,
      zone: input.zone,
      initialStatus: "seated",
      guestName: input.guestName,
      guestContact: input.guestContact,
      consent: input.consent,
      rating: input.rating,
      commentary: input.commentary,
      bookedVia: input.bookedVia,
      basis: input.basis,
      ownerPrincipal: input.ownerPrincipal,
      origin: input.origin,
    },
    key,
  );
}

type ReservationRow = typeof reservations.$inferSelect;

async function lockForGuest(tx: DbTx, venueId: string, id: string, linkId: string, cancelKey?: string) {
  await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.venueId, venueId)))
    .for("update");
  if (!(await linkWorks(tx, linkId, cancelKey))) throw new ReservationError("self_service_link_invalid");
}

function assertChangeable(current: ReservationRow, guest: SelfServiceWrite) {
  const changeableUntil = current.startsAt.getTime() - guest.cutoffMinutes * 60_000;
  if (current.status !== "booked" || Date.now() >= changeableUntil) throw new ReservationError("self_service_closed");
}

/**
 * The tables a guest's new party size needs: undefined when the tables held still seat it, otherwise a free
 * combination at the same time. The online party limits apply and the overbooking ceiling never does.
 */
async function guestTables(tx: DbTx, venueId: string, current: ReservationRow, partySize: number, rules: OnlineRules) {
  const venue = (await tx.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  const own = await tx
    .select()
    .from(services)
    .where(and(eq(services.venueId, venueId), eq(services.name, current.service)));
  const [service] = applyChannel(venue, own, { kind: "public", rules: { ...rules, services: null, weekdays: null } }).serviceRows;
  const min = service?.minPartySize ?? rules.minPartySize;
  const max = service?.maxPartySize ?? rules.maxPartySize;
  if (partySize < min) throw new ReservationError("party_size_too_small");
  if (partySize > max) throw new ReservationError("party_size_too_large");
  const held = await tx
    .select({ seats: tables.seats })
    .from(tableAllocations)
    .innerJoin(tables, eq(tables.id, tableAllocations.tableId))
    .where(eq(tableAllocations.reservationId, current.id));
  if (held.length > 0 && held.reduce((sum, t) => sum + t.seats, 0) >= partySize) return undefined;
  await lockPlanner(tx, venueId);
  const fit = await tableReasons(tx, venueId, current.startsAt, current.endsAt, partySize, current.zone, current.id);
  if (!fit.ok) throw new ReservationError("no_suitable_table");
  return fit.tableIds;
}

export async function modifyReservation(
  db: Db,
  venueId: string,
  id: string,
  input: ModifyReservationInput,
  key: string,
): Promise<WriteResult> {
  const guest = input.selfService;
  try {
    const version = await replanOnConflict(guest !== undefined, () => db.transaction(async (tx) => {
      const existing = await claimKey(tx, venueId, key);
      if (guest) await lockForGuest(tx, venueId, id, guest.linkId);
      if (existing) {
        if (existing.kind !== "modify" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return existing.version;
      }
      const current = (
        await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.id, id), eq(reservations.venueId, venueId)))
          .for("update")
          .limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      if (guest) {
        assertChangeable(current, guest);
        if (current.version !== guest.version) throw new ReservationError("reservation_changed");
      }
      if (!MODIFIABLE_STATUSES.includes(current.status)) {
        throw new ReservationError("invalid_transition");
      }

      const partyChanged =
        input.partySize !== undefined && input.partySize !== current.partySize;
      const tableIds =
        guest && partyChanged ? await guestTables(tx, venueId, current, input.partySize!, guest.rules) : input.tableIds;
      let tablesChanged = false;
      if (tableIds !== undefined) {
        const currentTables = await tx
          .select({ tableId: tableAllocations.tableId })
          .from(tableAllocations)
          .where(eq(tableAllocations.reservationId, id));
        const currentIds = currentTables.map((t) => t.tableId).sort();
        const nextIds = [...tableIds].sort();
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

      const grows = partyChanged && input.partySize! > current.partySize;
      if (tablesChanged && current.status === "seated" && tableIds!.length === 0) {
        throw new ReservationError("table_required");
      }

      if (tablesChanged || grows) {
        const held =
          tableIds !== undefined
            ? tableIds.length
            : (
                await tx
                  .select({ tableId: tableAllocations.tableId })
                  .from(tableAllocations)
                  .where(eq(tableAllocations.reservationId, id))
              ).length;
        const venue = (await tx.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
        if (
          held === 0 &&
          !(await hasOverbookRoom(tx, venue, current.startsAt, current.endsAt, input.partySize ?? current.partySize, {
            lock: true,
            exceptId: id,
          }))
        ) {
          throw new ReservationError("no_suitable_table");
        }
      }

      const consentChanged =
        input.consent !== undefined && input.consent !== current.consent;
      const ratingChanged =
        input.rating !== undefined && input.rating !== current.rating;
      const commentary = input.commentary === undefined ? undefined : normalizeCommentary(input.commentary);
      const commentaryChanged = commentary !== undefined && commentary !== current.commentary;
      const reconfirmationChanged =
        input.reconfirmation !== undefined && input.reconfirmation !== current.reconfirmation;
      if ((consentChanged || ratingChanged || commentaryChanged || reconfirmationChanged) && current.erased) {
        throw new ReservationError("invalid_request");
      }
      if (reconfirmationChanged && current.status !== "booked") {
        throw new ReservationError("invalid_transition");
      }

      if (
        !partyChanged &&
        !tablesChanged &&
        !consentChanged &&
        !ratingChanged &&
        !commentaryChanged &&
        !reconfirmationChanged
      ) {
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
          ...(commentaryChanged ? { commentary } : {}),
          ...(reconfirmationChanged ? reconfirmationColumns(input.reconfirmation!) : {}),
        })
        .where(eq(reservations.id, id));
      if (tablesChanged) {
        await tx.delete(tableAllocations).where(eq(tableAllocations.reservationId, id));
        for (const tableId of tableIds!) {
          await tx.insert(tableAllocations).values({
            reservationId: id, venueId, tableId,
            startsAt: current.startsAt, endsAt: current.endsAt,
          });
        }
      }
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "modify", version: nextVersion });
      await tx.insert(events).values({ venueId, type: "modified", reservationId: id, version: nextVersion, ...originColumns(input.origin) });
      return nextVersion;
    }));
    return { ok: true, id, version };
  } catch (error) {
    // A guest's party never uses the ceiling, so a table taken by a concurrent write leaves no fitting table.
    if (isExclusionViolation(error)) return { ok: false, code: guest ? "no_suitable_table" : "slot_taken" };
    if (error instanceof ReservationError) return { ok: false, code: error.code };
    throw error;
  }
}

/** A guest cancel (`guest`) also revokes the link in the same transaction and mints none (ADR-0017, Q3). */
export async function cancelReservation(
  db: Db,
  venueId: string,
  id: string,
  key: string,
  origin: Origin | null,
  guest?: SelfServiceWrite,
): Promise<CancelResult> {
  const hash = await sha256Hex(id);
  try {
    await db.transaction(async (tx) => {
      const existing = await claimKey(tx, venueId, key);
      if (guest) await lockForGuest(tx, venueId, id, guest.linkId, key);
      if (existing) {
        if (existing.kind !== "cancel" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return;
      }
      const current = (
        await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.id, id), eq(reservations.venueId, venueId)))
          .for("update")
          .limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      if (guest) assertChangeable(current, guest);
      if (current.status === "cancelled") throw new ReservationError("already_cancelled");
      const nextVersion = current.version + 1;
      await tx.update(reservations).set({ status: "cancelled", version: nextVersion }).where(eq(reservations.id, id));
      await tx.delete(tableAllocations).where(eq(tableAllocations.reservationId, id));
      // Erasure already wrote this reservation's tombstone, with the same hash.
      await tx.insert(tombstones).values({ reservationId: id, venueId, hash }).onConflictDoNothing();
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "cancel", version: nextVersion });
      await tx.insert(events).values({ venueId, type: "cancelled", reservationId: id, version: nextVersion, ...originColumns(origin) });
      if (guest && !(await revokeForCancel(tx, guest.linkId, key))) {
        throw new ReservationError("self_service_link_invalid");
      }
    });
    return { ok: true, hash };
  } catch (error) {
    if (error instanceof ReservationError) {
      return { ok: false, code: error.code as Extract<CancelResult, { ok: false }>["code"] };
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
  origin: Origin | null,
): Promise<WriteResult> {
  try {
    const version = await db.transaction(async (tx) => {
      const existing = await claimKey(tx, venueId, key);
      if (existing) {
        if (existing.kind !== "status" || existing.reservationId !== id) {
          throw new ReservationError("invalid_request");
        }
        return existing.version;
      }
      const current = (
        await tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.id, id), eq(reservations.venueId, venueId)))
          .for("update")
          .limit(1)
      )[0];
      if (!current) throw new ReservationError("reservation_not_found");
      const allowed = ALLOWED_TRANSITIONS[status];
      if (!allowed || !allowed.includes(current.status)) {
        throw new ReservationError("invalid_transition");
      }
      if (status === "seated") {
        const held = await tx
          .select({ tableId: tableAllocations.tableId })
          .from(tableAllocations)
          .where(and(eq(tableAllocations.reservationId, id), eq(tableAllocations.active, true)))
          .limit(1);
        if (held.length === 0) throw new ReservationError("table_required");
      }
      const nextVersion = current.version + 1;
      await tx.update(reservations).set({ status, version: nextVersion }).where(eq(reservations.id, id));
      if (!ACTIVE_STATUSES.includes(status)) {
        await tx.update(tableAllocations).set({ active: false }).where(eq(tableAllocations.reservationId, id));
      }
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: id, kind: "status", version: nextVersion });
      await tx.insert(events).values({ venueId, type: status, reservationId: id, version: nextVersion, ...originColumns(origin) });
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
    if (!servesDate(service, date)) continue;
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
  /** The codes of the reasons that rule the slot out. Internal: no answer carries them. */
  codes: string[];
}

async function gridAvailability(
  db: Db,
  venue: ChannelVenue,
  serviceRows: ServiceRow[],
  date: string,
  partySize: number,
  zone: string,
): Promise<Record<string, GridSlot[]>> {
  const result: Record<string, GridSlot[]> = {};
  for (const service of serviceRows) {
    if (!servesDate(service, date)) continue;
    const { start, end } = serviceWindow(service.openStart, service.openEnd);
    const slots: GridSlot[] = [];
    for (let m = start; m < end; m += venue.slotIntervalMinutes) {
      const request: SlotRequest = {
        date: addDays(date, Math.floor(m / (24 * 60))),
        time: toTime(m % (24 * 60)),
        partySize,
        zone,
        walkIn: false,
      };
      const reasons = await evaluateSlot(db, venue, serviceRows, request);
      if (reasons.some((r) => r.code === "outside_hours")) continue;
      slots.push({
        date: request.date,
        time: request.time,
        available: reasons.length === 0,
        codes: reasons.map((r) => r.code),
      });
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

export type PublicEmptyReason = "past_date" | "beyond_horizon";

type PublicChannelView = { venue: ChannelVenue; serviceRows: ServiceRow[] };

// The one availability computation of the public channel, shared by `publicTimes` and `publicDays`.
async function publicDayGrid(
  db: Db,
  view: PublicChannelView,
  date: string,
  partySize: number,
): Promise<{ times: string[]; reason: PublicEmptyReason | null; slots: GridSlot[] }> {
  const { venue, serviceRows } = view;
  const grid = await gridAvailability(db, venue, serviceRows, date, partySize, "");
  const slots = Object.values(grid)
    .flat()
    .filter((s) => s.date === date);
  const sorted = [...new Set(slots.filter((s) => s.available).map((s) => s.time))].sort();
  if (sorted.length > 0) return { times: sorted, reason: null, slots };
  const today = localDateTime(new Date(), venue.timezone).date;
  if (date < today) return { times: sorted, reason: "past_date", slots };
  if (venue.maxAdvanceDays !== null && date > addDays(today, venue.maxAdvanceDays)) {
    return { times: sorted, reason: "beyond_horizon", slots };
  }
  return { times: sorted, reason: null, slots };
}

async function publicView(db: Db, venueId: string, rules: OnlineRules): Promise<PublicChannelView | null> {
  const stored = await venueOf(db, venueId);
  if (!stored) return null;
  return applyChannel(stored, await db.select().from(services).where(eq(services.venueId, venueId)), {
    kind: "public",
    rules,
  });
}

/**
 * The local times a public create would accept now for this date and party, ascending, each once. When there are
 * none, `reason` says so for a date already gone or past the horizon; any other empty answer has `reason: null`.
 */
export async function publicTimes(
  db: Db,
  venueId: string,
  date: string,
  partySize: number,
  rules: OnlineRules,
): Promise<{ times: string[]; reason: PublicEmptyReason | null }> {
  const view = await publicView(db, venueId, rules);
  if (!view) return { times: [], reason: null };
  const { times, reason } = await publicDayGrid(db, view, date, partySize);
  return { times, reason };
}

export type PublicDayStatus = "available" | "full" | "closed" | "outside_window";

// A start that no table decides: the date is blocked, or the start is past or inside the lead time.
const DATE_OR_CLOCK_CODES = new Set(["date_blocked", "lead_time_violation"]);

/**
 * The status of each date for a party (ADR-0021, C63): the first of available, outside_window, closed and full.
 * It runs the same grid as `publicTimes` per date and maps its result. A served date is `closed` when it has no
 * slot, or when every slot is ruled out by the date being blocked or by the clock (past or inside the lead
 * time); it is `full` when some start is left to the clock and the tables, limits or capacity refuse them all.
 */
export async function publicDays(
  db: Db,
  venueId: string,
  dates: string[],
  partySize: number,
  rules: OnlineRules,
): Promise<{ date: string; status: PublicDayStatus; firstTime: string | null }[]> {
  const view = await publicView(db, venueId, rules);
  // The dates are independent reads, so they run together: a strip is one round of grids, not twelve in a row.
  return Promise.all(
    dates.map(async (date): Promise<{ date: string; status: PublicDayStatus; firstTime: string | null }> => {
      if (!view) return { date, status: "closed", firstTime: null };
      const { times, reason, slots } = await publicDayGrid(db, view, date, partySize);
      if (times.length > 0) return { date, status: "available", firstTime: times[0]! };
      if (reason !== null) return { date, status: "outside_window", firstTime: null };
      if (slots.every((s) => s.codes.some((code) => DATE_OR_CLOCK_CODES.has(code)))) {
        return { date, status: "closed", firstTime: null };
      }
      return { date, status: "full", firstTime: null };
    }),
  );
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
