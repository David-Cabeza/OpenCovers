// Dates as `YYYY-MM-DD` strings, the venue's calendar day. Arithmetic runs at UTC midnight, so the guest's
// time zone never moves a day.

const pad = (n: number) => String(n).padStart(2, "0");

export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  const d = asUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 for Monday to 7 for Sunday, as the config's `weekdays`. */
export function isoWeekday(date: string): number {
  return asUtc(date).getUTCDay() || 7;
}

export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    asUtc(date),
  );
}

export function formatDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    asUtc(date),
  );
}

/** An instant, such as `changeableUntil`, on the guest's own clock. */
export function formatInstant(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** The weekday as one letter (or the locale's narrowest form), for a chip. */
export function formatWeekdayLetter(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(asUtc(date));
}
