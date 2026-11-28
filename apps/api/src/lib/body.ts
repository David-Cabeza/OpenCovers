// One parser for JSON request bodies: a route lists its fields with a check each, and gets back the typed values or a
// refusal. A body that is not a JSON object, a field that fails its check, and a field the route does not list all
// refuse, so the route answers `invalid_request` and writes nothing. `checkFields` also names what was wrong.

export const INVALID: unique symbol = Symbol("invalid");

/**
 * Parses one field. `undefined` is a field left out. Returns the value to use, or INVALID. `fields` is set on a nested
 * object, so a failure inside it can be named.
 */
export type Check<T> = ((value: unknown) => T | typeof INVALID) & { fields?: Fields };

export type Fields = { [name: string]: Check<unknown> };

export type Parsed<F extends Fields> = { [K in keyof F]: Exclude<ReturnType<F[K]>, typeof INVALID> };

/** `unchangeable` is a field a write does not change (ADR-0029). No route uses it today. */
export type Problem = "unknown" | "missing" | "invalid" | "unchangeable";

export interface FieldProblem {
  path: string;
  problem: Problem;
}

/** `fields` is empty when the body is not a JSON object, so there is no field to name. */
export type Checked<T> = { ok: true; value: T } | { ok: false; fields: FieldProblem[] };

// An unknown name that is not a plain identifier reads "?", so text sent as a key (a contact, a note) never comes back.
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const MAX_REPORTED = 20;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks every field of `body` against `fields` and names each one that fails or is not listed. */
export function checkFields<F extends Fields>(body: unknown, fields: F): Checked<Parsed<F>> {
  if (!isObject(body)) return { ok: false, fields: [] };
  const problems: FieldProblem[] = Object.keys(body)
    .filter((key) => !Object.hasOwn(fields, key))
    .map((key) => ({ path: NAME.test(key) ? key : "?", problem: "unknown" }));
  const out: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(fields)) {
    const present = Object.hasOwn(body, key);
    const raw = present ? body[key] : undefined;
    const value = check(raw);
    if (value !== INVALID) {
      out[key] = value;
      continue;
    }
    const inner = check.fields && isObject(raw) ? checkFields(raw, check.fields) : undefined;
    if (inner && !inner.ok) problems.push(...inner.fields.map((f) => ({ ...f, path: `${key}.${f.path}` })));
    else problems.push({ path: key, problem: present ? "invalid" : "missing" });
  }
  if (problems.length > 0) return { ok: false, fields: problems.slice(0, MAX_REPORTED) };
  return { ok: true, value: out as Parsed<F> };
}

/** The same check for a route that names nothing: null when `body` is not a plain object or any field fails. */
export function parseFields<F extends Fields>(body: unknown, fields: F): Parsed<F> | null {
  const checked = checkFields(body, fields);
  return checked.ok ? checked.value : null;
}

/** Reads the request's JSON body and parses it. A missing, empty or malformed body is null. */
export async function parseBody<F extends Fields>(req: { json(): Promise<unknown> }, fields: F): Promise<Parsed<F> | null> {
  const body = await req.json().catch(() => undefined);
  return parseFields(body, fields);
}

/** For a write that takes no field: an empty body and `{}` pass. */
export async function checkNoFields(req: { text(): Promise<string>; json(): Promise<unknown> }): Promise<Checked<unknown>> {
  if ((await req.text()).trim() === "") return { ok: true, value: {} };
  return checkFields(await req.json().catch(() => undefined), {});
}

/** A nested object with its own field list, which may be left out. */
export const optionalObject = <F extends Fields>(fields: F): Check<Parsed<F> | undefined> =>
  Object.assign((value: unknown) => (value === undefined ? undefined : (parseFields(value, fields) ?? INVALID)), { fields });

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
