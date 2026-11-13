import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  events,
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
import { consentColumns } from "./consent";
import { normalizeContact, venueCountry } from "./contact";
import { forgetMergeState, movedAtMerge } from "./guests";
import { ratingColumns } from "./rating";
import { normalizeTimeZone } from "./time";
import { sha256Hex } from "./reservations";

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
}

export type ConfigResult =
  | { ok: true; config: VenueConfig }
  | { ok: false; code: "notice_address_required" | "venue_not_found" };

export interface ErasureResult {
  erasedReservations: number;
  erasedGuests: number;
  erasedWaitlistEntries: number;
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
      timezone: normalizeTimeZone(input.timezone ?? "UTC"),
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
  };
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
  },
): Promise<ConfigResult> {
  const venue = (
    await db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
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
  const resendApiKey =
    input.resendApiKey !== undefined
      ? input.resendApiKey === ""
        ? null
        : input.resendApiKey
      : venue.resendApiKey;
  await db
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
    },
  };
}

export async function erase(
  db: Db,
  venueId: string,
  guestId?: string,
  principal?: string,
  actor = "",
): Promise<ErasureResult> {
  const venue = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  if (!venue || (!guestId && !principal)) {
    return { erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0 };
  }
  return db.transaction(async (tx) => {
    const byId = guestId
      ? await tx
          .select()
          .from(guests)
          .where(and(eq(guests.venueId, venueId), eq(guests.id, guestId)))
          .for("update")
      : [];
    const contact = guestId && byId.length === 0 ? guestId : null;
    const contactKey = contact ? normalizeContact(contact, venueCountry(venue)) : null;
    const byContact = contactKey
      ? await tx
          .select()
          .from(guests)
          .where(
            and(
              eq(guests.venueId, venueId),
              contactKey.kind === "email"
                ? eq(guests.email, contactKey.value)
                : eq(guests.phone, contactKey.value),
            ),
          )
          .for("update")
      : [];
    const byGuest = await withMerged(tx, venueId, [...byId, ...byContact]);
    const moved = await movedAtMerge(tx, venueId, byGuest);

    const owned = guestId
      ? or(
          byGuest.length > 0 ? inArray(reservations.guestId, byGuest.map((g) => g.id)) : undefined,
          moved.length > 0 ? inArray(reservations.id, moved) : undefined,
          contact ? eq(reservations.guestContact, contact) : undefined,
        )
      : eq(reservations.ownerPrincipal, principal as string);
    const matches = owned
      ? await tx
          .select({ id: reservations.id, version: reservations.version, guestId: reservations.guestId })
          .from(reservations)
          .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false), owned))
      : [];
    const linked = guestId
      ? []
      : [...new Set(matches.flatMap((m) => (m.guestId ? [m.guestId] : [])))];
    const linkedGuests =
      linked.length > 0
        ? await tx
            .select()
            .from(guests)
            .where(and(eq(guests.venueId, venueId), inArray(guests.id, linked)))
            .for("update")
        : [];
    const family = await withMerged(tx, venueId, linkedGuests);
    await eraseReservations(tx, venueId, matches);

    const targets = guestId ? byGuest : await unreferenced(tx, venueId, family);
    const targetIds = targets.map((g) => g.id);

    if (targetIds.length > 0) {
      await tx.delete(guests).where(and(eq(guests.venueId, venueId), inArray(guests.id, targetIds)));
      await tx
        .insert(guestAudit)
        .values(targetIds.map((id) => ({ venueId, guestId: id, action: "erased" as const, principal: actor })));
    }
    await forgetMergeState(tx, venueId, targetIds);

    const erasedWaitlistEntries = guestId
      ? await deleteWaitlist(tx, venue, contact, [
          ...byGuest.flatMap((g) => [g.email, g.phone]),
          contactKey?.value ?? null,
        ])
      : 0;
    return {
      erasedReservations: matches.length,
      erasedGuests: targetIds.length,
      erasedWaitlistEntries,
    };
  });
}

export async function eraseReservations(
  tx: DbTx,
  venueId: string,
  rows: { id: string; version: number }[],
): Promise<void> {
  for (const m of rows) {
    const hash = await sha256Hex(m.id);
    await tx
      .update(reservations)
      .set({
        guestName: "",
        guestContact: "",
        guestId: null,
        ...consentColumns("unknown"),
        ...ratingColumns(null),
        erased: true,
      })
      .where(and(eq(reservations.venueId, venueId), eq(reservations.id, m.id)));
    await tx.insert(tombstones).values({ reservationId: m.id, venueId, hash });
    await tx.insert(events).values({
      venueId,
      type: "erased",
      reservationId: m.id,
      version: m.version,
      tombstoneHash: hash,
    });
  }
}

type Guest = typeof guests.$inferSelect;

export async function withMerged(tx: DbTx, venueId: string, roots: Guest[]): Promise<Guest[]> {
  const found = new Map(roots.map((g) => [g.id, g]));
  let frontier = [...found.keys()];
  while (frontier.length > 0) {
    const absorbed = await tx
      .select()
      .from(guests)
      .where(and(eq(guests.venueId, venueId), inArray(guests.mergedInto, frontier)))
      .for("update");
    frontier = absorbed.filter((g) => !found.has(g.id)).map((g) => g.id);
    for (const g of absorbed) found.set(g.id, g);
  }
  return [...found.values()];
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
  await tx.delete(waitlist).where(and(eq(waitlist.venueId, venue.id), inArray(waitlist.id, ids)));
  return ids.length;
}
