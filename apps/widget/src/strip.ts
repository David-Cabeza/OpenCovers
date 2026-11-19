// Pure helpers for the day strip of ADR-0021 stage 3: which days it draws, where each page starts and what
// "the next free day" is. The component and the form only wire these to the screen.

import type { PublicDay } from "./api";
import { addDays } from "./dates";

/** How many days one `/days` call asks for, and how far a page moves (the route's default). */
export const STRIP_DAYS = 12;

/**
 * The days the strip draws. `outside_window` is not drawn: such a date is before today or past the booking
 * horizon, so a chip for it would only be a dead end. At the horizon the last page is simply shorter.
 */
export const visibleDays = (days: PublicDay[]): PublicDay[] => days.filter((day) => day.status !== "outside_window");

/** `available` and `full` chips can be selected; a `full` one shows the guest there are no free times. */
export const isSelectable = (day: PublicDay): boolean => day.status === "available" || day.status === "full";

/** Where the previous and next pages start, or null when there is no such page. */
export function pageBounds(options: {
  from: string;
  today: string;
  /** The last bookable date, or undefined when the venue sets no horizon. */
  last?: string;
  size?: number;
}): { prev: string | null; next: string | null } {
  const { from, today, last, size = STRIP_DAYS } = options;
  const prev = from <= today ? null : addDays(from, -size) < today ? today : addDays(from, -size);
  const next = addDays(from, size);
  return { prev, next: last !== undefined && next > last ? null : next };
}

/** The page start for a date the guest typed: the current page when it holds the date, else the date itself. */
export function startFor(date: string, from: string, today: string, size: number = STRIP_DAYS): string {
  if (date >= from && date < addDays(from, size)) return from;
  return date < today ? today : date;
}

/**
 * The date of the next `available` day after `date`, or, when none follows in the strip, the first `available`
 * one in it. Null when the strip has no free day.
 */
export function nextFreeDay(days: PublicDay[], date: string): string | null {
  const free = days.filter((day) => day.status === "available");
  return (free.find((day) => day.date > date) ?? free[0])?.date ?? null;
}

/** The date to keep after the party changed: the same one while it can still be picked, else the first free day. */
export function dateAfterPartyChange(days: PublicDay[], date: string): string {
  const same = days.find((day) => day.date === date);
  if (!same || isSelectable(same)) return date;
  return days.find((day) => day.status === "available")?.date ?? date;
}
