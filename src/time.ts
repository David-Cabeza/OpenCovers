export function toEpoch(date: string, time: string, timezone = "UTC"): number {
  const asUTC = Date.parse(`${date}T${time}:00Z`);
  if (timezone === "UTC") return Math.floor(asUTC / 1000);
  const offsetMinutes = getOffsetMinutes(asUTC, timezone);
  return Math.floor(asUTC / 1000) - offsetMinutes * 60;
}

function getOffsetMinutes(instantMs: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    values[part.type] = part.value;
  }
  const wallClockUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((wallClockUTC - instantMs) / 60000);
}
