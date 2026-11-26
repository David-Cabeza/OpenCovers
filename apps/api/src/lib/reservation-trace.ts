import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { events, idempotencyKeys, reservations, user, venueMemberships } from "../db/schema";
import type { EventChannel } from "./origin";

type Db = NodePgDatabase<typeof schema>;

/** The booking's creator, read from `bookedVia`. Internal: it only derives the channel of a `created` event with no stored origin. */
type TraceSource = "widget" | "staff" | "api";

export interface TraceEntry {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
  /** Read from the event. Null: stored without an origin and not derivable. */
  channel: EventChannel | null;
  /** A label, never an email or an id: a member's display name, or a key reference. Null for a guest or unknown. */
  actor: string | null;
  /** False when the event has no stored origin; `channel` is then derived from `bookedVia` (created) or null. */
  recorded: boolean;
}

export interface ReservationTrace {
  reservationId: string;
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

/** A staff user id is shown by display name, only for a member of this venue. A name that looks like an email is dropped. */
export async function memberNames(db: Db, venueId: string, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(venueMemberships)
    .innerJoin(user, eq(user.id, venueMemberships.userId))
    .where(and(eq(venueMemberships.venueId, venueId), inArray(venueMemberships.userId, userIds), isNotNull(user.name)));
  return new Map(rows.filter((r) => r.name.trim() !== "" && !r.name.includes("@")).map((r) => [r.id, r.name]));
}

/** The `actor` label of a recorded origin: a member's display name, a key id, or null for a guest or unknown. */
export function actorLabel(channel: EventChannel | null, actor: string | null, names: Map<string, string>): string | null {
  if (channel === "staff") return actor ? (names.get(actor) ?? null) : null;
  return channel ? actor : null;
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
  const names = await memberNames(
    db,
    venueId,
    rows.filter((e) => e.channel === "staff" && e.actor).map((e) => e.actor as string),
  );
  // The public channel stores its client's key under a `public:` prefix, so the trace shows the key the client sent.
  // A guest's cancel of a booking an API key made is public too, so the prefix goes by the entry, not the booking.
  const keyOf = (type: string, version: number, viaWidget: boolean) => {
    const found = keys.find((k) => k.kind === KEY_KIND[type] && k.version === version);
    return found ? (viaWidget ? found.key.replace(/^public:/, "") : found.key) : null;
  };

  return {
    reservationId,
    entries: rows.map((e) => ({
      eventId: String(e.id),
      type: e.type,
      version: e.version,
      occurredAt: e.occurredAt.toISOString(),
      idempotencyKey: keyOf(e.type, e.version, e.channel === "widget" || (e.channel === null && source === "widget")),
      channel: (e.channel as EventChannel | null) ?? (e.type === "created" ? source : null),
      actor: actorLabel(e.channel as EventChannel | null, e.actor, names),
      recorded: e.channel !== null,
    })),
  };
}
