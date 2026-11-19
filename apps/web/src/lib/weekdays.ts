import { t, type MessageKey } from "@/i18n";

/** The name of an ISO weekday in the language of the app: `weekdayName(1)` is "Mon" or "Lun". */
export const weekdayName = (day: number, form: "short" | "long" = "short"): string =>
  t(`dates.weekday.${day}.${form}` as MessageKey);

/** ISO weekdays, Monday to Sunday. `short` and `long` are read when used, so they follow the language of the app. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
  value,
  get short() {
    return weekdayName(value, "short");
  },
  get long() {
    return weekdayName(value, "long");
  },
}));

export const ALL_WEEKDAYS: number[] = WEEKDAYS.map((d) => d.value);

/** "Every day", "Mon-Fri", "Sat, Sun" or "Mon, Wed-Fri" for a set of ISO weekdays (in Spanish, "Todos los días", "Lun-Vie"). */
export function formatDays(days: readonly number[] | undefined): string {
  const set = [...new Set(days ?? ALL_WEEKDAYS)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (set.length === 7) return t("dates.everyDay");
  const name = (d: number) => weekdayName(d);
  const parts: string[] = [];
  for (let i = 0; i < set.length; ) {
    let j = i;
    while (j + 1 < set.length && set[j + 1] === set[j] + 1) j++;
    parts.push(j - i >= 2 ? `${name(set[i])}-${name(set[j])}` : set.slice(i, j + 1).map(name).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}
