import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAvailability(
  venueId: string | null,
  date: string,
  partySize: number,
) {
  return useQuery({
    queryKey: ["availability", venueId, date, partySize],
    queryFn: () => api.availability(venueId as string, date, partySize),
    enabled: Boolean(venueId),
  });
}
