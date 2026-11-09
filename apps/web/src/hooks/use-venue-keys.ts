import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useVenueKeys(venueId: string | null) {
  return useQuery({
    queryKey: ["keys", venueId],
    queryFn: () => api.listVenueKeys(venueId as string),
    enabled: Boolean(venueId),
  });
}
