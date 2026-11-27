import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  guestAudit,
  guests,
  reservations,
  tombstones,
  venueMemberships,
  venues,
  waitlist,
} from "../db/schema";
import * as schema from "../db/schema";
import type { CountryCode } from "libphonenumber-js";
import type { DateRange } from "./booking-policy";
import { consentColumns } from "./consent";
import { dietaryEnabled, dietaryValuesHidden } from "./dietary";
import { appendEvents, type NewEvent } from "./events";
import type { Origin } from "./origin";
import { countBlocklistEntries, guestContactKeys } from "./blocklist";
import { normalizeContact, venueCountry } from "./contact";
import { forgetMergeState, lockReservations, movedAtMerge } from "./guests";
import { ratingColumns } from "./rating";
import { reconfirmationColumns } from "./reconfirmation";
import { boundLockWaits, isLockFailure, lockOverbooking, sha256Hex } from "./reservations";
import { deleteLinks } from "./self-service";
import type { TurnTime } from "./turn-times";

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface VenueConfig {
  enabled: boolean;
  noticeAddress: string;
  notificationsEnabled: boolean;
  resendConfigured: boolean;
  fromEmail: string;
  slotIntervalMinutes: number;
  leadTimeMinutes: number;
  lastSeatingOffsetMinutes: number;
  phoneCountry: string | null;
  turnTimes?: TurnTime[];
  overbookingCeiling: number;
  maxAdvanceDays: number | null;
  maxActivePerGuestPerDay: number | null;
  blockedDates: DateRange[];
  /** Read only: the instance switch `DIETARY`, the same for every venue (ADR-0027). */
  dietaryEnabled: boolean;
  /** Read only: values of this venue's current and upcoming bookings exist and no read returns them (C82). */
  dietaryValuesHidden: boolean;
}

export type ConfigResult =
  | { ok: true; config: VenueConfig }
  | { ok: false; code: "notice_address_required" | "venue_not_found" | "venue_busy" };

export interface ErasureResult {
  erasedReservations: number;
  erasedGuests: number;
  erasedWaitlistEntries: number;
  blocklistEntriesKept: number;
}

export async function createVenue(
  db: Db,
  userId: string,
  input: { id?: string; name: string; timezone?: string },
): Promise<{ id: string }> {
  const id = input.id ?? randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(venues).values({
      id,
      name: input.name,
      timezone: input.timezone ?? "UTC",
      enabled: false,
    });
    await tx.insert(venueMemberships).values({
      userId,
      venueId: id,
      role: "admin",
    });
  });
  return { id };
}

export async function getConfig(db: Db, venueId: string): Promise<VenueConfig | null> {
  const venue = (
    await db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
  )[0];
  if (!venue) return null;
  return {
    enabled: venue.enabled,
    noticeAddress: venue.noticeAddress,
    notificationsEnabled: venue.notificationsEnabled,
    resendConfigured: venue.resendApiKey != null,
    fromEmail: venue.fromEmail,
    slotIntervalMinutes: venue.slotIntervalMinutes,
    leadTimeMinutes: venue.leadTimeMinutes,
    lastSeatingOffsetMinutes: venue.lastSeatingOffsetMinutes,
    phoneCountry: venue.phoneCountry,
    ...turnTimesField(venue.turnTimes),
    overbookingCeiling: venue.overbookingCeiling,
    maxAdvanceDays: venue.maxAdvanceDays,
    maxActivePerGuestPerDay: venue.maxActivePerGuestPerDay,
    blockedDates: venue.blockedDates,
    dietaryEnabled: dietaryEnabled(),
    dietaryValuesHidden: await dietaryValuesHidden(db, venueId, venue.timezone),
  };
}

function turnTimesField(turnTimes: TurnTime[]): { turnTimes?: TurnTime[] } {
  return turnTimes.length > 0 ? { turnTimes } : {};
}

