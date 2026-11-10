import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useFloor(venueId: string | null, date?: string, time?: string) {
  return useQuery({
    queryKey: ["floor", venueId, date, time],
    queryFn: () => api.getFloorPlan(venueId as string, date, time),
    enabled: Boolean(venueId),
  });
}
