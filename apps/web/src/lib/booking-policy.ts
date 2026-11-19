import { t } from "@/i18n";

export interface DateRange {
  from: string;
  to: string;
}

export interface BookingPolicy {
  maxAdvanceDays: number | null;
  maxActivePerGuestPerDay: number | null;
  blockedDates: DateRange[];
}

export interface BookingPolicyForm {
  maxAdvanceDays: string;
  maxActivePerGuestPerDay: string;
  blockedDates: string;
}

export type FormErrors = Partial<Record<keyof BookingPolicyForm, string>>;

export type ParseResult =
  | { ok: true; policy: BookingPolicy }
  | { ok: false; errors: FormErrors };

export const MAX_ADVANCE_DAYS_MAX = 1000;
export const MAX_ACTIVE_PER_GUEST_MAX = 100;
export const BLOCKED_DATES_MAX = 366;

const DAY_MS = 86_400_000;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export function mergeRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  const merged: DateRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= nextDay(last.to)) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function formatBlockedDates(ranges: DateRange[]): string {
  return ranges.map((r) => (r.from === r.to ? r.from : `${r.from}..${r.to}`)).join("\n");
}

export function toForm(policy: BookingPolicy): BookingPolicyForm {
  return {
    maxAdvanceDays: policy.maxAdvanceDays === null ? "" : String(policy.maxAdvanceDays),
    maxActivePerGuestPerDay:
      policy.maxActivePerGuestPerDay === null ? "" : String(policy.maxActivePerGuestPerDay),
    blockedDates: formatBlockedDates(mergeRanges(policy.blockedDates)),
  };
}

function parseLimit(text: string, min: number, max: number, errorKey: "setup.policy.errAdvance" | "setup.policy.errPerGuest") {
  const value = text.trim();
  if (value === "") return { value: null as number | null };
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    return { error: t(errorKey, { min, max }) };
  }
  return { value: Number(value) };
}

function parseBlockedText(text: string): { ranges: DateRange[] } | { error: string } {
  const ranges: DateRange[] = [];
  const entries = text
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
  for (const entry of entries) {
    const parts = entry.split(/\s*(?:\.\.|\s+to\s+)\s*/);
    if (parts.length > 2) return { error: t("setup.policy.errNotRange", { entry }) };
    const [from, to = from] = parts;
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      return {
        error: t("setup.policy.errBadDate", { entry }),
      };
    }
    if (from > to) return { error: t("setup.policy.errEndsBefore", { entry }) };
    ranges.push({ from, to });
  }
  const merged = mergeRanges(ranges);
  if (merged.length > BLOCKED_DATES_MAX || entries.length > BLOCKED_DATES_MAX) {
    return { error: t("setup.policy.errTooMany", { max: BLOCKED_DATES_MAX }) };
  }
  return { ranges: merged };
}

export function parseForm(form: BookingPolicyForm): ParseResult {
  const errors: FormErrors = {};
  const advance = parseLimit(form.maxAdvanceDays, 0, MAX_ADVANCE_DAYS_MAX, "setup.policy.errAdvance");
  if ("error" in advance) errors.maxAdvanceDays = advance.error;
  const perGuest = parseLimit(
    form.maxActivePerGuestPerDay,
    1,
    MAX_ACTIVE_PER_GUEST_MAX,
    "setup.policy.errPerGuest",
  );
  if ("error" in perGuest) errors.maxActivePerGuestPerDay = perGuest.error;
  const blocked = parseBlockedText(form.blockedDates);
  if ("error" in blocked) errors.blockedDates = blocked.error;

  if ("error" in advance || "error" in perGuest || "error" in blocked) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    policy: {
      maxAdvanceDays: advance.value,
      maxActivePerGuestPerDay: perGuest.value,
      blockedDates: blocked.ranges,
    },
  };
}
