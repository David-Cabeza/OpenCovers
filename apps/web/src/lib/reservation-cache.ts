import type { QueryClient } from "@tanstack/react-query";
import { api, type Reservation } from "@/lib/api";
import { isApiError } from "@/lib/error-message";

/**
 * Puts the reservation a write or a read answered into the cached agenda days at once. A dialog opened before the next
 * read would otherwise send the version from before this app's own write, and be refused for it.
 */
export function rememberReservation(queryClient: QueryClient, venueId: string, saved: Reservation) {
  const cached = queryClient.getQueriesData<{ reservations: Reservation[] }>({ queryKey: ["agenda", venueId] });
  for (const [key, data] of cached) {
    if (!data?.reservations.some((r) => r.id === saved.id && r.version < saved.version)) continue;
    queryClient.setQueryData<{ reservations: Reservation[] }>(
      key,
      { reservations: data.reservations.map((r) => (r.id === saved.id ? saved : r)) },
      // The rest of the day is as old as it was, and the stale notice must keep saying so.
      { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt },
    );
  }
}

/** Asks again for every screen that shows bookings. */
export function refreshBookings(queryClient: QueryClient, venueId: string) {
  for (const name of ["agenda", "availability", "floor", "reservation"]) {
    void queryClient.invalidateQueries({ queryKey: [name, venueId] });
  }
}

/** The booking after a save was refused: what is stored now, or why that is not known. */
export async function rereadReservation(venueId: string, id: string): Promise<Reservation | "gone" | "unread"> {
  try {
    return await api.getReservation(venueId, id);
  } catch (err) {
    return isApiError(err, "reservation_not_found") ? "gone" : "unread";
  }
}

export const sameTables = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((id) => b.includes(id));
