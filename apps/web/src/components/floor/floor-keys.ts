/** Grid step of the floor plan, in plan pixels. Dragging snaps to it. */
export const SNAP = 8;
/** Shift moves four grid steps at once. */
export const BIG_STEP = SNAP * 4;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The next grid line a coordinate reaches moving `dir` (-1 or 1) by `steps` grid steps. Off the grid, the first step lands on the grid. */
function stepTo(v: number, dir: number, steps: number): number {
  const line = dir > 0 ? Math.ceil(v / SNAP) : Math.floor(v / SNAP);
  const onGrid = line * SNAP === v;
  return Math.max(0, (onGrid ? line + dir * steps : line + dir * (steps - 1)) * SNAP);
}

/** The position an arrow key moves an object to, or null for any other key. Stays on the grid and inside the plan (>= 0), as dragging does. Only the axis of the arrow changes. */
export function arrowMove(key: string, shift: boolean, x: number, y: number): { x: number; y: number } | null {
  const dir = ARROWS[key];
  if (!dir) return null;
  const steps = shift ? BIG_STEP / SNAP : 1;
  return { x: dir[0] ? stepTo(x, dir[0], steps) : x, y: dir[1] ? stepTo(y, dir[1], steps) : y };
}
