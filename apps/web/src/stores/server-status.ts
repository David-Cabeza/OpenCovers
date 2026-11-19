import { create } from "zustand";

/** True while the last request to the API failed because the server could not be reached. Not stored. */
export const useServerStatus = create<{ down: boolean; setDown: (down: boolean) => void }>((set) => ({
  down: false,
  setDown: (down) => set({ down }),
}));
