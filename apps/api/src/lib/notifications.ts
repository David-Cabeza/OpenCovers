import { and, count, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { reservations, sentEmails, venues } from "../db/schema";
import * as schema from "../db/schema";
import { mailIdentity, mayEmail } from "../demo/limits";
import { resolveEmailLocale } from "./email-messages";
import { emailVenue } from "./email-venue";
import { icsUid } from "./ics";
import { loggable } from "./loggable";
import { getOnlineBooking } from "./online-booking";
import { buildEmail, sendEmail, type EmailKind } from "./mailer";
import { formatTime } from "./time";

export type Db = NodePgDatabase<typeof schema>;

/**
 * The limit on confirmations a guest's own modify sends (ADR-0017, amendment of 2026-11-17). Anyone holding a
 * link can change the party, so without it a link would send mail to the booking's contact on demand. Each
 * reservation gets at most `perReservation` of them, at least `intervalMinutes` apart. A modify past the limit
 * still succeeds and answers the same, so the guest cannot tell. A staff change's confirmation counts toward the
 * limit, so a guest gets no more mail in all, but a staff send is never held back by it.
 */
export const GUEST_MODIFY_EMAILS = { intervalMinutes: 15, perReservation: 3 } as const;

export interface NotifyOptions {
  guestModify?: boolean;
}

export async function notifyReservation(
  db: Db,
  venueId: string,
  reservationId: string,
  version: number,
  kind: EmailKind,
  { guestModify = false }: NotifyOptions = {},
): Promise<void> {
  try {
    const venue = (
      await db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
    )[0];
    if (!venue || !venue.notificationsEnabled) return;

    const reservation = (
      await db
        .select()
        .from(reservations)
        .where(
          and(eq(reservations.id, reservationId), eq(reservations.venueId, venueId)),
        )
        .limit(1)
    )[0];
    if (!reservation) return;

    const to = kind === "notice" ? venue.noticeAddress : reservation.guestContact;
    if (!to) return;
    if (!(await mayEmail(db, venueId, to))) return;

    const already = (
      await db
        .select()
        .from(sentEmails)
        .where(
          and(
            eq(sentEmails.venueId, venueId),
            eq(sentEmails.reservationId, reservationId),
            eq(sentEmails.kind, kind),
            eq(sentEmails.version, version),
          ),
        )
        .limit(1)
    )[0];
    if (already) return;
    if (guestModify && !(await claimGuestModify(db, venueId, reservationId, version))) return;

    const online = await getOnlineBooking(db, venueId);
    const locale = resolveEmailLocale(reservation.guestLocale, online?.locale);
    const { subject, text, html, attachments } = buildEmail(
      kind,
      {
        venue: emailVenue(venue, online?.theme),
        date: reservation.date,
        time: formatTime(reservation.startsAt, venue.timezone),
        partySize: reservation.partySize,
        service: reservation.service,
        ...(kind === "notice" ? { guestName: reservation.guestName } : {}),
        booking: { uid: icsUid(venueId, reservationId), version, startsAt: reservation.startsAt, endsAt: reservation.endsAt },
      },
      locale,
    );
    const identity = await mailIdentity(db, venueId, venue);
    await sendEmail(identity.apiKey, identity.from, to, subject, text, html, attachments);
    await db
      .insert(sentEmails)
      .values({ id: crypto.randomUUID(), venueId, reservationId, kind, version })
      .onConflictDoNothing();
  } catch (err) {
    console.error(`notification ${kind} failed`, loggable(err));
  }
}

/** Records the guest-modify confirmation before it is sent, so concurrent modifies cannot both pass the limit. */
async function claimGuestModify(db: Db, venueId: string, reservationId: string, version: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guest-modify-email:${venueId}:${reservationId}`}, 0))`);
    const [prior] = await tx
      .select({
        sent: count(),
        recent: sql<boolean>`coalesce(max(${sentEmails.createdAt}) > now() - make_interval(mins => ${GUEST_MODIFY_EMAILS.intervalMinutes}), false)`,
      })
      .from(sentEmails)
      .where(
        and(
          eq(sentEmails.venueId, venueId),
          eq(sentEmails.reservationId, reservationId),
          eq(sentEmails.kind, "confirmation"),
          gt(sentEmails.version, 1),
        ),
      );
    if (prior.sent >= GUEST_MODIFY_EMAILS.perReservation || prior.recent) return false;
    const claimed = await tx
      .insert(sentEmails)
      .values({ id: crypto.randomUUID(), venueId, reservationId, kind: "confirmation", version })
      .onConflictDoNothing()
      .returning({ id: sentEmails.id });
    return claimed.length === 1;
  });
}
