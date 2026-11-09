import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useVenues() {
  return useQuery({
    queryKey: ["venues"],
    queryFn: api.listVenues,
  });
}
