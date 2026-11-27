import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/refresh";

export function useTables(venueId: string | null, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["tables", venueId],
    queryFn: () => api.listTables(venueId as string),
    enabled: Boolean(venueId),
    ...(live ? liveQuery : {}),
  });
}
