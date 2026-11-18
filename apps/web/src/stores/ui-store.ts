import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  venueId: string | null;
  setVenue: (venueId: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      venueId: null,
      setVenue: (venueId) => set({ venueId }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "opencovers-ui" },
  ),
);
