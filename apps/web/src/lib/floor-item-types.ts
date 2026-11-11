export interface FloorItemTypeConfig {
  label: string;
  width: number;
  height: number;
  className: string;
}

export const FLOOR_ITEM_TYPES: Record<string, FloorItemTypeConfig> = {
  bar: {
    label: "Bar",
    width: 200,
    height: 44,
    className: "rounded-md bg-amber-200/70 border border-amber-400 text-amber-900",
  },
  kitchen: {
    label: "Kitchen",
    width: 120,
    height: 80,
    className: "rounded-md bg-orange-200/60 border border-orange-400 text-orange-900",
  },
  wall: {
    label: "Wall",
    width: 160,
    height: 8,
    className: "bg-foreground/60",
  },
  window: {
    label: "Window",
    width: 80,
    height: 6,
    className: "bg-sky-300/70",
  },
  door: {
    label: "Door",
    width: 24,
    height: 40,
    className: "rounded-sm bg-foreground/25 border border-foreground/40",
  },
  plant: {
    label: "Plant",
    width: 28,
    height: 28,
    className: "rounded-full bg-emerald-500/60 border border-emerald-600",
  },
  counter: {
    label: "Counter",
    width: 120,
    height: 40,
    className: "rounded-md bg-foreground/15 border border-foreground/30",
  },
  entrance: {
    label: "Entrance",
    width: 48,
    height: 16,
    className: "rounded bg-foreground/15 border border-dashed border-foreground/40",
  },
};
