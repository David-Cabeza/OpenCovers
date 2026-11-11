import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useFloorItems(venueId: string | null) {
  return useQuery({
    queryKey: ["floor-items", venueId],
    queryFn: () => api.listFloorItems(venueId as string),
    enabled: Boolean(venueId),
  });
}
