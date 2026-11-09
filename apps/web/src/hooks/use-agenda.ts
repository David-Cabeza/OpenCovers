import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAgenda(venueId: string | null, date: string) {
  return useQuery({
    queryKey: ["agenda", venueId, date],
    queryFn: () => api.agenda(venueId as string, date),
    enabled: Boolean(venueId),
  });
}
