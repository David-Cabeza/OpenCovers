import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { api, type Reservation } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";

/** The booking whose allergies are being written from outside the agenda, for the edit dialog. */
export function useDietaryShortcut(venueId: string) {
  const t = useT();
  const [reservation, setReservation] = useState<Reservation | null>(null);

  // Read afresh each time: the dialog compares what was typed with this copy to decide what to send.
  async function open(reservationId: string) {
    try {
      setReservation(await api.getReservation(venueId, reservationId));
    } catch (err) {
      toast.error(errorMessage(err, t("floor.card.loadFailed")));
    }
  }

  return { reservation, open, close: () => setReservation(null) };
}
