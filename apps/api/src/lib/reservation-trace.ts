import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { events, idempotencyKeys, reservations, user } from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

export type TraceSource = "widget" | "staff" | "api";

export interface TraceEntry {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
}

export interface ReservationTrace {
  reservationId: string;
  source: TraceSource;
  actor: string;
  entries: TraceEntry[];
}

// The write kind that stores the idempotency key behind each event type. `erased` has none.
const KEY_KIND: Record<string, string> = {
  created: "create",
  modified: "modify",
  cancelled: "cancel",
  seated: "status",
  attended: "status",
  no_show: "status",
};

/**
 * `bookedVia` holds the principal of the channel: `widget` for the public channel, a member's email for a session
 * and the key's principal for an API key. The MCP server uses an API key, so it reads as `api`.
 */
async function sourceOf(db: Db, bookedVia: string): Promise<TraceSource> {
  if (bookedVia === "widget") return "widget";
  const member = (await db.select({ id: user.id }).from(user).where(eq(user.email, bookedVia)).limit(1))[0];
  return member ? "staff" : "api";
}

export async function getReservationTrace(
  db: Db,
  venueId: string,
  reservationId: string,
): Promise<ReservationTrace | null> {
  const reservation = (
    await db
      .select({ bookedVia: reservations.bookedVia })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.venueId, venueId)))
      .limit(1)
  )[0];
  if (!reservation) return null;

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.venueId, venueId), eq(events.reservationId, reservationId)))
    .orderBy(events.id);
  const keys = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.venueId, venueId),
        eq(idempotencyKeys.reservationId, reservationId),
        inArray(idempotencyKeys.kind, Object.values(KEY_KIND)),
      ),
    );
  const source = await sourceOf(db, reservation.bookedVia);
  // The public channel stores its client's key under a `public:` prefix, so the trace shows the key the client sent.
  const shown = (key: string) => (source === "widget" ? key.replace(/^public:/, "") : key);
  const keyOf = (type: string, version: number) => {
    const found = keys.find((k) => k.kind === KEY_KIND[type] && k.version === version);
    return found ? shown(found.key) : null;
  };

  return {
    reservationId,
    source,
    actor: reservation.bookedVia,
    entries: rows.map((e) => ({
      eventId: String(e.id),
      type: e.type,
      version: e.version,
      occurredAt: e.occurredAt.toISOString(),
      idempotencyKey: keyOf(e.type, e.version),
    })),
  };
}
