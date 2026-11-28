import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Reservation } from "@/lib/api";
import { refreshBookings, rememberReservation, rereadReservation } from "@/lib/reservation-cache";

/** Why the last save of a dialog was refused, once the booking has been asked for again. */
export type Conflict =
  /** `base` is what is stored now. `withdrawn`: the deletion of allergies and diets went through all the same. */
  | { kind: "changed"; withdrawn: boolean }
  | { kind: "gone" }
  | { kind: "unread" };

/**
 * What a dialog that edits a booking compares its form with and takes its `version` from. It is the reservation the
 * dialog opened with, whatever the screen behind reads later, until a save is refused and it is read again.
 */
export function useReservationConflict(venueId: string, reservation: Reservation | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ base: Reservation | null; conflict: Conflict | null }>({
    base: reservation,
    conflict: null,
  });
  const shown = useRef(reservation);

  useEffect(() => {
    shown.current = reservation;
    setState({ base: reservation, conflict: null });
  }, [reservation]);

  /**
   * Reads the booking again and refreshes the screens behind. `stillShown` is false when the dialog was closed or
   * moved to another booking meanwhile, and then its form must be left alone.
   */
  async function reread({ withdrawn = false } = {}) {
    const opened = reservation as Reservation;
    const fresh = await rereadReservation(venueId, opened.id);
    if (typeof fresh !== "string") rememberReservation(queryClient, venueId, fresh);
    refreshBookings(queryClient, venueId);
    const stillShown = shown.current === opened;
    if (stillShown) {
      setState((prev) =>
        typeof fresh === "string"
          ? { base: prev.base, conflict: { kind: fresh } }
          : { base: fresh, conflict: { kind: "changed", withdrawn } },
      );
    }
    return { fresh, stillShown };
  }

  const say = (conflict: Conflict | null) => setState((prev) => ({ ...prev, conflict }));
  // `clear` runs before each save, so that a second refusal that reads the same is a new alert and is read out again.
  return { ...state, reread, clear: () => say(null), gone: () => say({ kind: "gone" }) };
}
