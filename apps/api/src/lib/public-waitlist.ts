import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { idempotencyKeys, waitlist, waitlistLinks } from "../db/schema";
import { enforceSandboxCap, mailIdentity, mayEmail } from "../demo/limits";
import { countBlocklistEntries } from "./blocklist";
import { normalizeContact, venueCountry, type ContactKey } from "./contact";
import { resolveEmailLocale } from "./email-messages";
import { emailVenue } from "./email-venue";
import { claimKey } from "./idempotency";
import { canResend } from "./link-resend";
import { buildWaitlistJoinEmail, sendEmail } from "./mailer";
import { enabledLocales } from "./online-booking";
import { isSolution, parseChallenge, type FormChallenge } from "./public-challenge";
import { maskContact, rulesOf, venueView, type PublicVenue } from "./public-booking";
import { publicDays } from "./reservations";
import { addDays, isCalendarDate, localDateTime, toTimestamp } from "./time";
import type { Db, DbTx } from "./venue";
import { markCancelled } from "./waitlist";

// The public waitlist of ADR-0021, section 3: the join, the guest's read and the leave. A waitlist token has the
// format of a booking's self-service token (ADR-0017) but lives in `waitlist_links`, so neither kind reaches the
// other's routes (C74). Nothing here returns an entry id, a venue id, the source or the consent time.

/** The caps of Q7 (C71), constants in v1. An open public entry is `waiting`, from the widget, dated today or later. */
export const WAITLIST_CAPS = { perContact: 2, perContactPerDate: 1, perDate: 50 } as const;

/** The idempotency kinds of the public waitlist. A key of any other kind fails on these routes, and theirs elsewhere. */
export const JOIN_KIND = "waitlist_join";
export const LEAVE_KIND = "waitlist_leave";

const TOKEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DUMMY_HASH = Buffer.alloc(32);
// Every field the join takes (`PublicWaitlistJoin`, `additionalProperties: false`). Anything else is `invalid_request`.
const JOIN_FIELDS = new Set([
  "date",
  "partySize",
  "window",
  "guest",
  "emailConsent",
  "locale",
  "honeypot",
  "challenge",
  "solution",
  "captchaToken",
]);

export type Compare = (a: Buffer, b: Buffer) => boolean;

export interface WaitlistJoin {
  date: string;
  partySize: number;
  window: { from: string; to: string } | null;
  name: string;
  /** The email as typed, trimmed. Staff read it whole. */
  contact: string;
  /** Its normalized key (REQ-G2), always an email. The caps and the blocklist go by it. */
  contactKey: ContactKey;
  /** ADR-0024: the language of the join email and of the leave link's `lang`. Not stored. */
  locale?: string;
  challenge: FormChallenge;
  solution: string;
}

export interface WaitlistLink {
  id: string;
  venueId: string;
  entryId: string;
  revokedAt: Date | null;
  leaveKey: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const digest = (secret: string) => createHash("sha256").update(secret).digest();

/**
 * Parses a join body against the venue. Returns null for everything the contract answers with `invalid_request`:
 * an unlisted field, a missing or false `emailConsent`, a contact that is not an email, a window that is not two
 * `HH:MM` times in order, a party outside the online limits, a bad locale, the honeypot and a malformed challenge.
 */
export function parseWaitlistJoin(body: unknown, target: PublicVenue): WaitlistJoin | null {
  if (!isObject(body) || Object.keys(body).some((field) => !JOIN_FIELDS.has(field))) return null;
  if (body.emailConsent !== true) return null;
  if (body.honeypot !== undefined && body.honeypot !== "") return null;
  // PUBLIC_CAPTCHA is not implemented, so the config's `captcha` is always null and a token is never verified.
  if (body.captchaToken !== undefined && typeof body.captchaToken !== "string") return null;
  if (body.locale !== undefined && (typeof body.locale !== "string" || !enabledLocales().includes(body.locale))) {
    return null;
  }
  if (!isCalendarDate(body.date)) return null;
  const { partySize } = body;
  if (typeof partySize !== "number" || !Number.isInteger(partySize)) return null;
  if (partySize < target.settings.minPartySize || partySize > target.settings.maxPartySize) return null;
  let window: WaitlistJoin["window"] = null;
  if (body.window !== undefined) {
    const w = body.window;
    if (!isObject(w) || Object.keys(w).some((k) => k !== "from" && k !== "to")) return null;
    if (typeof w.from !== "string" || typeof w.to !== "string" || !TIME.test(w.from) || !TIME.test(w.to)) return null;
    if (w.from >= w.to) return null;
    window = { from: w.from, to: w.to };
  }
  const guest = body.guest;
  if (!isObject(guest) || Object.keys(guest).some((k) => k !== "name" && k !== "contact")) return null;
  const { name, contact } = guest;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) return null;
  if (typeof contact !== "string" || contact.length > 254) return null;
  const contactKey = normalizeContact(contact, venueCountry(target.venue));
  if (contactKey?.kind !== "email") return null;
  const challenge = parseChallenge(body.challenge);
  if (!challenge || !isSolution(body.solution)) return null;
  return {
    date: body.date,
    partySize,
    window,
    name: name.trim(),
    contact: contact.trim(),
    contactKey,
    ...(body.locale !== undefined ? { locale: body.locale as string } : {}),
    challenge,
    solution: body.solution,
  };
}

