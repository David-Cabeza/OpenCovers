import type { QueryClient } from "@tanstack/react-query";
import { api, type Reservation } from "@/lib/api";
import { isApiError } from "@/lib/error-message";

export type TableRefusal = { kind: "seats" } | { kind: "zone"; zone: string; outside: string[] };

/**
 * Why the engine refused the tables named for a booking, when that can be told apart. `null` leaves the code's general
 * text. `invalid_request` has many causes: the zone is named only for a `booked` booking with a zone, when every named
 * table still exists and one of them is in another zone.
 */
export async function tableRefusal(
  err: unknown,
  queryClient: QueryClient,
  venueId: string,
  booking: Reservation,
  named: string[],
): Promise<TableRefusal | null> {
  const seats = isApiError(err, "party_size_too_large");
  const zone = booking.status === "booked" ? booking.zone : undefined;
  if (!seats && !(zone && isApiError(err, "invalid_request"))) return null;
  // Read again: the table may have been changed or deleted since the screen read it.
  const read = queryClient.fetchQuery({
    queryKey: ["tables", venueId],
    queryFn: () => api.listTables(venueId),
    staleTime: 0,
  });
  const tables = await read.then((x) => x.tables).catch(() => null);
  if (seats) return { kind: "seats" };
  const found = named.map((id) => tables?.find((t) => t.id === id));
  if (!zone || found.some((t) => !t)) return null;
  const outside = found.flatMap((t) => (t && t.zone !== zone ? [t.name] : []));
  return outside.length > 0 ? { kind: "zone", zone, outside } : null;
}
