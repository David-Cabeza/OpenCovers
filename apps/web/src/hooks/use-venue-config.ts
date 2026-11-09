import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useVenueConfig(venueId: string | null) {
  return useQuery({
    queryKey: ["config", venueId],
    queryFn: () => api.getConfig(venueId as string),
    enabled: Boolean(venueId),
  });
}
