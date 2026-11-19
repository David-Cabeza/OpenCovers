import { currentLocale, t } from "@/i18n";

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function nowTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t("dates.justNow");
  if (minutes < 60) return t("dates.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("dates.hoursAgo", { count: hours });
  return t("dates.daysAgo", { count: Math.floor(hours / 24) });
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** `iso` moved by `days` calendar days (DST-safe: works on the local date, not on milliseconds). */
export function shiftIso(iso: string, days: number): string {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** "Wednesday, November 18" or "miércoles, 18 de noviembre", in the language of the app. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseIso(iso));
}

/** A date and time as one string, in the language of the app: "11/19/2026, 4:09:00 PM" or "19/11/2026, 16:09:00". */
export function dateTime(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString(currentLocale(), options);
}

/** Time elapsed since `iso`, short: "<1m", "12m", "1h 5m", "2d" ("<1 min", "12 min", "1 h 5 min", "2 d"). */
export function elapsed(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return t("dates.elapsed.lessThanMinute");
  if (minutes < 60) return t("dates.elapsed.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0
      ? t("dates.elapsed.hours", { count: hours })
      : t("dates.elapsed.hoursMinutes", { hours, minutes: minutes % 60 });
  }
  return t("dates.elapsed.days", { count: Math.floor(hours / 24) });
}
