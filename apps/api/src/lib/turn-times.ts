export interface TurnTime {
  upTo: number;
  minutes: number;
}

export const DEFAULT_DURATION_MINUTES = 120;
export const TURN_MINUTES_MIN = 15;
export const TURN_MINUTES_MAX = 480;
export const TURN_TIMES_MAX_ROWS = 10;

export function turnMinutes(turnTimes: TurnTime[], partySize: number): number {
  if (turnTimes.length === 0) return DEFAULT_DURATION_MINUTES;
  return (turnTimes.find((t) => t.upTo >= partySize) ?? turnTimes[turnTimes.length - 1]).minutes;
}

export function parseTurnTimes(value: unknown): TurnTime[] | null {
  if (!Array.isArray(value) || value.length > TURN_TIMES_MAX_ROWS) return null;
  const rows: TurnTime[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
    if (Object.keys(row).some((k) => k !== "upTo" && k !== "minutes")) return null;
    const { upTo, minutes } = row as Record<string, unknown>;
    if (!Number.isInteger(upTo) || (upTo as number) < 1) return null;
    if (!Number.isInteger(minutes) || (minutes as number) < TURN_MINUTES_MIN || (minutes as number) > TURN_MINUTES_MAX) {
      return null;
    }
    const previous = rows[rows.length - 1];
    if (previous && (upTo as number) <= previous.upTo) return null;
    rows.push({ upTo: upTo as number, minutes: minutes as number });
  }
  return rows;
}
