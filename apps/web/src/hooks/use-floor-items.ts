import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/refresh";

export function useFloorItems(venueId: string | null, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["floor-items", venueId],
    queryFn: () => api.listFloorItems(venueId as string),
    enabled: Boolean(venueId),
    ...(live ? liveQuery : {}),
  });
}
