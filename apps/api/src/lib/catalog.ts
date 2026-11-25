import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { services, tables, venues } from "../db/schema";
import * as schema from "../db/schema";
import { enforceSandboxCap } from "../demo/limits";
import { integer, oneOf, optional, text } from "./body";

export type Db = NodePgDatabase<typeof schema>;

export interface TableInfo {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
  posX: number;
  posY: number;
  rotation: number;
}

export interface ServiceInfo {
  name: string;
  openStart: string;
  openEnd: string;
  minPartySize?: number;
  maxPartySize?: number;
  /** ISO weekdays (1 Monday to 7 Sunday) the service opens on, ascending. */
  days: number[];
}

export interface ServiceInput {
  name: string;
  openStart: string;
  openEnd: string;
  minPartySize?: number | null;
  maxPartySize?: number | null;
  days?: number[];
}

export const ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** A non-empty list of distinct ISO weekdays, 1 to 7. Returns it sorted, or null when invalid. */
export function parseDays(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) return null;
  if (!value.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return null;
  if (new Set(value).size !== value.length) return null;
  return [...(value as number[])].sort((a, b) => a - b);
}

// `rect` is the older name of `rectangle`, still in stored data and the demo template.
const TABLE_SHAPES = ["round", "oval", "square", "rectangle", "long", "rect"] as const;

// Starts with a letter or digit, so an id is never `.` or `..` in a URL path.
const TABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const TABLE_FIELDS = {
  id: text(64, TABLE_ID),
  name: text(80, /\S/),
  seats: integer(1, 200),
  zone: optional(text(80)),
  shape: optional(oneOf(TABLE_SHAPES)),
};

export const TABLE_LAYOUT_FIELDS = {
  x: optional(integer(0, 10_000)),
  y: optional(integer(0, 10_000)),
  rotation: optional(integer(0, 359)),
};

type VenueNotFound = { ok: false; code: "venue_not_found" };

export async function venueExists(db: Db, venueId: string): Promise<boolean> {
  const [venue] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  return venue !== undefined;
}

export async function listTables(db: Db, venueId: string): Promise<TableInfo[]> {
  const rows = await db
    .select()
    .from(tables)
    .where(eq(tables.venueId, venueId))
    .orderBy(tables.name);
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    zone: t.zone,
    shape: t.shape,
    posX: t.posX,
    posY: t.posY,
    rotation: t.rotation,
  }));
}

export async function upsertTable(
  db: Db,
  venueId: string,
  input: { id: string; name: string; seats: number; zone?: string; shape?: string },
): Promise<{ ok: true } | VenueNotFound> {
  return db.transaction(async (tx) => {
    if (!(await venueExists(tx as unknown as Db, venueId))) return { ok: false, code: "venue_not_found" } as const;
    const [known] = await tx
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.venueId, venueId), eq(tables.id, input.id)));
    if (!known) await enforceSandboxCap(tx as unknown as Db, venueId, "tables");
    await tx
      .insert(tables)
      .values({
        id: input.id,
        venueId,
        name: input.name,
        seats: input.seats,
        zone: input.zone ?? "",
        shape: input.shape ?? "round",
      })
      .onConflictDoUpdate({
        target: [tables.venueId, tables.id],
        set: {
          name: input.name,
          seats: input.seats,
          zone: input.zone ?? "",
          shape: input.shape ?? "round",
        },
      });
    return { ok: true } as const;
  });
}

export async function updateTableLayout(
  db: Db,
  venueId: string,
  tableId: string,
  input: { x?: number; y?: number; rotation?: number },
): Promise<{ ok: true } | VenueNotFound | { ok: false; code: "table_not_found" }> {
  const set: Record<string, number> = {};
  if (input.x !== undefined) set.posX = input.x;
  if (input.y !== undefined) set.posY = input.y;
  if (input.rotation !== undefined) set.rotation = input.rotation;
  if (Object.keys(set).length === 0) return { ok: true };
  const updated = await db
    .update(tables)
    .set(set)
    .where(and(eq(tables.venueId, venueId), eq(tables.id, tableId)))
    .returning({ id: tables.id });
  if (updated.length > 0) return { ok: true };
  return { ok: false, code: (await venueExists(db, venueId)) ? "table_not_found" : "venue_not_found" };
}

/** Idempotent: an id that is not a table of the venue deletes nothing and is still ok. */
export async function deleteTable(db: Db, venueId: string, tableId: string): Promise<{ ok: true } | VenueNotFound> {
  const deleted = await db
    .delete(tables)
    .where(and(eq(tables.venueId, venueId), eq(tables.id, tableId)))
    .returning({ id: tables.id });
  if (deleted.length === 0 && !(await venueExists(db, venueId))) return { ok: false, code: "venue_not_found" };
  return { ok: true };
}

export async function listServices(db: Db, venueId: string): Promise<ServiceInfo[]> {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.venueId, venueId))
    .orderBy(services.openStart);
  return rows.map((s) => ({
    name: s.name,
    openStart: s.openStart,
    openEnd: s.openEnd,
    ...(s.minPartySize !== null ? { minPartySize: s.minPartySize } : {}),
    ...(s.maxPartySize !== null ? { maxPartySize: s.maxPartySize } : {}),
    days: [...s.days].sort((a, b) => a - b),
  }));
}

export async function upsertService(
  db: Db,
  venueId: string,
  input: ServiceInput,
): Promise<{ ok: true } | { ok: false; code: "invalid_request" }> {
  const current = (
    await db
      .select()
      .from(services)
      .where(and(eq(services.venueId, venueId), eq(services.name, input.name)))
      .limit(1)
  )[0];
  const minPartySize = input.minPartySize !== undefined ? input.minPartySize : current?.minPartySize ?? null;
  const maxPartySize = input.maxPartySize !== undefined ? input.maxPartySize : current?.maxPartySize ?? null;
  if (minPartySize !== null && maxPartySize !== null && minPartySize > maxPartySize) {
    return { ok: false, code: "invalid_request" };
  }
  const days = input.days ?? current?.days ?? [...ALL_DAYS];
  const row = { openStart: input.openStart, openEnd: input.openEnd, minPartySize, maxPartySize, days };
  await db.transaction(async (tx) => {
    if (!current) await enforceSandboxCap(tx as unknown as Db, venueId, "services");
    await tx
      .insert(services)
      .values({ venueId, name: input.name, ...row })
      .onConflictDoUpdate({ target: [services.venueId, services.name], set: row });
  });
  return { ok: true };
}

/** Longest service name a path lookup accepts. A name stored before the bound can be longer. */
export const MAX_SERVICE_PATH_LENGTH = 200;

export async function hasService(db: Db, venueId: string, name: string): Promise<boolean> {
  const [row] = await db
    .select({ name: services.name })
    .from(services)
    .where(and(eq(services.venueId, venueId), eq(services.name, name)))
    .limit(1);
  return row !== undefined;
}

export async function deleteService(db: Db, venueId: string, name: string): Promise<void> {
  await db
    .delete(services)
    .where(and(eq(services.venueId, venueId), eq(services.name, name)));
}
