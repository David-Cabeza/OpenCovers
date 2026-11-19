import { useCallback } from "react";
import { useUiStore } from "@/stores/ui-store";
import { CATALOG, type MessageKey } from "./catalog";
import type { Message } from "./define";
import type { Locale } from "./locales";

export { LOCALES, LOCALE_NAMES, detectLocale, isLocale, type Locale } from "./locales";
export type { MessageKey } from "./catalog";

export type Params = Record<string, string | number>;

const PLURAL_RULES = new Map<Locale, Intl.PluralRules>();
function pluralForm(locale: Locale, count: number): "one" | "other" {
  let rules = PLURAL_RULES.get(locale);
  if (!rules) PLURAL_RULES.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules.select(count) === "one" ? "one" : "other";
}

/** Fills the `{name}` placeholders of a message. A placeholder with no parameter is left as written, so it shows. */
function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** The text of `key` in `locale`. A plural message needs a numeric `count`. Falls back to English, then to the key. */
export function translateIn(locale: Locale, key: MessageKey, params?: Params): string {
  const entry: Message | undefined = CATALOG[locale][key] ?? CATALOG.en[key];
  if (entry === undefined) return key;
  if (typeof entry === "string") return fill(entry, params);
  const count = Number(params?.count);
  return fill(entry[pluralForm(locale, Number.isFinite(count) ? count : 0)], params);
}

export type Translate = (key: MessageKey, params?: Params) => string;

/** The language now in use. Outside React, where there is no hook, read it from here. */
export const currentLocale = (): Locale => useUiStore.getState().locale;

/**
 * Translates into the language now in use. For code that runs when something happens (a validation, a toast) and not
 * while a component draws. A component should use `useT`, so it draws again when the language changes.
 */
export const t: Translate = (key, params) => translateIn(currentLocale(), key, params);

/** The translate function of the language now in use. The component draws again when the language changes. */
export function useT(): Translate {
  const locale = useUiStore((s) => s.locale);
  return useCallback<Translate>((key, params) => translateIn(locale, key, params), [locale]);
}

/** The language in use, and how to change it. */
export function useLocale(): [Locale, (locale: Locale) => void] {
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  return [locale, setLocale];
}
