import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useWaitlist(venueId: string | null) {
  return useQuery({
    queryKey: ["waitlist", venueId],
    queryFn: () => api.listWaitlist(venueId as string),
    enabled: Boolean(venueId),
  });
}
