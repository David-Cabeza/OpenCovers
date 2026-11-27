import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/refresh";

export function useServices(venueId: string | null, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["services", venueId],
    queryFn: () => api.listServices(venueId as string),
    enabled: Boolean(venueId),
    ...(live ? liveQuery : {}),
  });
}
