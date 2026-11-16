export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

export const ALL_WEEKDAYS: number[] = WEEKDAYS.map((d) => d.value);

/** "Every day", "Mon-Fri", "Sat, Sun" or "Mon, Wed-Fri" for a set of ISO weekdays. */
export function formatDays(days: readonly number[] | undefined): string {
  const set = [...new Set(days ?? ALL_WEEKDAYS)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (set.length === 7) return "Every day";
  const name = (d: number) => WEEKDAYS[d - 1].short;
  const parts: string[] = [];
  for (let i = 0; i < set.length; ) {
    let j = i;
    while (j + 1 < set.length && set[j + 1] === set[j] + 1) j++;
    parts.push(j - i >= 2 ? `${name(set[i])}-${name(set[j])}` : set.slice(i, j + 1).map(name).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}
