import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/refresh";

/** `date` narrows the list to that day's entries (and today's queue when it is today); without it, today and the undated queue. */
export function useWaitlist(venueId: string | null, date?: string, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["waitlist", venueId, date ?? null],
    queryFn: () => api.listWaitlist(venueId as string, date),
    enabled: Boolean(venueId),
    ...(live ? liveQuery : {}),
  });
}
