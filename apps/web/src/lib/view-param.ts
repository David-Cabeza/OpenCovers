import type { Role } from "@/lib/api";
import { canSeeView, VIEW_IDS, type ViewId } from "@/components/layout/sidebar";

/**
 * The screen that is open lives in the address as `?view=floor`, so a reload (F5) comes back to it. The app has no
 * router (screens are component state), so this reads and writes the query by hand, like `day-param.ts`. The agenda is
 * the default and is never written. It replaces the history entry, so moving between screens adds no Back steps.
 */
const PARAM = "view";
const DEFAULT: ViewId = "agenda";

/** The screen named in the address, or null when it is missing or not a screen. The role is not checked here. */
export function readViewParam(): ViewId | null {
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return VIEW_IDS.find((id) => id === value) ?? null;
}

/** The screen itself when the sidebar offers it to the role, the agenda when it does not. */
export const visibleView = (view: ViewId, role?: Role): ViewId => (canSeeView(view, role) ? view : DEFAULT);

/** Writes the open screen to the address (null removes it) and keeps every other param and the hash. */
export function setViewParam(view: ViewId | null): void {
  const url = new URL(window.location.href);
  if (view === null || view === DEFAULT) url.searchParams.delete(PARAM);
  else url.searchParams.set(PARAM, view);
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
}
