import { addDays, isoWeekday, localDateTime } from "../src/lib/time";

/**
 * A Saturday eight to nine weeks ahead in Madrid: past a 30-day horizon, inside the public channel's default
 * of 365 days (ADR-0017, amendment of 2026-11-17), so public tests do not expire with the calendar.
 */
export function saturdayAhead(): string {
  let date = addDays(localDateTime(new Date(), "Europe/Madrid").date, 56);
  while (isoWeekday(date) !== 6) date = addDays(date, 1);
  return date;
}