export async function setConfig(
  db: Db,
  venueId: string,
  input: {
    enabled?: boolean;
    noticeAddress?: string;
    notificationsEnabled?: boolean;
    resendApiKey?: string;
    fromEmail?: string;
    slotIntervalMinutes?: number;
    leadTimeMinutes?: number;
    lastSeatingOffsetMinutes?: number;
    phoneCountry?: CountryCode | null;
    turnTimes?: TurnTime[];
    overbookingCeiling?: number;
    maxAdvanceDays?: number | null;
    maxActivePerGuestPerDay?: number | null;
    blockedDates?: DateRange[];
  },
): Promise<ConfigResult> {
  // The merge reads every column and writes every column back, so two updates to different fields would lose one.
  // FOR NO KEY UPDATE serializes config writers and still lets bookings (plain reads, FOR KEY SHARE on inserts) through.
  const save = db.transaction(async (tx): Promise<ConfigResult> => {
    const venue = (
      await tx.select().from(venues).where(eq(venues.id, venueId)).for("no key update").limit(1)
    )[0];
    if (!venue) return { ok: false, code: "venue_not_found" };
    const enabled = input.enabled ?? venue.enabled;
    const noticeAddress =
      input.noticeAddress !== undefined ? input.noticeAddress : venue.noticeAddress;
    if (enabled && noticeAddress === "") {
      return { ok: false, code: "notice_address_required" };
    }
    const slotIntervalMinutes = input.slotIntervalMinutes ?? venue.slotIntervalMinutes;
    const leadTimeMinutes = input.leadTimeMinutes ?? venue.leadTimeMinutes;
    const lastSeatingOffsetMinutes =
      input.lastSeatingOffsetMinutes ?? venue.lastSeatingOffsetMinutes;
    const notificationsEnabled = input.notificationsEnabled ?? venue.notificationsEnabled;
    const fromEmail = input.fromEmail !== undefined ? input.fromEmail : venue.fromEmail;
    const phoneCountry = input.phoneCountry !== undefined ? input.phoneCountry : venue.phoneCountry;
    const turnTimes = input.turnTimes ?? venue.turnTimes;
    const overbookingCeiling = input.overbookingCeiling ?? venue.overbookingCeiling;
    const maxAdvanceDays = input.maxAdvanceDays !== undefined ? input.maxAdvanceDays : venue.maxAdvanceDays;
    const maxActivePerGuestPerDay =
      input.maxActivePerGuestPerDay !== undefined ? input.maxActivePerGuestPerDay : venue.maxActivePerGuestPerDay;
    const blockedDates = input.blockedDates ?? venue.blockedDates;
    const resendApiKey =
      input.resendApiKey !== undefined
        ? input.resendApiKey === ""
          ? null
          : input.resendApiKey
        : venue.resendApiKey;
    // C24: a write that counted under the old ceiling commits before the new one does. The wait is bounded, so a
    // change that gives up lets the bookings queued behind it go on.
    if (overbookingCeiling !== venue.overbookingCeiling) {
      await boundLockWaits(tx);
      await lockOverbooking(tx, venueId);
    }
    await tx
      .update(venues)
      .set({
        enabled,
        noticeAddress,
        notificationsEnabled,
        resendApiKey,
        fromEmail,
        slotIntervalMinutes,
        leadTimeMinutes,
        lastSeatingOffsetMinutes,
        phoneCountry,
        turnTimes,
        overbookingCeiling,
        maxAdvanceDays,
        maxActivePerGuestPerDay,
        blockedDates,
      })
      .where(eq(venues.id, venueId));
    return {
      ok: true,
      config: {
        enabled,
        noticeAddress,
        notificationsEnabled,
        resendConfigured: resendApiKey != null,
        fromEmail,
        slotIntervalMinutes,
        leadTimeMinutes,
        lastSeatingOffsetMinutes,
        phoneCountry,
        ...turnTimesField(turnTimes),
        overbookingCeiling,
        maxAdvanceDays,
        maxActivePerGuestPerDay,
        blockedDates,
        dietaryEnabled: dietaryEnabled(),
        dietaryValuesHidden: await dietaryValuesHidden(tx, venueId, venue.timezone),
      },
    };
  });
  return save.catch((error): ConfigResult => {
    if (isLockFailure(error)) return { ok: false, code: "venue_busy" };
    throw error;
  });
}

