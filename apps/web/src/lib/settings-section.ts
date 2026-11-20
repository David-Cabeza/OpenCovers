/**
 * The Settings section that is open lives in the address as `?section=online`, so it can be linked and survives a
 * reload. The app has no router (screens are component state), so this reads and writes the query by hand and tells
 * subscribers when it changes.
 */
const PARAM = "section";
const EVENT = "opencovers:settings-section";

/** Which section holds each deep-link target (the ids that other screens pass to `goTo("setup", ...)`). */
const TARGETS: Record<string, string> = {
  venue: "venue",
  online: "online",
  room: "room",
  developers: "developers",
  tables: "room",
  floor: "room",
  services: "room",
};

export const sectionForTarget = (target: string): string | undefined => TARGETS[target];

/** The raw `section` value in the address (not checked against the sections the role may see). */
export const readSectionParam = (): string | null => new URLSearchParams(window.location.search).get(PARAM);

function write(id: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", next);
  }
  window.dispatchEvent(new Event(EVENT));
}

export const setSectionParam = (id: string | null, mode: "push" | "replace" = "replace") => write(id, mode);

export function subscribeSectionParam(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}
