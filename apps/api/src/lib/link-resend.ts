import { and, asc, eq, gt, sql } from "drizzle-orm";
import { reservations, sentEmails, venues } from "../db/schema";
import { mayEmail } from "../demo/limits";
import { normalizeContact } from "./contact";
import { buildLinkEmail, canSendEmail, sendEmail, type LinkLine } from "./mailer";
import type { PublicVenue } from "./public-booking";
import { rotateLink } from "./self-service";
import { formatTime } from "./time";
import type { Db } from "./venue";

/**
 * The lost-link resend (ADR-0017 stage 12, amendment of 2026-11-17). Anyone can name an address, so the route
 * must not become a way to mail a stranger on demand. For one address in one venue, at most one email every
 * `intervalMinutes`. Each reservation is in at most `perReservation` of them, ever. One email names at most
 * `perEmail` bookings, the earliest first. A booking left out keeps its link.
 */
export const LINK_RESEND = { intervalMinutes: 15, perReservation: 3, perEmail: 5 } as const;

/** The `sent_emails` kind of a resend. Its `version` counts the resends of that reservation, 1 to `perReservation`. */
export const RESEND_KIND = "self_service_link_resend";

/** The normalized email of a resend body (REQ-G2), or null for anything the route answers with `invalid_request`. */
export function parseResendEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { email } = body as Record<string, unknown>;
  if (typeof email !== "string" || email.length > 254 || !email.includes("@")) return null;
  const key = normalizeContact(email, null);
  return key?.kind === "email" ? key.value : null;
}

type Venue = typeof venues.$inferSelect;

/** Whether a resend could send anything for this venue: email on, a way to send it, and a widget to link to. */
export function canResend(venue: Venue, origin: string | null): origin is string {
  return venue.notificationsEnabled && origin !== null && canSendEmail(venue.resendApiKey, venue.fromEmail);
}

function linkUrl(origin: string, token: string, lang: string): string {
  const url = new URL("/r", origin);
  url.searchParams.set("lang", lang);
  url.hash = token;
  return url.href;
}

/**
 * Rotates the links of the venue's future `booked` bookings whose contact normalizes to `email`, and mails the new
 * links to the address stored on the booking. Runs after the answer, so it never throws and logs no token.
 */
export async function resendLinks(db: Db, { venue, settings }: PublicVenue, email: string, origin: string | null) {
  if (!canResend(venue, origin)) return;
  try {
    const mail = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`link-resend:${venue.id}:${email}`}, 0))`);
      const ledger = and(
        sql`${sentEmails.venueId} = ${reservations.venueId}`,
        sql`${sentEmails.reservationId} = ${reservations.id}`,
        eq(sentEmails.kind, RESEND_KIND),
      );
      const rows = await tx
        .select({
          id: reservations.id,
          date: reservations.date,
          startsAt: reservations.startsAt,
          partySize: reservations.partySize,
          contact: reservations.guestContact,
          sent: sql<number>`(select count(*)::int from ${sentEmails} where ${ledger})`,
          recent: sql<boolean>`exists (select 1 from ${sentEmails} where ${ledger} and ${sentEmails.createdAt} > now() - make_interval(mins => ${LINK_RESEND.intervalMinutes}))`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.venueId, venue.id),
            eq(reservations.status, "booked"),
            eq(reservations.erased, false),
            gt(reservations.startsAt, sql`now()`),
            sql`lower(normalize(btrim(${reservations.guestContact}), NFC)) = ${email}`,
          ),
        )
        .orderBy(asc(reservations.startsAt), asc(reservations.id))
        .for("update");
      const matched = rows.filter((row) => normalizeContact(row.contact, null)?.value === email);
      if (matched.some((row) => row.recent)) return null;
      const lines: LinkLine[] = [];
      let to = "";
      for (const row of matched.filter((r) => r.sent < LINK_RESEND.perReservation).slice(0, LINK_RESEND.perEmail)) {
        const link = await rotateLink(tx, venue.id, row.id);
        if (!link) continue;
        await tx
          .insert(sentEmails)
          .values({ id: crypto.randomUUID(), venueId: venue.id, reservationId: row.id, kind: RESEND_KIND, version: row.sent + 1 });
        lines.push({
          date: row.date,
          time: formatTime(row.startsAt, venue.timezone),
          partySize: row.partySize,
          url: linkUrl(origin, link.token, settings.locale),
        });
        to ||= row.contact.trim();
      }
      return lines.length > 0 ? { to, lines } : null;
    });
    if (!mail) return;
    if (!(await mayEmail(db, venue.id, mail.to))) return;
    const { subject, text } = buildLinkEmail(mail.lines);
    await sendEmail(venue.resendApiKey ?? "", venue.fromEmail, mail.to, subject, text);
  } catch (err) {
    // The message only: a provider's answer could quote the email, and the email holds tokens.
    console.error("notification self_service_link failed:", err instanceof Error ? err.message.split(":")[0] : "unknown");
  }
}
