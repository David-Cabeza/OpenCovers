// One parser for JSON request bodies: a route lists its fields with a check each, and gets back the typed values or
// null. A body that is not a JSON object, a field that fails its check, and a field the route does not list all give
// null, so the route answers `invalid_request` and writes nothing.

export const INVALID: unique symbol = Symbol("invalid");

/** Parses one field. `undefined` is a field left out. Returns the value to use, or INVALID. */
export type Check<T> = (value: unknown) => T | typeof INVALID;

export type Fields = Record<string, Check<unknown>>;

export type Parsed<F extends Fields> = { [K in keyof F]: Exclude<ReturnType<F[K]>, typeof INVALID> };

/** Checks every field of `body` against `fields`. Null when `body` is not a plain object or any field fails. */
export function parseFields<F extends Fields>(body: unknown, fields: F): Parsed<F> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (!Object.keys(body).every((key) => Object.hasOwn(fields, key))) return null;
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(fields)) {
    const value = check(Object.hasOwn(body, key) ? (body as Record<string, unknown>)[key] : undefined);
    if (value === INVALID) return null;
    out[key] = value;
  }
  return out as Parsed<F>;
}

/** Reads the request's JSON body and parses it. A missing, empty or malformed body is null. */
export async function parseBody<F extends Fields>(req: { json(): Promise<unknown> }, fields: F): Promise<Parsed<F> | null> {
  const body = await req.json().catch(() => undefined);
  return parseFields(body, fields);
}

/** An integer from `min` to `max`. */
export const integer =
  (min: number, max: number): Check<number> =>
  (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : INVALID;

/** A string of at most `max` characters that matches `pattern` when one is given. */
export const text =
  (max: number, pattern?: RegExp): Check<string> =>
  (value) =>
    typeof value === "string" && value.length <= max && (pattern === undefined || pattern.test(value)) ? value : INVALID;

/** One of `values`. */
export const oneOf =
  <T extends string>(values: readonly T[]): Check<T> =>
  (value) =>
    (values as readonly unknown[]).includes(value) ? (value as T) : INVALID;

/** The field may be left out. `null` still goes to `check`, which refuses it unless it takes `null`. */
export const optional =
  <T>(check: Check<T>): Check<T | undefined> =>
  (value) =>
    value === undefined ? undefined : check(value);
