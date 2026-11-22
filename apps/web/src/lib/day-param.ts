import { useCallback, useSyncExternalStore } from "react";
import { toIsoDate, todayIso } from "@/lib/date";

/**
 * The day the staff is looking at lives in the address as `?date=2026-12-06`, so a reload (F5) keeps it. The app has
 * no router (screens are component state), so this reads and writes the query by hand, like `settings-section.ts`.
 * Today is the default and is never written, so a stale tab reloaded after midnight shows the new today.
 */
const PARAM = "date";
const EVENT = "opencovers:day";

/** True for a real calendar date written as YYYY-MM-DD (rejects `2026-13-45` and `2026-02-30`). */
function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d)) === value;
}

const read = () => {
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return isIsoDate(value) ? value : todayIso();
};

function write(date: string) {
  const url = new URL(window.location.href);
  if (isIsoDate(date) && date !== todayIso()) url.searchParams.set(PARAM, date);
  else url.searchParams.delete(PARAM);
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The day on screen, shared by every screen that shows one and kept in the address. */
export function useDayParam(): [string, (date: string) => void] {
  const date = useSyncExternalStore(subscribe, read);
  return [date, useCallback((next: string) => write(next), [])];
}
