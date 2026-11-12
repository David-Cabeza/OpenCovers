import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  events,
  reservations,
  tombstones,
  venueMemberships,
  venues,
} from "../db/schema";
import * as schema from "../db/schema";
import { consentColumns } from "./consent";
import { ratingColumns } from "./rating";
import { normalizeTimeZone } from "./time";
import { sha256Hex } from "./reservations";

export type Db = NodePgDatabase<typeof schema>;

export interface VenueConfig {
  enabled: boolean;
  noticeAddress: string;
  notificationsEnabled: boolean;
  resendConfigured: boolean;
  fromEmail: string;
  slotIntervalMinutes: number;
  leadTimeMinutes: number;
  lastSeatingOffsetMinutes: number;
}

export type ConfigResult =
  | { ok: true; config: VenueConfig }
  | { ok: false; code: "notice_address_required" | "venue_not_found" };

export interface ErasureResult {
  erasedReservations: number;
  erasedGuests: number;
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
    },
  };
}

export async function erase(
  db: Db,
  venueId: string,
  guestId?: string,
  principal?: string,
): Promise<ErasureResult> {
  const matches = guestId
    ? await db
        .select({ id: reservations.id, version: reservations.version })
        .from(reservations)
        .where(
          and(
            eq(reservations.venueId, venueId),
            eq(reservations.guestContact, guestId),
            eq(reservations.erased, false),
          ),
        )
    : principal
      ? await db
          .select({ id: reservations.id, version: reservations.version })
          .from(reservations)
          .where(
            and(
              eq(reservations.venueId, venueId),
              eq(reservations.ownerPrincipal, principal),
              eq(reservations.erased, false),
            ),
          )
      : [];
  if (matches.length === 0) {
    return { erasedReservations: 0, erasedGuests: 0 };
  }
  await db.transaction(async (tx) => {
    for (const m of matches) {
      const hash = await sha256Hex(m.id);
      await tx
        .update(reservations)
        .set({ guestName: "", guestContact: "", ...consentColumns("unknown"), ...ratingColumns(null), erased: true })
        .where(eq(reservations.id, m.id));
      await tx.insert(tombstones).values({
        reservationId: m.id,
        venueId,
        hash,
      });
      await tx.insert(events).values({
        venueId,
        type: "erased",
        reservationId: m.id,
        version: m.version,
        tombstoneHash: hash,
      });
    }
  });
  return { erasedReservations: matches.length, erasedGuests: 1 };
}
