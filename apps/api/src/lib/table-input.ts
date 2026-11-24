// Input rules of the table routes. The bounds are in docs/contract/openapi.yaml (TableUpsert, TableLayout).

export const TABLE_SHAPES = ["round", "oval", "square", "rectangle", "long", "rect"] as const;
export const MAX_SEATS = 200;
export const MAX_LABEL_LENGTH = 100;
export const MAX_POSITION = 10000;
export const MAX_ROTATION = 360;
/** Longest id or name a path may carry. Stored ids made before the bound can be longer than a new one. */
export const MAX_PATH_LENGTH = 200;

const TABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface TableUpsertInput {
  id: string;
  name: string;
  seats: number;
  zone?: string;
  shape?: string;
}

export interface TableLayoutInput {
  x?: number;
  y?: number;
  rotation?: number;
}

const integerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const onlyKeys = (body: Record<string, unknown>, allowed: string[]) => Object.keys(body).every((k) => allowed.includes(k));

/** A path id or service name that is worth a lookup. A long or empty one is a bad request, not an unknown id. */
export function isPathValue(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PATH_LENGTH;
}

/** Null when the body is not a valid table. An absent `zone` or `shape` stays undefined (the defaults apply). */
export function parseTableUpsert(body: Record<string, unknown>): TableUpsertInput | null {
  if (!onlyKeys(body, ["id", "name", "seats", "zone", "shape"])) return null;
  const { id, name, seats, zone, shape } = body;
  if (typeof id !== "string" || !TABLE_ID.test(id)) return null;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > MAX_LABEL_LENGTH) return null;
  if (!integerIn(seats, 1, MAX_SEATS)) return null;
  if (zone !== undefined && (typeof zone !== "string" || zone.length > MAX_LABEL_LENGTH)) return null;
  if (shape !== undefined && !(TABLE_SHAPES as readonly unknown[]).includes(shape)) return null;
  return { id, name: trimmed, seats, zone, shape: shape as string | undefined };
}

/** Null when a field is present and not an integer in range, or when the body carries any other field. */
export function parseTableLayout(body: Record<string, unknown>): TableLayoutInput | null {
  if (!onlyKeys(body, ["x", "y", "rotation"])) return null;
  const { x, y, rotation } = body;
  if (x !== undefined && !integerIn(x, -MAX_POSITION, MAX_POSITION)) return null;
  if (y !== undefined && !integerIn(y, -MAX_POSITION, MAX_POSITION)) return null;
  if (rotation !== undefined && !integerIn(rotation, -MAX_ROTATION, MAX_ROTATION)) return null;
  return { x, y, rotation };
}
