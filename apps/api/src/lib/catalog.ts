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
}

export interface ServiceInfo {
  name: string;
  openStart: string;
  openEnd: string;
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
  }));
}

export async function upsertTable(
  db: Db,
  venueId: string,
  input: { id: string; name: string; seats: number; zone?: string },
): Promise<void> {
  await db
    .insert(tables)
    .values({
      id: input.id,
      venueId,
      name: input.name,
      seats: input.seats,
      zone: input.zone ?? "",
    })
    .onConflictDoUpdate({
      target: [tables.venueId, tables.id],
      set: { name: input.name, seats: input.seats, zone: input.zone ?? "" },
    });
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
  }));
}

export async function upsertService(
  db: Db,
  venueId: string,
  input: { name: string; openStart: string; openEnd: string },
): Promise<void> {
  await db
    .insert(services)
    .values({
      venueId,
      name: input.name,
      openStart: input.openStart,
      openEnd: input.openEnd,
    })
    .onConflictDoUpdate({
      target: [services.venueId, services.name],
      set: { openStart: input.openStart, openEnd: input.openEnd },
    });
}

export async function deleteService(db: Db, venueId: string, name: string): Promise<void> {
  await db
    .delete(services)
    .where(and(eq(services.venueId, venueId), eq(services.name, name)));
}
