import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useOnlineBooking(venueId: string | null) {
  return useQuery({
    queryKey: ["online-booking", venueId],
    queryFn: () => api.getOnlineBooking(venueId as string),
    enabled: Boolean(venueId),
  });
}
