import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { reservations, sentEmails, venues } from "../db/schema";
import * as schema from "../db/schema";
import { buildEmail, sendEmail, type EmailKind } from "./mailer";
import { formatTime } from "./time";

export type Db = NodePgDatabase<typeof schema>;

export async function notifyReservation(
  db: Db,
  venueId: string,
  reservationId: string,
  version: number,
  kind: EmailKind,
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

    const { subject, text } = buildEmail(kind, {
      date: reservation.date,
      time: formatTime(reservation.startsAt, venue.timezone),
      partySize: reservation.partySize,
      guestName: reservation.guestName,
      service: reservation.service,
    });
    await sendEmail(to, subject, text);
    await db
      .insert(sentEmails)
      .values({ id: crypto.randomUUID(), venueId, reservationId, kind, version })
      .onConflictDoNothing();
  } catch (err) {
    console.error(`notification ${kind} failed`, err);
  }
}
