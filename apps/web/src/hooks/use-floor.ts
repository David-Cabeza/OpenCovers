import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { nowTime } from "@/lib/date";
import { liveQuery } from "@/lib/refresh";

/**
 * The floor plan of a day at a time, kept current. `time: null` follows the clock: every read asks for the minute it is
 * then and answers it as `time`. The key stays the same, so the plan on screen is updated in place, and kept if a read
 * fails.
 */
export function useFloor(venueId: string | null, date: string, time: string | null) {
  return useQuery({
    queryKey: ["floor", venueId, date, time ?? "now"],
    queryFn: async () => {
      const at = time ?? nowTime();
      return { ...(await api.getFloorPlan(venueId as string, date, at)), time: at };
    },
    enabled: Boolean(venueId),
    ...liveQuery,
  });
}
