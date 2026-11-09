import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { venueMemberships, venues } from "../db/schema";
import * as schema from "../db/schema";

export type Db = NodePgDatabase<typeof schema>;
export type Role = "read" | "write" | "admin";

export async function addMembership(
  db: Db,
  userId: string,
  venueId: string,
  role: Role = "read",
): Promise<void> {
  await db
    .insert(venueMemberships)
    .values({ userId, venueId, role })
    .onConflictDoUpdate({ target: [venueMemberships.userId, venueMemberships.venueId], set: { role } });
}

export async function getMembership(
  db: Db,
  userId: string,
  venueId: string,
): Promise<{ venueId: string; role: Role } | null> {
  const row = (
    await db
      .select()
      .from(venueMemberships)
      .where(
        and(
          eq(venueMemberships.userId, userId),
          eq(venueMemberships.venueId, venueId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return null;
  return { venueId: row.venueId, role: row.role as Role };
}

export async function listVenuesForUser(db: Db, userId: string) {
  return db
    .select({
      id: venues.id,
      name: venues.name,
      timezone: venues.timezone,
      enabled: venues.enabled,
      role: venueMemberships.role,
    })
    .from(venueMemberships)
    .innerJoin(venues, eq(venues.id, venueMemberships.venueId))
    .where(eq(venueMemberships.userId, userId))
    .orderBy(venues.name);
}
