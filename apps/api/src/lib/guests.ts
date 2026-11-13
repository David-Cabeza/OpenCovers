import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { guestAudit, guests, idempotencyKeys, reservations, venues, type GuestSnapshot } from "../db/schema";
import * as schema from "../db/schema";
import { normalizeContact, venueCountry, type ContactKey } from "./contact";

export type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Guest = typeof guests.$inferSelect;

export type GuestError =
  | "invalid_request"
  | "guest_not_found"
  | "guest_merged"
  | "guest_not_merged"
  | "unmerge_unavailable";

export type GuestWrite = { ok: true; guestId: string } | { ok: false; code: GuestError };

export interface GuestSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  lastVisitAt: string;
}

export interface GuestDetail extends GuestSummary {
  visitCount: number;
  firstVisitAt: string | null;
  reservations: { id: string; status: string }[];
  mergedGuests: Omit<GuestSummary, "lastVisitAt">[];
}

export interface GuestCursor {
  lastVisitAt: Date;
  id: string;
}

class GuestFailure extends Error {
  constructor(readonly code: GuestError) {
    super(code);
  }
}

const holdsPersonalData = or(isNotNull(guests.email), isNotNull(guests.phone), ne(guests.name, ""));

function isCleared(g: Guest): boolean {
  return g.email === null && g.phone === null && g.name === "";
}

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
    .returning({ id: guests.id, mergedInto: guests.mergedInto, inserted: sql<boolean>`(xmax = 0)` });
  if (row.inserted) {
    await tx.insert(guestAudit).values({ venueId, guestId: row.id, action: "created", principal: actor });
  }
  if (!row.mergedInto) return { id: row.id, created: row.inserted };
  let rootId = row.mergedInto;
  for (;;) {
    const [next] = await tx
      .select({ mergedInto: guests.mergedInto })
      .from(guests)
      .where(and(eq(guests.venueId, venueId), eq(guests.id, rootId)));
    if (!next?.mergedInto) break;
    rootId = next.mergedInto;
  }
  await tx
    .update(guests)
    .set({ lastVisitAt: sql`greatest(${guests.lastVisitAt}, ${visitAt.toISOString()}::timestamptz)` })
    .where(and(eq(guests.venueId, venueId), eq(guests.id, rootId)));
  return { id: rootId, created: false };
}

export function encodeGuestCursor(venueId: string, cursor: GuestCursor): string {
  return `${venueId}:${cursor.lastVisitAt.getTime()}:${cursor.id}`;
}

export function decodeGuestCursor(venueId: string, raw: string): GuestCursor | null {
  const prefix = `${venueId}:`;
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  const sep = rest.indexOf(":");
  const millis = Number(rest.slice(0, sep));
  const id = rest.slice(sep + 1);
  if (sep < 1 || !Number.isSafeInteger(millis) || id === "") return null;
  return { lastVisitAt: new Date(millis), id };
}

export async function listGuests(
  db: Db,
  venueId: string,
  filter: { contact?: string; namePrefix?: string; after?: GuestCursor; limit: number },
): Promise<{ guests: GuestSummary[]; next: GuestCursor | null }> {
  const conditions: (SQL | undefined)[] = [eq(guests.venueId, venueId), isNull(guests.mergedInto), holdsPersonalData];
  if (filter.contact !== undefined) {
    const [venue] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
    const key = venue ? normalizeContact(filter.contact, venueCountry(venue)) : null;
    if (!key) return { guests: [], next: null };
    conditions.push(eq(key.kind === "email" ? guests.email : guests.phone, key.value));
  }
  if (filter.namePrefix) {
    conditions.push(ilike(guests.name, `${filter.namePrefix.replace(/[\\%_]/g, "\\$&")}%`));
  }
  if (filter.after) {
    const { lastVisitAt, id } = filter.after;
    conditions.push(or(lt(guests.lastVisitAt, lastVisitAt), and(eq(guests.lastVisitAt, lastVisitAt), gt(guests.id, id))));
  }
  const rows = await db
    .select()
    .from(guests)
    .where(and(...conditions))
    .orderBy(desc(guests.lastVisitAt), guests.id)
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return {
    guests: page.map(toSummary),
    next: rows.length > filter.limit ? { lastVisitAt: last.lastVisitAt, id: last.id } : null,
  };
}

