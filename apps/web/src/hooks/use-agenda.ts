import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/refresh";

export function useAgenda(venueId: string | null, date: string, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["agenda", venueId, date],
    queryFn: () => api.agenda(venueId as string, date),
    enabled: Boolean(venueId),
    ...(live ? liveQuery : {}),
  });
}
