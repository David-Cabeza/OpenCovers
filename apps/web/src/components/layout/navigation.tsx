import { createContext, useContext, useEffect } from "react";
import type { Role } from "@/lib/api";
import type { ViewId } from "./sidebar";

export interface Navigation {
  /** Opens a screen, and scrolls to one of its sections when it has them (the ids of Settings). */
  goTo: (view: ViewId, section?: string) => void;
  /** The role in the current venue. */
  role?: Role;
}

const NavigationContext = createContext<Navigation | null>(null);

export const NavigationProvider = NavigationContext.Provider;

/** Null outside the dashboard, so a screen shown on its own offers no link to another one. */
export function useNavigation(): Navigation | null {
  return useContext(NavigationContext);
}

/** Whether the role can change the venue's setup: add tables and services, and so on. */
export const canEditSetup = (role?: Role): boolean => role === "write" || role === "admin";

/**
 * Scrolls to the Settings section `settings-{section}` once it is on the page, then calls `done`. A screen draws its
 * sections a moment after it opens, so it looks a few times (twice a second for up to two seconds) before giving up.
 */
export function useScrollToSection(section: string | null, done: () => void): void {
  useEffect(() => {
    if (!section) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`settings-${section}`);
      if (el || ++tries >= 20) {
        clearInterval(timer);
        el?.scrollIntoView?.({ behavior: "smooth" });
        done();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [section, done]);
}
