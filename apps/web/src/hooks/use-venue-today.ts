import { useSyncExternalStore } from "react";
import { useVenues } from "@/hooks/use-venues";
import { isoDateIn, todayIso } from "@/lib/date";

/** How often a screen left open asks the clock whether the day has changed. */
const CHECK_MS = 10_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, CHECK_MS);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * The date in the venue's time zone, which is the one the API calls today, or the browser's until the venue is known.
 * `today` is the one on screen and renders again when it changes; `readToday` asks the clock now.
 */
export function useVenueToday(venueId: string) {
  const timezone = useVenues().data?.venues.find((v) => v.id === venueId)?.timezone;
  const readToday = () => (timezone ? isoDateIn(timezone) : todayIso());
  return { today: useSyncExternalStore(subscribe, readToday), readToday };
}
