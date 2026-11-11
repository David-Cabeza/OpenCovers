export interface FloorItemTypeConfig {
  label: string;
  width: number;
  height: number;
}

export const FLOOR_ITEM_TYPES: Record<string, FloorItemTypeConfig> = {
  bar: { label: "Bar", width: 200, height: 44 },
  kitchen: { label: "Kitchen", width: 120, height: 80 },
  wall: { label: "Wall", width: 160, height: 8 },
  window: { label: "Window", width: 80, height: 6 },
  door: { label: "Door", width: 24, height: 40 },
  plant: { label: "Plant", width: 28, height: 28 },
  counter: { label: "Counter", width: 120, height: 40 },
  entrance: { label: "Entrance", width: 48, height: 16 },
};
