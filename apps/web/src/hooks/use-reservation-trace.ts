import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toTrace } from "@/lib/reservation-trace";

export function useReservationTrace(venueId: string, reservationId: string | null) {
  return useQuery({
    queryKey: ["trace", venueId, reservationId],
    queryFn: async () => toTrace(await api.reservationTrace(venueId, reservationId as string)),
    enabled: reservationId !== null,
    // A trace changes with every write, so it is read again each time the panel opens.
    staleTime: 0,
  });
}
