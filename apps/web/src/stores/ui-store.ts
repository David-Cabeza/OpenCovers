import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isFloorSkinId, type FloorSkinId } from "@/components/floor/skins";

interface UiState {
  venueId: string | null;
  setVenue: (venueId: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  floorSkin: FloorSkinId;
  setFloorSkin: (skin: FloorSkinId) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      venueId: null,
      setVenue: (venueId) => set({ venueId }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      floorSkin: "plano",
      setFloorSkin: (floorSkin) => set({ floorSkin }),
    }),
    {
      name: "opencovers-ui",
      // A stored skin this build no longer has falls back to the default.
      merge: (stored, current) => {
        const merged = { ...current, ...(stored as Partial<UiState>) };
        return isFloorSkinId(merged.floorSkin) ? merged : { ...merged, floorSkin: current.floorSkin };
      },
    },
  ),
);
