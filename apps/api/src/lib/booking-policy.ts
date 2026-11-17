import { isCalendarDate } from "./time";

export interface DateRange {
  from: string;
  to: string;
}

export const MAX_ADVANCE_DAYS_MAX = 1000;
export const MAX_ACTIVE_PER_GUEST_MAX = 100;
export const BLOCKED_DATES_MAX = 366;

export function isMaxAdvanceDays(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_ADVANCE_DAYS_MAX;
}

export function isMaxActivePerGuest(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_ACTIVE_PER_GUEST_MAX;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

// Entries are "YYYY-MM-DD" or { from, to }. The result is sorted, with
// overlapping and adjacent ranges merged, so equal sets store equally.
export function parseBlockedDates(value: unknown): DateRange[] | null {
  if (!Array.isArray(value) || value.length > BLOCKED_DATES_MAX) return null;
  const ranges: DateRange[] = [];
  for (const entry of value) {
    if (isCalendarDate(entry)) {
      ranges.push({ from: entry, to: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    if (Object.keys(entry).some((k) => k !== "from" && k !== "to")) return null;
    const { from, to } = entry as Record<string, unknown>;
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return null;
    ranges.push({ from, to });
  }
  ranges.sort((a, b) => a.from.localeCompare(b.from));
  const merged: DateRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= nextDay(last.to)) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function blockedRange(ranges: DateRange[], date: string): DateRange | undefined {
  return ranges.find((r) => r.from <= date && date <= r.to);
}
