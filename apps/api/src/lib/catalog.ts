import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { services, tables } from "../db/schema";
import * as schema from "../db/schema";

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
}

export interface ServiceInput {
  name: string;
  openStart: string;
  openEnd: string;
  minPartySize?: number | null;
  maxPartySize?: number | null;
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
): Promise<void> {
  await db
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
}

export async function updateTableLayout(
  db: Db,
  venueId: string,
  tableId: string,
  input: { x?: number; y?: number; rotation?: number },
): Promise<void> {
  const set: Record<string, number> = {};
  if (input.x !== undefined) set.posX = input.x;
  if (input.y !== undefined) set.posY = input.y;
  if (input.rotation !== undefined) set.rotation = input.rotation;
  if (Object.keys(set).length === 0) return;
  await db
    .update(tables)
    .set(set)
    .where(and(eq(tables.venueId, venueId), eq(tables.id, tableId)));
}

export async function deleteTable(db: Db, venueId: string, tableId: string): Promise<void> {
  await db
    .delete(tables)
    .where(and(eq(tables.venueId, venueId), eq(tables.id, tableId)));
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
  const row = { openStart: input.openStart, openEnd: input.openEnd, minPartySize, maxPartySize };
  await db
    .insert(services)
    .values({ venueId, name: input.name, ...row })
    .onConflictDoUpdate({ target: [services.venueId, services.name], set: row });
  return { ok: true };
}

export async function deleteService(db: Db, venueId: string, name: string): Promise<void> {
  await db
    .delete(services)
    .where(and(eq(services.venueId, venueId), eq(services.name, name)));
}