export async function erase(
  db: Db,
  venueId: string,
  guestId?: string,
  principal?: string,
  actor = "",
  origin: Origin | null = null,
): Promise<ErasureResult> {
  const venue = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  if (!venue || (!guestId && !principal)) {
    return { erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0, blocklistEntriesKept: 0 };
  }
  return db.transaction(async (tx) => {
    // Lock order, shared with the other writers: reservation rows (by id), then their links, then the waitlist
    // entry, then the guests, a merged guest before its root (lockChains). A first pass reads without locks to learn
    // what to lock; the second pass repeats the reads under the guest locks and so also sees what committed in between.
    const first = await resolveTargets(tx, venue, venueId, guestId, principal, false);
    await lockReservations(tx, venueId, first.matches.map((m) => m.id));
    await deleteLinks(tx, venueId, first.matches.map((m) => m.id));
    const erasedEarly = guestId
      ? await deleteWaitlist(tx, venue, first.contact, [
          ...first.byGuest.flatMap((g) => [g.email, g.phone]),
          first.contactKey?.value ?? null,
        ])
      : 0;
    await lockChains(tx, venueId, first.byGuest);
    const { contact, contactKey, byGuest, matches } = await resolveTargets(
      tx,
      venue,
      venueId,
      guestId,
      principal,
      true,
    );
    const linked = guestId
      ? []
      : [...new Set(matches.flatMap((m) => (m.guestId ? [m.guestId] : [])))];
    if (linked.length > 0) {
      const unlocked = await tx
        .select()
        .from(guests)
        .where(and(eq(guests.venueId, venueId), inArray(guests.id, linked)));
      await lockChains(tx, venueId, await withMerged(tx, venueId, unlocked, false));
    }
    const linkedGuests =
      linked.length > 0
        ? await tx
            .select()
            .from(guests)
            .where(and(eq(guests.venueId, venueId), inArray(guests.id, linked)))
            .for("update")
        : [];
    const family = await withMerged(tx, venueId, linkedGuests);
    const erasedEvents = await eraseReservations(tx, venueId, matches, origin);

    const targets = guestId ? byGuest : await unreferenced(tx, venueId, family);
    const targetIds = targets.map((g) => g.id);

    if (targetIds.length > 0) {
      await tx.delete(guests).where(and(eq(guests.venueId, venueId), inArray(guests.id, targetIds)));
      await tx
        .insert(guestAudit)
        .values(targetIds.map((id) => ({ venueId, guestId: id, action: "erased" as const, principal: actor })));
    }
    await forgetMergeState(tx, venueId, targetIds);

    const erasedWaitlistEntries =
      erasedEarly +
      (guestId
        ? await deleteWaitlist(tx, venue, contact, [
            ...byGuest.flatMap((g) => [g.email, g.phone]),
            contactKey?.value ?? null,
          ])
        : 0);
    const blocklistEntriesKept = await countBlocklistEntries(tx, venueId, [
      ...targets.flatMap(guestContactKeys),
      ...(contactKey ? [contactKey] : []),
    ]);
    await appendEvents(tx, venueId, erasedEvents);
    return { erasedReservations: matches.length, erasedGuests: targetIds.length, erasedWaitlistEntries, blocklistEntriesKept };
  });
}

type Matched = { id: string; version: number; guestId: string | null };

/**
 * Who and what an erasure covers. With `lock` the guests and the matched reservations are row-locked
 * (reservations in id order); without it the reads take no lock, to learn what the locks must cover.
 */
async function resolveTargets(
  tx: DbTx,
  venue: typeof venues.$inferSelect,
  venueId: string,
  guestId: string | undefined,
  principal: string | undefined,
  lock: boolean,
) {
  let idQuery = tx
    .select()
    .from(guests)
    .where(and(eq(guests.venueId, venueId), eq(guests.id, guestId ?? "")))
    .orderBy(guests.id)
    .$dynamic();
  if (lock) idQuery = idQuery.for("update");
  const byId = guestId ? await idQuery : [];
  const contact = guestId && byId.length === 0 ? guestId : null;
  const contactKey = contact ? normalizeContact(contact, venueCountry(venue)) : null;
  let contactQuery = tx
    .select()
    .from(guests)
    .where(
      and(
        eq(guests.venueId, venueId),
        contactKey?.kind === "email" ? eq(guests.email, contactKey.value) : eq(guests.phone, contactKey?.value ?? ""),
      ),
    )
    .orderBy(guests.id)
    .$dynamic();
  if (lock) contactQuery = contactQuery.for("update");
  const byContact = contactKey ? await contactQuery : [];
  const byGuest = await withMerged(tx, venueId, [...byId, ...byContact], lock);
  const moved = await movedAtMerge(tx, venueId, byGuest);

  const owned = guestId
    ? or(
        byGuest.length > 0 ? inArray(reservations.guestId, byGuest.map((g) => g.id)) : undefined,
        moved.length > 0 ? inArray(reservations.id, moved) : undefined,
        contact ? eq(reservations.guestContact, contact) : undefined,
      )
    : eq(reservations.ownerPrincipal, principal as string);
  let matchQuery = tx
    .select({ id: reservations.id, version: reservations.version, guestId: reservations.guestId })
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false), owned))
    .orderBy(reservations.id)
    .$dynamic();
  if (lock) matchQuery = matchQuery.for("update");
  const matches: Matched[] = owned ? await matchQuery : [];
  return { contact, contactKey, byGuest, matches };
}

/**
 * Blanks the reservations and writes their tombstones. It returns their `erased` events instead of writing them:
 * the caller appends them as its last statement, so the events lock is held only for that tail (lib/events.ts).
 */