export async function getGuest(db: Db, venueId: string, id: string): Promise<GuestDetail | null> {
  const [guest] = await db
    .select()
    .from(guests)
    .where(and(eq(guests.venueId, venueId), eq(guests.id, id), isNull(guests.mergedInto), holdsPersonalData))
    .limit(1);
  if (!guest) return null;
  const held = await db
    .select({ id: reservations.id, status: reservations.status, startsAt: reservations.startsAt })
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), eq(reservations.guestId, id)))
    .orderBy(reservations.startsAt, reservations.id);
  const absorbed = await db
    .select()
    .from(guests)
    .where(and(eq(guests.venueId, venueId), eq(guests.mergedInto, id)))
    .orderBy(guests.id);
  return {
    ...toSummary(guest),
    visitCount: held.length,
    firstVisitAt: held[0]?.startsAt.toISOString() ?? null,
    reservations: held.map((r) => ({ id: r.id, status: r.status })),
    mergedGuests: absorbed.map((g) => ({ id: g.id, name: g.name, email: g.email, phone: g.phone })),
  };
}

export async function mergeGuest(
  db: Db,
  venueId: string,
  sourceId: string,
  targetId: string,
  key: string,
  actor: string,
): Promise<GuestWrite> {
  if (sourceId === targetId) return { ok: false, code: "invalid_request" };
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(guests)
        .where(and(eq(guests.venueId, venueId), inArray(guests.id, [sourceId, targetId])))
        .orderBy(guests.id)
        .for("update");
      const [replay] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, key)))
        .limit(1);
      if (replay) {
        if (replay.kind !== "guest_merge" || replay.reservationId !== sourceId) {
          throw new GuestFailure("invalid_request");
        }
        const [entry] = await tx
          .select({ targetGuestId: guestAudit.targetGuestId })
          .from(guestAudit)
          .where(and(eq(guestAudit.venueId, venueId), eq(guestAudit.id, replay.version)));
        if (entry?.targetGuestId !== targetId) throw new GuestFailure("invalid_request");
        return { ok: true as const, guestId: targetId };
      }
      const source = locked.find((g) => g.id === sourceId);
      const target = locked.find((g) => g.id === targetId);
      if (!source || !target || isCleared(source) || isCleared(target)) {
        throw new GuestFailure("guest_not_found");
      }
      if (source.mergedInto || target.mergedInto) throw new GuestFailure("guest_merged");

      const moved = await tx
        .update(reservations)
        .set({ guestId: targetId })
        .where(and(eq(reservations.venueId, venueId), eq(reservations.guestId, sourceId)))
        .returning({ id: reservations.id });
      await tx
        .update(guests)
        .set({ mergedInto: targetId })
        .where(and(eq(guests.venueId, venueId), eq(guests.id, sourceId)));
      if (source.lastVisitAt > target.lastVisitAt) {
        await tx
          .update(guests)
          .set({ lastVisitAt: source.lastVisitAt })
          .where(and(eq(guests.venueId, venueId), eq(guests.id, targetId)));
      }
      const [entry] = await tx
        .insert(guestAudit)
        .values({
          venueId,
          guestId: sourceId,
          action: "merged",
          principal: actor,
          targetGuestId: targetId,
          priorState: snapshot(source),
          reservationIds: moved.map((r) => r.id),
        })
        .returning({ id: guestAudit.id });
      await tx
        .insert(idempotencyKeys)
        .values({ key, venueId, reservationId: sourceId, kind: "guest_merge", version: entry.id });
      return { ok: true as const, guestId: targetId };
    });
  } catch (error) {
    if (error instanceof GuestFailure) return { ok: false, code: error.code };
    throw error;
  }
}

