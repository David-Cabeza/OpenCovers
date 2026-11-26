import { canEditSetup, useNavigation } from "@/components/layout/navigation";
import { useVenueConfig } from "@/hooks/use-venue-config";

/**
 * Whether this person can write allergies and diets here: the instance takes them and the role can write. It gates
 * only writing. A recorded value is shown whenever the server sends one, so a failed config read cannot hide it.
 */
export function useCanRecordDietary(venueId: string): boolean {
  const role = useNavigation()?.role;
  const { data } = useVenueConfig(venueId);
  return data?.dietaryEnabled === true && canEditSetup(role);
}
