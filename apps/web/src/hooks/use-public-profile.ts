import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePublicProfile(venueId: string | null) {
  return useQuery({
    queryKey: ["public-profile", venueId],
    queryFn: () => api.getPublicProfile(venueId as string),
    enabled: Boolean(venueId),
  });
}
