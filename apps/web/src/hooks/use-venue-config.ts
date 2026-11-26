import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** `watch` is for a screen left open: it asks again every minute and when the tab comes back. */
export function useVenueConfig(venueId: string | null, { watch = false }: { watch?: boolean } = {}) {
  return useQuery({
    queryKey: ["config", venueId],
    queryFn: () => api.getConfig(venueId as string),
    enabled: Boolean(venueId),
    refetchInterval: watch ? 60_000 : false,
    refetchOnWindowFocus: watch ? "always" : false,
  });
}
