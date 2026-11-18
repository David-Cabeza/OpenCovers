export interface FloorItemTypeConfig {
  label: string;
  width: number;
  height: number;
}

export const FLOOR_ITEM_TYPES: Record<string, FloorItemTypeConfig> = {
  bar: { label: "Bar", width: 200, height: 44 },
  kitchen: { label: "Kitchen", width: 120, height: 80 },
  wall: { label: "Wall", width: 160, height: 16 },
  window: { label: "Window", width: 80, height: 6 },
  door: { label: "Door", width: 24, height: 40 },
  plant: { label: "Plant", width: 28, height: 28 },
  counter: { label: "Counter", width: 120, height: 40 },
  entrance: { label: "Entrance", width: 48, height: 16 },
  sofa: { label: "Sofa", width: 120, height: 48 },
  column: { label: "Column", width: 24, height: 24 },
  stairs: { label: "Stairs", width: 72, height: 96 },
  rug: { label: "Rug", width: 120, height: 80 },
  "large-plant": { label: "Large plant", width: 64, height: 64 },
  umbrella: { label: "Umbrella", width: 96, height: 96 },
};
