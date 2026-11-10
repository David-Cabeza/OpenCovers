import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePacing(venueId: string | null, date: string) {
  return useQuery({
    queryKey: ["pacing", venueId, date],
    queryFn: () => api.getPacing(venueId as string, date),
    enabled: Boolean(venueId),
  });
}