/** Whether a guest can join now (`PublicConfig.waitlistEnabled`, C68): the setting on and the venue able to mail a link. */
export function waitlistOpen(target: PublicVenue, origin: string | null): boolean {
  return target.settings.waitlistEnabled && canResend(target.venue, origin);
}

/** Whether `/days` gives the date `available` or `full` for the party (C69). `closed` and `outside_window` do not join. */
export async function joinableDate(db: Db, target: PublicVenue, date: string, partySize: number): Promise<boolean> {
  const [day] = await publicDays(db, target.venue.id, [date], partySize, rulesOf(target.settings));
  return day?.status === "available" || day?.status === "full";
}

/** The end of a local date in the venue's time zone: the next local midnight. The leave link expires then (C74). */
export function endOfDate(date: string, timezone: string): Date {
  return toTimestamp(addDays(date, 1), "00:00", timezone);
}

export type JoinResult =
  | { ok: true; entryId: string; token: string | null }
  | { ok: false; code: "invalid_request" | "waitlist_unavailable" | "booking_declined" };

class JoinRefused extends Error {
  constructor(public code: "invalid_request" | "waitlist_unavailable" | "booking_declined") {
    super(code);
  }
}

/**
 * Adds the entry, its link and its key in one transaction. A repeat of the key returns the first entry with no
 * token. The caps are counted under advisory locks taken in one order (the key, the contact, then the date), so
 * concurrent joins cannot pass a cap and cannot deadlock. The blocklist runs last, only where the join would
 * otherwise succeed (C72), and its refusal rolls everything back, the key included.
 */
