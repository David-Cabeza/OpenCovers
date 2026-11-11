import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { floorItems } from "../db/schema";
import * as schema from "../db/schema";

export type Db = NodePgDatabase<typeof schema>;

export interface FloorItem {
  id: string;
  venueId: string;
  type: string;
  label: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
}

export async function listFloorItems(db: Db, venueId: string): Promise<FloorItem[]> {
  const rows = await db
    .select()
    .from(floorItems)
    .where(eq(floorItems.venueId, venueId));
  return rows.map((r) => ({
    id: r.id,
    venueId: r.venueId,
    type: r.type,
    label: r.label,
    posX: r.posX,
    posY: r.posY,
    width: r.width,
    height: r.height,
    rotation: r.rotation,
  }));
}

export async function addFloorItem(
  db: Db,
  venueId: string,
  input: {
    type: string;
    label?: string;
    posX?: number;
    posY?: number;
    width?: number;
    height?: number;
  },
): Promise<FloorItem> {
  const item: FloorItem = {
    id: crypto.randomUUID(),
    venueId,
    type: input.type,
    label: input.label ?? "",
    posX: input.posX ?? 0,
    posY: input.posY ?? 0,
    width: input.width ?? 80,
    height: input.height ?? 40,
    rotation: 0,
  };
  await db.insert(floorItems).values({
    id: item.id,
    venueId,
    type: item.type,
    label: item.label,
    posX: item.posX,
    posY: item.posY,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
  });
  return item;
}

export async function deleteFloorItem(db: Db, venueId: string, id: string): Promise<void> {
  await db
    .delete(floorItems)
    .where(and(eq(floorItems.venueId, venueId), eq(floorItems.id, id)));
}

export async function updateFloorItemLayout(
  db: Db,
  venueId: string,
  id: string,
  input: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
): Promise<void> {
  const set: Record<string, number> = {};
  if (input.x !== undefined) set.posX = input.x;
  if (input.y !== undefined) set.posY = input.y;
  if (input.rotation !== undefined) set.rotation = input.rotation;
  if (input.width !== undefined) set.width = input.width;
  if (input.height !== undefined) set.height = input.height;
  if (Object.keys(set).length === 0) return;
  await db
    .update(floorItems)
    .set(set)
    .where(and(eq(floorItems.venueId, venueId), eq(floorItems.id, id)));
}
