// The text of the emails the engine sends a guest (ADR-0024, stage 2). One catalog per locale, and only
// locales a native speaker reviewed ship (ADR-0024 Q3): the others are added later, one small PR each, by adding
// an entry to `EMAIL_CATALOGS`. Every catalog has the same ids and the same {slots} as `es`. Emails to the guest
// carry no guest name and no typed text (C61), and they are plain text.

const es = {
  "confirmation.heading": "Tu reserva está confirmada",
  "confirmation.subject": "Tu reserva está confirmada - {date} a las {time}",
  "confirmation.text": "Hola, tu reserva para {partySize} personas el {date} a las {time} está confirmada.",
  "cancellation.heading": "Tu reserva está cancelada",
  "cancellation.subject": "Tu reserva está cancelada - {date} a las {time}",
  "cancellation.text": "Hola, tu reserva del {date} a las {time} ha sido cancelada.",
  "notice.heading": "Nueva reserva",
  "notice.subject": "Nueva reserva - {date} a las {time}",
  "notice.text": "Nueva reserva para {partySize} personas el {date} a las {time} ({guestName}).",
  "notice.noName": "sin nombre",
  "link.subject": "Tu enlace para gestionar tu reserva",
  "link.intro": "Hola, aquí tienes un enlace nuevo para ver, cambiar o cancelar tu reserva:",
  "link.outro": "Los enlaces anteriores ya no funcionan.",
  "link.booking": "{date} a las {time}, {partySize} personas",
  "link.line": "- {booking}: {url}",
  "link.button": "Gestionar mi reserva",
  "footer": "Reservas con OpenCovers",
} as const;

export type EmailMessageId = keyof typeof es;

/** The shipped catalogs. A locale without an entry here has no catalog yet and falls back (see `resolveEmailLocale`). */
export const EMAIL_CATALOGS: Readonly<Record<string, Readonly<Record<EmailMessageId, string>>>> = { es };

/** The locale every fallback ends in. */
export const FALLBACK_EMAIL_LOCALE = "es";

function hasCatalog(locale: string | null | undefined): locale is string {
  return typeof locale === "string" && Object.hasOwn(EMAIL_CATALOGS, locale);
}

/**
 * The locale of an email: the guest's stored locale if a catalog ships for it, else the venue's online-booking
 * locale if one does, else `es`. Never throws, whatever the inputs.
 */
export function resolveEmailLocale(stored: string | null | undefined, venue: string | null | undefined): string {
  if (hasCatalog(stored)) return stored;
  if (hasCatalog(venue)) return venue;
  return FALLBACK_EMAIL_LOCALE;
}

/** Fills `{slot}`s from `slots`. A slot with no value is left as written, and a value is never read for slots. */
export function fill(template: string, slots: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(slots, name) ? String(slots[name]) : whole));
}

/** The names of the `{slots}` in a template. */
export function slotNames(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** The message `id` in `locale`, with slots filled. A locale without a catalog reads `es`. */
export function message(locale: string, id: EmailMessageId, slots: Readonly<Record<string, string | number>> = {}): string {
  const catalog = hasCatalog(locale) ? EMAIL_CATALOGS[locale] : EMAIL_CATALOGS[FALLBACK_EMAIL_LOCALE];
  return fill(catalog[id], slots);
}

/**
 * A calendar date (`YYYY-MM-DD`) written for `locale`. Built from the calendar date and formatted in UTC, so no
 * timezone moves the day. Anything that is not a calendar date, or a locale the runtime rejects, comes back as given
 * or formatted in `es`: this never throws.
 */
export function formatEmailDate(date: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (at.toISOString().slice(0, 10) !== date) return date;
  for (const tag of [locale, FALLBACK_EMAIL_LOCALE]) {
    try {
      return new Intl.DateTimeFormat(tag, { dateStyle: "full", timeZone: "UTC" }).format(at);
    } catch {
      // try the fallback
    }
  }
  return date;
}
