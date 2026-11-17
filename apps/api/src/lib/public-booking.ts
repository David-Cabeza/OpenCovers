import { and, eq } from "drizzle-orm";
import { reservations, services, venueOnlineBooking, venues } from "../db/schema";
import { isCommentary } from "./commentary";
import { normalizeContact, venueCountry } from "./contact";
import type { OnlineBooking, Theme } from "./online-booking";
import { isSolution, parseChallenge, type FormChallenge } from "./public-challenge";
import { applyChannel, type OnlineRules } from "./reservations";
import { formatTime } from "./time";
import type { Db } from "./venue";

// The guest-facing channel of ADR-0017. Nothing here returns an id, a table, a zone or attribution.

const BOOKING_KEY = /^pk_[A-Za-z0-9_-]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const LINK_LIFE_MS = 48 * 3_600_000;
const REFUSED_FIELDS = ["tables", "zone", "rating", "reconfirmation"] as const;

type VenueRow = typeof venues.$inferSelect;

export interface PublicVenue {
  venue: VenueRow;
  settings: Pick<
    OnlineBooking,
    | "services"
    | "weekdays"
    | "minPartySize"
    | "maxPartySize"
    | "leadTimeMinutes"
    | "maxAdvanceDays"
    | "selfServiceCutoffMinutes"
    | "maxOpenBookingsPerContact"
    | "confirmationMode"
    | "askConsent"
    | "locale"
    | "theme"
  >;
}

export interface PublicCreate {
  date: string;
  time: string;
  partySize: number;
  name: string;
  contact: string;
  consent: "unknown" | "granted";
  commentary: string;
  challenge: FormChallenge;
  solution: string;
}

/** The venue a booking key names, or null for an unknown, malformed or disabled key, all alike. */
export async function resolveBookingKey(db: Db, bookingKey: string): Promise<PublicVenue | null> {
  if (!BOOKING_KEY.test(bookingKey)) return null;
  const row = (
    await db
      .select({ venue: venues, settings: venueOnlineBooking })
      .from(venueOnlineBooking)
      .innerJoin(venues, eq(venues.id, venueOnlineBooking.venueId))
      .where(and(eq(venueOnlineBooking.bookingKey, bookingKey), eq(venueOnlineBooking.enabled, true)))
      .limit(1)
  )[0];
  if (!row) return null;
  return { venue: row.venue, settings: { ...row.settings, theme: row.settings.theme as Theme } };
}

export function rulesOf(settings: PublicVenue["settings"]): OnlineRules {
  return {
    services: settings.services,
    weekdays: settings.weekdays,
    minPartySize: settings.minPartySize,
    maxPartySize: settings.maxPartySize,
    leadTimeMinutes: settings.leadTimeMinutes,
    maxAdvanceDays: settings.maxAdvanceDays,
    maxOpenBookingsPerContact: settings.maxOpenBookingsPerContact,
  };
}

function venueView({ venue, settings }: PublicVenue) {
  return { name: venue.name, locale: settings.locale, theme: settings.theme, phone: venue.publicPhone };
}

export async function publicConfig(db: Db, target: PublicVenue, challenge: FormChallenge) {
  const { venue, settings } = target;
  const online = applyChannel(
    venue,
    await db.select().from(services).where(eq(services.venueId, venue.id)),
    { kind: "public", rules: rulesOf(settings) },
  );
  const weekdays = [...new Set(online.serviceRows.flatMap((s) => s.days))].sort((a, b) => a - b);
  return {
    venue: venueView(target),
    minPartySize: settings.minPartySize,
    maxPartySize: settings.maxPartySize,
    weekdays,
    leadTimeMinutes: online.venue.leadTimeMinutes,
    maxAdvanceDays: online.venue.maxAdvanceDays,
    askConsent: settings.askConsent,
    confirmationMode: settings.confirmationMode,
    challenge,
    captcha: null,
  };
}

export function isPublicIdempotencyKey(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

/** Public keys live apart from staff keys, so a public request can replay only a public request. */
export const storedKey = (key: string) => `public:${key.toLowerCase()}`;

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parses a public create body against the venue. Returns null for anything the contract answers with
 * `invalid_request`, the honeypot included, so every refusal looks the same.
 */
export function parsePublicCreate(body: unknown, target: PublicVenue): PublicCreate | null {
  if (!isObject(body) || !isObject(body.guest)) return null;
  if (REFUSED_FIELDS.some((field) => body[field] !== undefined)) return null;
  if (body.honeypot !== undefined && body.honeypot !== "") return null;
  if (!isDate(body.date) || typeof body.time !== "string" || !TIME.test(body.time)) return null;
  if (typeof body.partySize !== "number" || !Number.isInteger(body.partySize) || body.partySize < 1) return null;
  const { name, contact, consent } = body.guest;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) return null;
  if (typeof contact !== "string" || contact.length > 254) return null;
  if (!normalizeContact(contact, venueCountry(target.venue))) return null;
  if (consent !== undefined && consent !== "unknown" && consent !== "granted") return null;
  if (body.commentary !== undefined && !isCommentary(body.commentary)) return null;
  const challenge = parseChallenge(body.challenge);
  if (!challenge || !isSolution(body.solution)) return null;
  return {
    date: body.date,
    time: body.time,
    partySize: body.partySize,
    name: name.trim(),
    contact: contact.trim(),
    consent: target.settings.askConsent && consent === "granted" ? "granted" : "unknown",
    commentary: (body.commentary as string | undefined) ?? "",
    challenge,
    solution: body.solution,
  };
}

export function maskContact(contact: string): string {
  const at = contact.lastIndexOf("@");
  if (at > 0) return `${contact[0]}***${contact.slice(at)}`;
  const digits = contact.replace(/\D/g, "");
  return `***${digits.slice(-2)}`;
}

/** The guest view of one booking (`PublicReservation`). */
export async function guestView(db: Db, target: PublicVenue, reservationId: string) {
  const row = (
    await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, target.venue.id)))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    venue: venueView(target),
    date: row.date,
    time: formatTime(row.startsAt, target.venue.timezone),
    partySize: row.partySize,
    status: row.status,
    version: row.version,
    guest: { name: row.guestName, contact: maskContact(row.guestContact.trim().toLowerCase()) },
    commentary: row.commentary,
    consent: row.consent,
    changeableUntil: new Date(row.startsAt.getTime() - target.settings.selfServiceCutoffMinutes * 60_000).toISOString(),
    linkExpiresAt: new Date(row.endsAt.getTime() + LINK_LIFE_MS).toISOString(),
  };
}