export async function eraseReservations(
  tx: DbTx,
  venueId: string,
  rows: { id: string; version: number }[],
  origin: Origin | null = null,
): Promise<NewEvent[]> {
  await deleteLinks(tx, venueId, rows.map((m) => m.id));
  const erased: NewEvent[] = [];
  for (const m of rows) {
    const hash = await sha256Hex(m.id);
    await tx
      .update(reservations)
      .set({
        guestName: "",
        guestContact: "",
        guestId: null,
        guestLocale: null,
        ...consentColumns("unknown"),
        ...ratingColumns(null),
        commentary: "",
        dietary: null,
        ...reconfirmationColumns("none"),
        erased: true,
      })
      .where(and(eq(reservations.venueId, venueId), eq(reservations.id, m.id)));
    // A cancel already wrote this reservation's tombstone, with the same hash.
    await tx.insert(tombstones).values({ reservationId: m.id, venueId, hash }).onConflictDoNothing();
    erased.push({ type: "erased", reservationId: m.id, version: m.version, tombstoneHash: hash, origin });
  }
  return erased;
}

type Guest = typeof guests.$inferSelect;

export async function withMerged(tx: DbTx, venueId: string, roots: Guest[], lock = true): Promise<Guest[]> {
  const found = new Map(roots.map((g) => [g.id, g]));
  let frontier = [...found.keys()];
  while (frontier.length > 0) {
    let query = tx
      .select()
      .from(guests)
      .where(and(eq(guests.venueId, venueId), inArray(guests.mergedInto, frontier)))
      .orderBy(guests.id)
      .$dynamic();
    if (lock) query = query.for("update");
    const absorbed = await query;
    frontier = absorbed.filter((g) => !found.has(g.id)).map((g) => g.id);
    for (const g of absorbed) found.set(g.id, g);
  }
  return [...found.values()];
}

/**
 * Row-locks the guests of `family` (what `withMerged` read) in the order a booking locks a merged chain: a merged
 * guest before the guest it was merged into, since linkGuest locks the guest its contact matched and then the root.
 * The deepest guests go first and the roots last, each depth in id order.
 */
async function lockChains(tx: DbTx, venueId: string, family: Guest[]): Promise<void> {
  const byId = new Map(family.map((g) => [g.id, g]));
  const depth = (g: Guest): number => {
    const parent = g.mergedInto ? byId.get(g.mergedInto) : undefined;
    return parent ? depth(parent) + 1 : 0;
  };
  const levels = new Map<number, string[]>();
  for (const g of family) {
    const d = depth(g);
    levels.set(d, [...(levels.get(d) ?? []), g.id]);
  }
  for (const level of [...levels.keys()].sort((a, b) => b - a)) {
    await tx
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.venueId, venueId), inArray(guests.id, levels.get(level) as string[])))
      .orderBy(guests.id)
      .for("update");
  }
}

async function unreferenced(tx: DbTx, venueId: string, family: Guest[]): Promise<Guest[]> {
  if (family.length === 0) return [];
  const byId = new Map(family.map((g) => [g.id, g]));
  const top = (g: Guest): string => {
    let cur = g;
    for (let next = cur.mergedInto ? byId.get(cur.mergedInto) : undefined; next; ) {
      cur = next;
      next = cur.mergedInto ? byId.get(cur.mergedInto) : undefined;
    }
    return cur.id;
  };
  const stillUsed = await tx
    .selectDistinct({ guestId: reservations.guestId })
    .from(reservations)
    .where(
      and(
        eq(reservations.venueId, venueId),
        eq(reservations.erased, false),
        inArray(reservations.guestId, [...byId.keys()]),
      ),
    );
  const kept = new Set(stillUsed.flatMap((r) => (r.guestId ? [top(byId.get(r.guestId) as Guest)] : [])));
  return family.filter((g) => !kept.has(top(g)));
}

async function deleteWaitlist(
  tx: DbTx,
  venue: typeof venues.$inferSelect,
  contact: string | null,
  keys: (string | null)[],
): Promise<number> {
  const wanted = new Set(keys.filter((k): k is string => k !== null));
  const country = venueCountry(venue);
  const rows = await tx
    .select({ id: waitlist.id, guestContact: waitlist.guestContact })
    .from(waitlist)
    .where(and(eq(waitlist.venueId, venue.id), ne(waitlist.guestContact, "")));
  const ids = rows
    .filter((r) => r.guestContact === contact || wanted.has(normalizeContact(r.guestContact, country)?.value ?? ""))
    .map((r) => r.id);
  if (ids.length === 0) return 0;
  // Lock the entries before deleting them, the order a seat or a cancel of an entry takes.
  await tx
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(and(eq(waitlist.venueId, venue.id), inArray(waitlist.id, ids)))
    .orderBy(waitlist.id)
    .for("update");
  await tx.delete(waitlist).where(and(eq(waitlist.venueId, venue.id), inArray(waitlist.id, ids)));
  return ids.length;
}
