export function normalizeTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

export function toTimestamp(date: string, time: string, timezone = "UTC"): Date {
  const tz = normalizeTimeZone(timezone);
  const asUTC = Date.parse(`${date}T${time}:00Z`);
  if (tz === "UTC") return new Date(asUTC);
  const offsetMinutes = getOffsetMinutes(asUTC, tz);
  return new Date(asUTC - offsetMinutes * 60000);
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(instant: Date, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timezone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

export function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Returns a service window in absolute minutes where end > start, adding 24h
// when the service crosses midnight (e.g. 18:00–01:00).
export function serviceWindow(openStart: string, openEnd: string): { start: number; end: number } {
  const start = toMinutes(openStart);
  let end = toMinutes(openEnd);
  if (end <= start) end += 24 * 60;
  return { start, end };
}

// Maps a minute-of-day into the same frame as `start`, so a time after midnight
// lands after the start (start <= m < start + 24h).
export function normalizeMinute(minute: number, start: number): number {
  let m = minute;
  while (m < start) m += 24 * 60;
  return m;
}

export function nowInTimezone(timezone = "UTC"): { date: string; time: string } {
  const tz = normalizeTimeZone(timezone);
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { date, time: formatTime(now, tz) };
}

export function generateSlots(
  openStart: string,
  openEnd: string,
  intervalMinutes: number,
): string[] {
  const { start, end } = serviceWindow(openStart, openEnd);
  const slots: string[] = [];
  for (let m = start; m < end; m += intervalMinutes) {
    slots.push(toTime(m % (24 * 60)));
  }
  return slots;
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
