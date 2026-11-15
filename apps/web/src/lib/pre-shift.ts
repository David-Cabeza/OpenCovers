import type { Reservation, Table } from "@/lib/api";

export const LARGE_PARTY_MIN = 6;

const UPCOMING = new Set(["booked", "seated"]);

export interface PreShiftRow {
  reservation: Reservation;
  tableNames: string[];
  large: boolean;
  commentary: string | null;
}

// The API does not return a booking note yet. When `commentary` lands on
// Reservation, read it here and the view shows it with no other change.
function commentaryOf(_reservation: Reservation): string | null {
  return null;
}

export function buildPreShift(
  reservations: Reservation[],
  tables: Table[],
  service: string | null,
): PreShiftRow[] {
  const names = new Map(tables.map((t) => [t.id, t.name]));
  return reservations
    .filter((r) => UPCOMING.has(r.status) && (service === null || r.service === service))
    .map((reservation) => ({
      reservation,
      tableNames: (reservation.tables ?? []).map((id) => names.get(id) ?? id),
      large: reservation.partySize >= LARGE_PARTY_MIN,
      commentary: commentaryOf(reservation),
    }))
    .sort((a, b) => a.reservation.time.localeCompare(b.reservation.time));
}

export function totalCovers(rows: PreShiftRow[]): number {
  return rows.reduce((sum, row) => sum + row.reservation.partySize, 0);
}
