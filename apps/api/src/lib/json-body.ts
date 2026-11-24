import type { Context } from "hono";

/**
 * Reads the JSON body of an admin write as a plain object.
 * Returns null for a missing, empty or malformed body, and for `null`, an array or any other
 * JSON value, so the route answers `invalid_request` and writes nothing instead of failing with a 500.
 */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}
