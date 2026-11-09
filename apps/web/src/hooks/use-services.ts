import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useServices(venueId: string | null) {
  return useQuery({
    queryKey: ["services", venueId],
    queryFn: () => api.listServices(venueId as string),
    enabled: Boolean(venueId),
  });
}
