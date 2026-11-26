/** The 14 allergens of Regulation (EU) No 1169/2011, Annex II, in its order (ADR-0027, C82). */
export const ALLERGENS = [
  "gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk",
  "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs",
] as const;
export const DIETS = ["vegetarian", "vegan", "halal", "kosher"] as const;
export const DIETARY_NOTE_MAX = 200;

export type Allergen = (typeof ALLERGENS)[number];
export type Diet = (typeof DIETS)[number];

interface DietaryValue {
  allergens: Allergen[];
  diets: Diet[];
  note: string;
}

/** What a write sends. `consented` is the writer's word that the guest agreed. */
export interface DietaryInput extends DietaryValue {
  consented: true;
}

/** What a reservation carries. A reservation with nothing recorded has none, which never means "no allergies". */
export interface Dietary extends DietaryInput {
  recordedAt: string;
  recordedBy: string | null;
}

/** What a form holds. */
export interface DietaryDraft extends DietaryValue {
  consented: boolean;
}

/** What saving a draft does to the stored value. */
export type DietaryChange =
  | { kind: "unchanged" }
  | { kind: "clear" }
  | { kind: "needsConsent" }
  | { kind: "set"; value: DietaryInput };

/** The tick is never copied from the stored value: each person who writes gives their own. */
export function draftFrom(stored?: Dietary): DietaryDraft {
  return { allergens: stored?.allergens ?? [], diets: stored?.diets ?? [], note: stored?.note ?? "", consented: false };
}

export const isEmptyDietary = (value: DietaryValue): boolean =>
  value.allergens.length === 0 && value.diets.length === 0 && value.note.trim() === "";

/** Allergens or free text can hurt the guest if missed. A diet alone is a preference. */
export const isAllergyRisk = (value: DietaryValue): boolean => value.allergens.length > 0 || value.note !== "";

const sameCodes = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((code) => b.includes(code));

export function dietaryChange(draft: DietaryDraft, stored?: Dietary): DietaryChange {
  if (isEmptyDietary(draft)) return stored ? { kind: "clear" } : { kind: "unchanged" };
  const note = draft.note.trim();
  if (stored && note === stored.note && sameCodes(draft.allergens, stored.allergens) && sameCodes(draft.diets, stored.diets)) {
    return { kind: "unchanged" };
  }
  if (!draft.consented) return { kind: "needsConsent" };
  return {
    kind: "set",
    value: {
      allergens: ALLERGENS.filter((code) => draft.allergens.includes(code)),
      diets: DIETS.filter((code) => draft.diets.includes(code)),
      note,
      consented: true,
    },
  };
}
