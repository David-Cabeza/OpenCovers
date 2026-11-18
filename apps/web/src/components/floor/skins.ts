import type { CSSProperties } from "react";

// A floor skin decides how the plan is drawn: the floor, the shadows under tables, chairs and room
// elements, and the light. It never changes where anything is or what it means.
// The choice is per user (see `floorSkin` in the UI store), not a venue setting.
export type FloorSkinId = "plano" | "ambiente" | "piedra";

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
    label: "Wood",
    description: "Warm parquet floor, deeper shadows and a soft glow",
    floor: (mode) =>
      mode === "edit"
        ? { ...DOT_GRID, ...GLOW }
        : textured("color-mix(in oklab, var(--wood) 62%, var(--floor))", PARQUET, "96px 96px"),
    tableShadow: "shadow-[0_8px_16px_rgb(0_0_0/0.3)]",
    chairShadow: "shadow-[0_3px_5px_rgb(0_0_0/0.3)]",
    itemShadow: "drop-shadow-[0_5px_6px_rgb(0_0_0/0.28)]",
  },
  piedra: {
    id: "piedra",
    label: "Stone",
    description: "Large stone tiles with grout, deeper shadows and a soft glow",
    floor: (mode) =>
      mode === "edit"
        ? { ...DOT_GRID, ...GLOW }
        : textured("color-mix(in oklab, var(--floor) 88%, oklch(0.7 0.04 50))", STONE_TILES, "256px 256px"),
    tableShadow: "shadow-[0_8px_16px_rgb(0_0_0/0.3)]",
    chairShadow: "shadow-[0_3px_5px_rgb(0_0_0/0.3)]",
    itemShadow: "drop-shadow-[0_5px_6px_rgb(0_0_0/0.28)]",
  },
};

// Textures are drawn in black and white at low opacity over a base color taken from the theme, so
// the same pattern works in light and dark mode. Original artwork, no third-party asset.
const svgUrl = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`,
  )}")`;

// Planks 16px wide and 96px long, joints staggered per row, each plank with its own tone and a
// faint grain line.
const PARQUET = (() => {
  const joints = [0, 40, 72, 20, 56, 8];
  const tones = [0.1, -0.06, 0.04, -0.1, 0.08, -0.03, 0.06, -0.08];
  let body = "";
  joints.forEach((offset, row) => {
    for (let k = -1; k < 2; k++) {
      const x = offset + k * 96;
      const y = row * 16;
      const t = tones[(row * 3 + k + 1 + 8) % tones.length];
      body += `<rect x="${x}" y="${y}" width="96" height="16" fill="${t > 0 ? "#fff" : "#000"}" fill-opacity="${Math.abs(t)}"/>`;
      body += `<line x1="${x + 6}" y1="${y + 8}" x2="${x + 70}" y2="${y + 8}" stroke="#000" stroke-opacity="0.05"/>`;
      body += `<rect x="${x}" y="${y}" width="96" height="16" fill="none" stroke="#000" stroke-opacity="0.14"/>`;
    }
  });
  return svgUrl(body, 96, 96);
})();

// 4 x 4 tiles of 64px with grout lines; each tile gets its own small tone shift.
const STONE_TILES = (() => {
  const tones = [0.05, 0.0, 0.08, 0.03, 0.07, 0.02, 0.0, 0.06, 0.01, 0.08, 0.04, 0.0, 0.06, 0.03, 0.07, 0.01];
  let body = "";
  tones.forEach((t, i) => {
    const x = (i % 4) * 64;
    const y = Math.floor(i / 4) * 64;
    body += `<rect x="${x}" y="${y}" width="64" height="64" fill="${i % 3 ? "#fff" : "#000"}" fill-opacity="${t}"/>`;
  });
  for (let i = 0; i <= 4; i++) {
    body += `<line x1="${i * 64}" y1="0" x2="${i * 64}" y2="256" stroke="#000" stroke-opacity="0.12" stroke-width="2"/>`;
    body += `<line x1="0" y1="${i * 64}" x2="256" y2="${i * 64}" stroke="#000" stroke-opacity="0.12" stroke-width="2"/>`;
  }
  return svgUrl(body, 256, 256);
})();

const VIGNETTE = "radial-gradient(ellipse 85% 80% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.14) 100%)";

function textured(base: string, texture: string, size: string): CSSProperties {
  return {
    backgroundColor: base,
    backgroundImage: [VIGNETTE, GLOW.backgroundImage, texture].join(", "),
    backgroundSize: `100% 100%, 100% 100%, ${size}`,
  };
}

const GLOW = {
  backgroundImage:
    "radial-gradient(ellipse 70% 60% at 50% 40%, var(--floor-glow), transparent 75%)",
};

export const FLOOR_SKIN_LIST = Object.values(FLOOR_SKINS);

export const isFloorSkinId = (value: unknown): value is FloorSkinId =>
  typeof value === "string" && value in FLOOR_SKINS;
