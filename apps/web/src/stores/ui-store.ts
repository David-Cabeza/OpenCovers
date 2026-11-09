import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  venueId: string | null;
  setVenue: (venueId: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      venueId: null,
      setVenue: (venueId) => set({ venueId }),
    }),
    { name: "opencovers-ui" },
  ),
);
