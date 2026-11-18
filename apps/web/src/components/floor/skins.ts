import type { CSSProperties } from "react";

// A floor skin decides how the plan is drawn: the floor, the shadows under tables, chairs and room
// elements, and the light. It never changes where anything is or what it means.
// The choice is per user (see `floorSkin` in the UI store), not a venue setting.
export type FloorSkinId = "plano" | "ambiente";

export interface FloorSkin {
  id: FloorSkinId;
  label: string;
  description: string;
  /** Background for the stage. Editing always keeps the dot grid, so snapping stays easy to see. */
  floor: (mode: "view" | "edit") => CSSProperties;
  tableShadow: string;
  chairShadow: string;
  itemShadow: string;
}

const DOT_GRID: CSSProperties = {
  backgroundImage: "radial-gradient(circle, var(--floor-line) 1.5px, transparent 1.5px)",
  backgroundSize: "24px 24px",
};

export const FLOOR_SKINS: Record<FloorSkinId, FloorSkin> = {
  plano: {
    id: "plano",
    label: "Plan",
    description: "Clean plan with a light tile grid",
    floor: (mode) =>
      mode === "edit"
        ? DOT_GRID
        : {
            backgroundImage:
              "linear-gradient(var(--floor-line) 1px, transparent 1px), linear-gradient(90deg, var(--floor-line) 1px, transparent 1px)",
            backgroundSize: "96px 96px",
          },
    tableShadow: "shadow-[0_2px_6px_rgb(0_0_0/0.18)]",
    chairShadow: "shadow-sm",
    itemShadow: "",
  },
  ambiente: {
    id: "ambiente",
    label: "Ambiance",
    description: "Warm stone floor, deeper shadows and a soft glow",
    floor: (mode) =>
      mode === "edit"
        ? { ...DOT_GRID, ...GLOW }
        : {
            backgroundImage: [
              GLOW.backgroundImage,
              "linear-gradient(var(--floor-line) 2px, transparent 2px)",
              "linear-gradient(90deg, var(--floor-line) 2px, transparent 2px)",
              "linear-gradient(color-mix(in oklab, var(--floor-line) 45%, transparent) 1px, transparent 1px)",
              "linear-gradient(90deg, color-mix(in oklab, var(--floor-line) 45%, transparent) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: "100% 100%, 128px 128px, 128px 128px, 32px 32px, 32px 32px",
          },
    tableShadow: "shadow-[0_8px_16px_rgb(0_0_0/0.3)]",
    chairShadow: "shadow-[0_3px_5px_rgb(0_0_0/0.3)]",
    itemShadow: "drop-shadow-[0_5px_6px_rgb(0_0_0/0.28)]",
  },
};

const GLOW = {
  backgroundImage:
    "radial-gradient(ellipse 70% 60% at 50% 40%, var(--floor-glow), transparent 75%)",
};

export const FLOOR_SKIN_LIST = Object.values(FLOOR_SKINS);

export const isFloorSkinId = (value: unknown): value is FloorSkinId =>
  typeof value === "string" && value in FLOOR_SKINS;
