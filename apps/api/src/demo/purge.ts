import { sql } from "drizzle-orm";
import type { Db } from "../lib/venue";

/**
 * Tables that hold a `venue_id` and do not cascade from `venues`, children first. A test compares this list with
 * the live schema, so a new venue table that is missing here fails the build instead of blocking a cleanup.
 */
export const VENUE_TABLES_IN_DELETE_ORDER = [
  "self_service_links",
  "table_allocations",
  "sent_emails",
  "events",
  "tombstones",
  "idempotency_keys",
  "guest_audit",
  "waitlist",
  "reservations",
  "guests",
  "webhook_endpoints",
  "floor_items",
  "tables",
  "services",
] as const;

/**
 * Deletes a venue and everything it holds: bookings, guests, tables, services, keys, memberships. Used for sandboxes
 * only. A real venue is erased through the erasure route, which keeps hashes.
 */
export async function purgeVenue(db: Db, venueId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of VENUE_TABLES_IN_DELETE_ORDER) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE venue_id = ${venueId}`);
    }
    // Keys made for this venue only. A key also granted elsewhere stays.
    const granted = await tx.execute<{ key_hash: string }>(
      sql`DELETE FROM grants WHERE venue_id = ${venueId} RETURNING key_hash`,
    );
    for (const { key_hash } of granted.rows) {
      await tx.execute(sql`
        DELETE FROM api_keys
        WHERE hash = ${key_hash} AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.key_hash = api_keys.hash)
      `);
    }
    // Memberships, invitations, the blocklist, online booking and the audit log cascade from the venue row.
    await tx.execute(sql`DELETE FROM venues WHERE id = ${venueId}`);
  });
}
