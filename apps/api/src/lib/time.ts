export function toTimestamp(date: string, time: string, timezone = "UTC"): Date {
  const asUTC = Date.parse(`${date}T${time}:00Z`);
  if (timezone === "UTC") return new Date(asUTC);
  const offsetMinutes = getOffsetMinutes(asUTC, timezone);
  return new Date(asUTC - offsetMinutes * 60000);
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(instant: Date, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
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

export function nowInTimezone(timezone = "UTC"): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { date, time: formatTime(now, timezone) };
}

export function generateSlots(
  openStart: string,
  openEnd: string,
  intervalMinutes: number,
): string[] {
  const start = toMinutes(openStart);
  const end = toMinutes(openEnd);
  const slots: string[] = [];
  for (let m = start; m < end; m += intervalMinutes) {
    slots.push(toTime(m));
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