export async function joinWaitlist(db: Db, target: PublicVenue, input: WaitlistJoin, key: string): Promise<JoinResult> {
  const { venue } = target;
  try {
    return await db.transaction(async (tx): Promise<JoinResult> => {
      const stored = await claimKey(tx, venue.id, key);
      if (stored) {
        if (stored.kind !== JOIN_KIND) throw new JoinRefused("invalid_request");
        const [entry] = await tx
          .select({ id: waitlist.id })
          .from(waitlist)
          .where(and(eq(waitlist.venueId, venue.id), eq(waitlist.id, stored.reservationId)))
          .limit(1);
        // The entry was erased or deleted by retention: the key names nothing any more, as a public create says (C61).
        if (!entry) throw new JoinRefused("invalid_request");
        return { ok: true, entryId: entry.id, token: null };
      }
      const email = input.contactKey.value;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist-contact:${venue.id}:${email}`}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist-date:${venue.id}:${input.date}`}, 0))`);
      const today = localDateTime(new Date(), venue.timezone).date;
      const open = and(
        eq(waitlist.venueId, venue.id),
        eq(waitlist.source, "widget"),
        eq(waitlist.status, "waiting"),
        gte(waitlist.date, today),
      );
      const [mine] = await tx
        .select({
          all: count(),
          onDate: sql<number>`count(*) filter (where ${waitlist.date} = ${input.date})::int`,
        })
        .from(waitlist)
        .where(and(open, sql`lower(normalize(btrim(${waitlist.guestContact}), NFC)) = ${email}`));
      if (mine!.all >= WAITLIST_CAPS.perContact || mine!.onDate >= WAITLIST_CAPS.perContactPerDate) {
        throw new JoinRefused("waitlist_unavailable");
      }
      const [onDate] = await tx
        .select({ held: count() })
        .from(waitlist)
        .where(and(open, eq(waitlist.date, input.date)));
      if (onDate!.held >= WAITLIST_CAPS.perDate) throw new JoinRefused("waitlist_unavailable");
      await enforceSandboxCap(tx as unknown as Db, venue.id, "waitlist");

      const entryId = crypto.randomUUID();
      await tx.insert(waitlist).values({
        id: entryId,
        venueId: venue.id,
        partySize: input.partySize,
        zone: "",
        guestName: input.name,
        guestContact: input.contact,
        date: input.date,
        windowStart: input.window?.from ?? null,
        windowEnd: input.window?.to ?? null,
        source: "widget",
        // The proof of the guest's email consent, by the database clock (C70). It covers email about this entry only.
        consentAt: sql`now()`,
      });
      // ADR-0018 via Q10: last, so a closed date, a cap or a bad body answer the same for a blocked contact.
      if ((await countBlocklistEntries(tx, venue.id, [input.contactKey])) > 0) throw new JoinRefused("booking_declined");
      const token = await mintWaitlistLink(tx, venue.id, entryId, endOfDate(input.date, venue.timezone));
      await tx.insert(idempotencyKeys).values({ key, venueId: venue.id, reservationId: entryId, kind: JOIN_KIND, version: 1 });
      return { ok: true, entryId, token };
    });
  } catch (error) {
    if (error instanceof JoinRefused) return { ok: false, code: error.code };
    throw error;
  }
}

async function mintWaitlistLink(tx: DbTx, venueId: string, entryId: string, expiresAt: Date): Promise<string> {
  const id = crypto.randomUUID();
  const secret = randomBytes(32).toString("base64url");
  await tx.insert(waitlistLinks).values({ id, venueId, entryId, secretHash: digest(secret).toString("hex"), expiresAt });
  return `${id}.${secret}`;
}

/**
 * The waitlist link a token names while it has not expired, a revoked one included, or null. The lookup goes by link
 * id, and an unknown id runs the same compare against a dummy hash, so the time taken does not tell whether it exists.
 */
export async function findWaitlistLink(
  db: Db,
  token: string | undefined,
  compare: Compare = timingSafeEqual,
): Promise<WaitlistLink | null> {
  const match = TOKEN.exec(token ?? "");
  if (!match) return null;
  const [, id, secret] = match;
  const row = (
    await db
      .select({
        id: waitlistLinks.id,
        venueId: waitlistLinks.venueId,
        entryId: waitlistLinks.entryId,
        secretHash: waitlistLinks.secretHash,
        revokedAt: waitlistLinks.revokedAt,
        leaveKey: waitlistLinks.leaveKey,
        live: sql<boolean>`${waitlistLinks.expiresAt} > now()`,
      })
      .from(waitlistLinks)
      .where(eq(waitlistLinks.id, id!))
      .limit(1)
  )[0];
  const same = compare(digest(secret!), row ? Buffer.from(row.secretHash, "hex") : DUMMY_HASH);
  if (!row || !same || !row.live) return null;
  const { secretHash: _hash, live: _live, ...link } = row;
  return link;
}

/** The guest view of one public entry (`PublicWaitlistEntry`), or null when the entry is gone. */
export async function waitlistGuestView(db: Db, target: PublicVenue, entryId: string) {
  const row = (
    await db
      .select({ entry: waitlist, expiresAt: waitlistLinks.expiresAt })
      .from(waitlist)
      .leftJoin(waitlistLinks, eq(waitlistLinks.entryId, waitlist.id))
      .where(and(eq(waitlist.id, entryId), eq(waitlist.venueId, target.venue.id)))
      .limit(1)
  )[0];
  const date = row?.entry.date;
  if (!row || !date) return null;
  const { entry } = row;
  return {
    venue: venueView(target),
    date,
    window: entry.windowStart && entry.windowEnd ? { from: entry.windowStart, to: entry.windowEnd } : null,
    partySize: entry.partySize,
    status: entry.status,
    guest: { contact: maskContact(entry.guestContact.trim().toLowerCase()) },
    linkExpiresAt: (row.expiresAt ?? endOfDate(date, target.venue.timezone)).toISOString(),
  };
}

export type LeaveResult = { ok: true } | { ok: false; code: "invalid_request" | "self_service_link_invalid" | "invalid_transition" };

/**
 * The guest leave (C75): the staff cancel's write and the link's revocation in one transaction, under the key, then
 * the entry's row lock, the order the staff cancel, the seat and erasure take. A repeat of the key returns the stored
 * result and writes nothing. A key of another kind fails with `invalid_request`.
 */
export async function leaveWaitlist(db: Db, link: WaitlistLink, key: string): Promise<LeaveResult> {
  return db.transaction(async (tx): Promise<LeaveResult> => {
    const stored = await claimKey(tx, link.venueId, key);
    if (stored) {
      if (stored.kind !== LEAVE_KIND || stored.reservationId !== link.entryId) return { ok: false, code: "invalid_request" };
      return { ok: true };
    }
    const [entry] = await tx
      .select({ status: waitlist.status })
      .from(waitlist)
      .where(and(eq(waitlist.venueId, link.venueId), eq(waitlist.id, link.entryId)))
      .for("update");
    if (!entry) return { ok: false, code: "self_service_link_invalid" };
    // Read again under the entry's lock: a leave with another key may have revoked the link since the lookup.
    const [current] = await tx
      .select({ revokedAt: waitlistLinks.revokedAt })
      .from(waitlistLinks)
      .where(eq(waitlistLinks.id, link.id));
    if (!current || current.revokedAt) return { ok: false, code: "self_service_link_invalid" };
    if (entry.status !== "waiting") return { ok: false, code: "invalid_transition" };
    await markCancelled(tx, link.venueId, link.entryId);
    await tx
      .update(waitlistLinks)
      .set({ revokedAt: sql`now()`, leaveKey: key })
      .where(and(eq(waitlistLinks.id, link.id), isNull(waitlistLinks.revokedAt)));
    await tx.insert(idempotencyKeys).values({ key, venueId: link.venueId, reservationId: link.entryId, kind: LEAVE_KIND, version: 1 });
    return { ok: true };
  });
}

/** The leave link (C70): `/r/waitlist?lang=<locale>#<token>` on the widget origin. */
export function leaveUrl(origin: string, token: string, lang: string): string {
  const url = new URL("/r/waitlist", origin);
  url.searchParams.set("lang", lang);
  url.hash = token;
  return url.href;
}

/**
 * The one email of a join, sent after the commit. Its text follows the join's `locale`, then the venue's, then `es`,
 * and the link's `lang` is the join's `locale` or the venue's (C67). It never throws and never logs the token: a failed
 * send leaves the entry and the answer as they are (C70).
 */
export async function sendJoinEmail(
  db: Db,
  { venue, settings }: PublicVenue,
  input: Pick<WaitlistJoin, "date" | "window" | "partySize" | "contact" | "locale">,
  token: string,
  origin: string | null,
): Promise<void> {
  try {
    if (origin === null || !canResend(venue, origin)) return;
    if (!(await mayEmail(db, venue.id, input.contact))) return;
    const { subject, text, html } = buildWaitlistJoinEmail(
      { date: input.date, window: input.window, partySize: input.partySize, url: leaveUrl(origin, token, input.locale ?? settings.locale) },
      resolveEmailLocale(input.locale, settings.locale),
      emailVenue(venue, settings.theme),
    );
    const identity = await mailIdentity(db, venue.id, venue);
    await sendEmail(identity.apiKey, identity.from, input.contact, subject, text, html);
  } catch (err) {
    // The message only: a provider's answer could quote the email, and the email holds the token.
    console.error("notification waitlist_join failed:", err instanceof Error ? err.message.split(":")[0] : "unknown");
  }
}
