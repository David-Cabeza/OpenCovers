// The languages of the staff app. Kept apart from the store and the catalogs so any of them can import it.

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** The name of each language in that language, for the selector. */
export const LOCALE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * The language to start in when none was chosen: the browser's own, when it is one of ours, and Spanish otherwise, since
 * that is the language of the venues this app is made for.
 */
export function detectLocale(languages: readonly string[] | undefined = typeof navigator === "undefined" ? undefined : navigator.languages): Locale {
  for (const tag of languages ?? []) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "es";
}
