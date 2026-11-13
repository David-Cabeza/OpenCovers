import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { guestAudit, guests, reservations, venues } from "../db/schema";
import * as schema from "../db/schema";
import { normalizeContact, venueCountry, type ContactKey } from "./contact";

export type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function linkGuest(
  tx: DbTx,
  venueId: string,
  key: ContactKey,
  name: string,
  visitAt: Date,
  actor: string,
): Promise<{ id: string; created: boolean }> {
  const column = key.kind === "email" ? guests.email : guests.phone;
  const [row] = await tx
    .insert(guests)
    .values({
      id: crypto.randomUUID(),
      venueId,
      [key.kind]: key.value,
      name,
      lastVisitAt: visitAt,
    })
    .onConflictDoUpdate({
      target: [guests.venueId, column],
      set: {
        lastVisitAt: sql`greatest(${guests.lastVisitAt}, excluded.last_visit_at)`,
        name: sql`case when ${guests.name} = '' then excluded.name else ${guests.name} end`,
      },
    })
    .returning({ id: guests.id, inserted: sql<boolean>`(xmax = 0)` });
  if (row.inserted) {
    await tx.insert(guestAudit).values({ venueId, guestId: row.id, action: "created", principal: actor });
  }
  return { id: row.id, created: row.inserted };
}

export interface BackfillResult {
  createdGuests: number;
  linkedReservations: number;
}

export async function backfillGuests(db: Db): Promise<BackfillResult> {
  const result: BackfillResult = { createdGuests: 0, linkedReservations: 0 };
  for (const venue of await db.select().from(venues)) {
    const country = venueCountry(venue);
    const rows = await db
      .select({
        id: reservations.id,
        guestName: reservations.guestName,
        guestContact: reservations.guestContact,
        startsAt: reservations.startsAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, venue.id),
          eq(reservations.erased, false),
          ne(reservations.guestContact, ""),
          isNull(reservations.guestId),
        ),
      )
      .orderBy(sql`${reservations.startsAt} desc`);
    const groups = new Map<string, { key: ContactKey; name: string; visitAt: Date; ids: string[] }>();
    for (const row of rows) {
      const key = normalizeContact(row.guestContact, country);
      if (!key) continue;
      const id = `${key.kind}:${key.value}`;
      const group = groups.get(id) ?? { key, name: "", visitAt: row.startsAt, ids: [] };
      if (group.name === "") group.name = row.guestName;
      group.ids.push(row.id);
      groups.set(id, group);
    }
    for (const group of groups.values()) {
      await db.transaction(async (tx) => {
        const guest = await linkGuest(tx, venue.id, group.key, group.name, group.visitAt, "backfill");
        if (guest.created) result.createdGuests += 1;
        const linked = await tx
          .update(reservations)
          .set({ guestId: guest.id })
          .where(and(eq(reservations.venueId, venue.id), inArray(reservations.id, group.ids), isNull(reservations.guestId)))
          .returning({ id: reservations.id });
        result.linkedReservations += linked.length;
      });
    }
  }
  return result;
}
