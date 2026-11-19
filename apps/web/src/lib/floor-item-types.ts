import { t, type MessageKey } from "@/i18n";

export interface FloorItemTypeConfig {
  /** The name in the language of the app, read when used. */
  readonly label: string;
  width: number;
  height: number;
}

const element = (type: string, width: number, height: number): FloorItemTypeConfig => ({
  get label() {
    return t(`elements.${type}` as MessageKey);
  },
  width,
  height,
});

export const FLOOR_ITEM_TYPES: Record<string, FloorItemTypeConfig> = {
  bar: element("bar", 200, 44),
  kitchen: element("kitchen", 120, 80),
  wall: element("wall", 160, 16),
  window: element("window", 80, 6),
  door: element("door", 24, 40),
  plant: element("plant", 28, 28),
  counter: element("counter", 120, 40),
  entrance: element("entrance", 48, 16),
  sofa: element("sofa", 120, 48),
  column: element("column", 24, 24),
  stairs: element("stairs", 72, 96),
  rug: element("rug", 120, 80),
  "large-plant": element("large-plant", 64, 64),
  umbrella: element("umbrella", 96, 96),
  host: element("host", 56, 40),
  banquette: element("banquette", 160, 36),
  planter: element("planter", 120, 28),
  fireplace: element("fireplace", 72, 44),
  "wine-rack": element("wine-rack", 96, 24),
  restroom: element("restroom", 40, 40),
};