export async function unmergeGuest(db: Db, venueId: string, guestId: string, actor: string): Promise<GuestWrite> {
  try {
    return await db.transaction(async (tx) => {
      // Absorbed before target, the order the booking path locks a merged chain in.
      const [source] = await tx
        .select()
        .from(guests)
        .where(and(eq(guests.venueId, venueId), eq(guests.id, guestId)))
        .for("update");
      if (!source) throw new GuestFailure("guest_not_found");
      if (!source.mergedInto) throw new GuestFailure("guest_not_merged");
      const [target] = await tx
        .select()
        .from(guests)
        .where(and(eq(guests.venueId, venueId), eq(guests.id, source.mergedInto)))
        .for("update");
      const [entry] = await tx
        .select()
        .from(guestAudit)
        .where(and(eq(guestAudit.venueId, venueId), eq(guestAudit.guestId, guestId), eq(guestAudit.action, "merged")))
        .orderBy(desc(guestAudit.id))
        .limit(1);
      if (!target || !entry?.priorState) throw new GuestFailure("unmerge_unavailable");
      if (target.mergedInto) throw new GuestFailure("guest_merged");

      const ids = entry.reservationIds ?? [];
      const restored =
        ids.length > 0
          ? await tx
              .update(reservations)
              .set({ guestId })
              .where(
                and(eq(reservations.venueId, venueId), inArray(reservations.id, ids), eq(reservations.guestId, target.id)),
              )
              .returning({ id: reservations.id })
          : [];
      const prior = entry.priorState;
      await tx
        .update(guests)
        .set({
          mergedInto: null,
          email: prior.email,
          phone: prior.phone,
          name: prior.name,
          lastVisitAt: (await latestVisit(tx, venueId, guestId)) ?? new Date(prior.lastVisitAt),
        })
        .where(and(eq(guests.venueId, venueId), eq(guests.id, guestId)));
      await tx
        .update(guests)
        .set({ lastVisitAt: (await latestVisit(tx, venueId, target.id)) ?? target.lastVisitAt })
        .where(and(eq(guests.venueId, venueId), eq(guests.id, target.id)));
      await tx.update(guestAudit).set({ priorState: null }).where(eq(guestAudit.id, entry.id));
      await tx.insert(guestAudit).values({
        venueId,
        guestId,
        action: "unmerged",
        principal: actor,
        targetGuestId: target.id,
        reservationIds: restored.map((r) => r.id),
      });
      return { ok: true as const, guestId };
    });
  } catch (error) {
    if (error instanceof GuestFailure) return { ok: false, code: error.code };
    throw error;
  }
}

export async function forgetMergeState(tx: DbTx, venueId: string, guestIds: string[]): Promise<void> {
  if (guestIds.length === 0) return;
  await tx
    .update(guestAudit)
    .set({ priorState: null })
    .where(
      and(
        eq(guestAudit.venueId, venueId),
        isNotNull(guestAudit.priorState),
        or(inArray(guestAudit.guestId, guestIds), inArray(guestAudit.targetGuestId, guestIds)),
      ),
    );
}

export async function movedAtMerge(tx: DbTx, venueId: string, absorbed: Guest[]): Promise<string[]> {
  const ids = absorbed.filter((g) => g.mergedInto).map((g) => g.id);
  if (ids.length === 0) return [];
  const entries = await tx
    .select({ reservationIds: guestAudit.reservationIds })
    .from(guestAudit)
    .where(
      and(
        eq(guestAudit.venueId, venueId),
        eq(guestAudit.action, "merged"),
        inArray(guestAudit.guestId, ids),
        isNotNull(guestAudit.priorState),
      ),
    );
  return entries.flatMap((e) => e.reservationIds ?? []);
}

async function latestVisit(tx: DbTx, venueId: string, guestId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ at: sql<string | null>`max(${reservations.startsAt})` })
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), eq(reservations.guestId, guestId)));
  return row?.at ? new Date(row.at) : null;
}

function snapshot(g: Guest): GuestSnapshot {
  return { email: g.email, phone: g.phone, name: g.name, lastVisitAt: g.lastVisitAt.toISOString() };
}

function toSummary(g: Guest): GuestSummary {
  return { id: g.id, name: g.name, email: g.email, phone: g.phone, lastVisitAt: g.lastVisitAt.toISOString() };
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
