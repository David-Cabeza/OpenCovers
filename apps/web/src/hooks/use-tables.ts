import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTables(venueId: string | null) {
  return useQuery({
    queryKey: ["tables", venueId],
    queryFn: () => api.listTables(venueId as string),
    enabled: Boolean(venueId),
  });
}
