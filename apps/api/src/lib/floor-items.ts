import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { floorItems, idempotencyKeys } from "../db/schema";
import * as schema from "../db/schema";
import { enforceSandboxCap } from "../demo/limits";
import { integer, optional, text } from "./body";
import { TABLE_LAYOUT_FIELDS, venueExists } from "./catalog";
import { claimKey } from "./idempotency";

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

// Bounds come from the staff floor editor (element sizes 6 to 260, canvas positions under 10000) and the demo template.
// A type is a lower-case slug such as `large-plant`; any such slug is stored, there is no list.
const FLOOR_ITEM_TYPE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SIZE = integer(1, 2000);

export const FLOOR_ITEM_FIELDS = {
  type: text(32, FLOOR_ITEM_TYPE),
  label: optional(text(80)),
  posX: optional(integer(0, 10_000)),
  posY: optional(integer(0, 10_000)),
  width: optional(SIZE),
  height: optional(SIZE),
};

export const FLOOR_ITEM_LAYOUT_FIELDS = {
  ...TABLE_LAYOUT_FIELDS,
  width: optional(SIZE),
  height: optional(SIZE),
};

/** Longest `Idempotency-Key` a floor item write takes. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

type VenueNotFound = { ok: false; code: "venue_not_found" };

/**
 * With a key, a repeat in the venue returns the item the first call made (`item` is undefined when it was deleted
 * since) and adds none. A key used for another kind of write is `invalid_request`.
 */
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
  key?: string,
): Promise<{ ok: true; item: FloorItem | undefined } | VenueNotFound | { ok: false; code: "invalid_request" }> {
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
  return db.transaction(async (tx) => {
    const dbTx = tx as unknown as Db;
    if (!(await venueExists(dbTx, venueId))) return { ok: false, code: "venue_not_found" } as const;
    if (key !== undefined) {
      const stored = await claimKey(tx, venueId, key);
      if (stored) {
        if (stored.kind !== "floor_item") return { ok: false, code: "invalid_request" } as const;
        const [row] = await tx
          .select()
          .from(floorItems)
          .where(and(eq(floorItems.venueId, venueId), eq(floorItems.id, stored.reservationId)));
        return { ok: true, item: row ? { ...row } : undefined } as const;
      }
    }
    await enforceSandboxCap(dbTx, venueId, "floorItems");
    await tx.insert(floorItems).values(item);
    if (key !== undefined) {
      await tx.insert(idempotencyKeys).values({ key, venueId, reservationId: item.id, kind: "floor_item", version: 1 });
    }
    return { ok: true, item } as const;
  });
}

/** Idempotent: an id that is not an item of the venue deletes nothing and is still ok. */
export async function deleteFloorItem(db: Db, venueId: string, id: string): Promise<{ ok: true } | VenueNotFound> {
  const deleted = await db
    .delete(floorItems)
    .where(and(eq(floorItems.venueId, venueId), eq(floorItems.id, id)))
    .returning({ id: floorItems.id });
  if (deleted.length === 0 && !(await venueExists(db, venueId))) return { ok: false, code: "venue_not_found" };
  return { ok: true };
}

export async function updateFloorItemLayout(
  db: Db,
  venueId: string,
  id: string,
  input: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
): Promise<{ ok: true } | VenueNotFound | { ok: false; code: "floor_item_not_found" }> {
  const set: Record<string, number> = {};
  if (input.x !== undefined) set.posX = input.x;
  if (input.y !== undefined) set.posY = input.y;
  if (input.rotation !== undefined) set.rotation = input.rotation;
  if (input.width !== undefined) set.width = input.width;
  if (input.height !== undefined) set.height = input.height;
  if (Object.keys(set).length === 0) return { ok: true };
  const updated = await db
    .update(floorItems)
    .set(set)
    .where(and(eq(floorItems.venueId, venueId), eq(floorItems.id, id)))
    .returning({ id: floorItems.id });
  if (updated.length > 0) return { ok: true };
  return { ok: false, code: (await venueExists(db, venueId)) ? "floor_item_not_found" : "venue_not_found" };
}
