// Allergies and diets on a reservation (ADR-0027, C82). Health data: it is read from the reservation row only by the
// answers that call `dietaryViews`, and never goes into an event, a webhook, an email, the trace or a log.

import { count, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { reservations } from "../db/schema";
import { INVALID, parseFields, type Check } from "./body";
import type { Origin } from "./origin";
import { actorLabel, memberNames } from "./reservation-trace";

type Db = NodePgDatabase<typeof schema>;

/** The 14 allergens of Regulation (EU) No 1169/2011, Annex II, in its order. */
export const ALLERGENS = [
  "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk",
  "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs",
] as const;
export const DIETS = ["vegetarian", "vegan", "halal", "kosher"] as const;
export const DIETARY_NOTE_MAX_LENGTH = 200;

/** What the guest declared: codes in list order with no repeats, the note trimmed, at least one of the three. */
export interface DietaryValue {
  allergens: (typeof ALLERGENS)[number][];
  diets: (typeof DIETS)[number][];
  note: string;
}

/** `reservations.dietary`. Null means nothing declared. */
export interface StoredDietary extends DietaryValue {
  recordedAt: string;
  recordedBy: Origin | null;
}

/** The `Dietary` of openapi.yaml. */
export interface Dietary extends DietaryValue {
  consented: true;
  recordedAt: string;
  recordedBy: string | null;
}

/** The instance switch. Unset means off, and any value but `on` and `off` stops the API at startup. */
export function dietaryEnabled(value: string | undefined = process.env.DIETARY): boolean {
  if (value === undefined || value === "" || value === "off") return false;
  if (value !== "on") throw new Error(`DIETARY must be on or off. Got "${value}".`);
  return true;
}

const codes =
  <T extends string>(known: readonly T[]): Check<T[]> =>
  (value) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((v) => (known as readonly unknown[]).includes(v))) return INVALID;
    return known.filter((code) => value.includes(code));
  };

// A NUL and a lone surrogate cannot be stored as jsonb, so they fail here and not as a database error.
const note: Check<string> = (value) => {
  if (value === undefined) return "";
  if (typeof value !== "string") return INVALID;
  const trimmed = value.trim();
  return trimmed.length <= DIETARY_NOTE_MAX_LENGTH && !/[\0\p{Surrogate}]/u.test(trimmed) ? trimmed : INVALID;
};

const attested: Check<true> = (value) => (value === true ? true : INVALID);

const DIETARY_FIELDS = {
  allergens: codes(ALLERGENS),
  diets: codes(DIETS),
  note,
  consented: attested,
};

/**
 * The `dietary` field of a staff write: undefined when left out, null to clear, else the value. With the switch off
 * only the first two pass.
 */
export const dietaryField: Check<DietaryValue | null | undefined> = (value) => {
  if (value === undefined || value === null) return value;
  const parsed = dietaryEnabled() ? parseFields(value, DIETARY_FIELDS) : null;
  if (!parsed) return INVALID;
  const { allergens, diets, note } = parsed;
  return allergens.length > 0 || diets.length > 0 || note !== "" ? { allergens, diets, note } : INVALID;
};

export function sameDietary(a: DietaryValue | null, b: DietaryValue | null): boolean {
  if (a === null || b === null) return a === b;
  return a.note === b.note && a.allergens.join() === b.allergens.join() && a.diets.join() === b.diets.join();
}

export function recordDietary(value: DietaryValue | null, origin: Origin | null | undefined): StoredDietary | null {
  return value && { ...value, recordedAt: new Date().toISOString(), recordedBy: origin ?? null };
}

/** What a reader gets for each stored value, in order. All null with the switch off: stored values stay, hidden. */
export async function dietaryViews(
  db: Db,
  venueId: string,
  stored: (StoredDietary | null)[],
): Promise<(Dietary | null)[]> {
  if (!dietaryEnabled()) return stored.map(() => null);
  const names = await memberNames(
    db,
    venueId,
    stored.flatMap((d) => (d?.recordedBy?.channel === "staff" && d.recordedBy.actor ? [d.recordedBy.actor] : [])),
  );
  return stored.map(
    (d) =>
      d && {
        allergens: d.allergens,
        diets: d.diets,
        note: d.note,
        consented: true,
        recordedAt: d.recordedAt,
        recordedBy: actorLabel(d.recordedBy?.channel ?? null, d.recordedBy?.actor ?? null, names),
      },
  );
}

/** How many reservations of the instance hold a value, shown or hidden. */
export async function countStoredDietary(db: Db): Promise<number> {
  const [row] = await db.select({ held: count() }).from(reservations).where(isNotNull(reservations.dietary));
  return row.held;
}
