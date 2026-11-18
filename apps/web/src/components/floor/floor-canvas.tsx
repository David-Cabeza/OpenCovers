import { useRef, useState } from "react";
import { RotateCwIcon } from "lucide-react";
import { cn } from "cn";
import { useUiStore } from "@/stores/ui-store";
import { FloorTableCard } from "./floor-table-card";
import { FloorItemShape } from "./floor-item-shape";
import { FLOOR_SKINS } from "./skins";

export interface CanvasTable {
  id: string;
  name: string;
  seats: number;
  posX: number;
  posY: number;
  shape?: string;
  rotation?: number;
  occupied?: boolean;
  reservationId?: string;
  partySize?: number;
  guestName?: string;
}

export interface CanvasItem {
  id: string;
  type: string;
  label: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation?: number;
}

const NODE = 80;
const SNAP = 8;

// Faint grain lines for wooden table tops, drawn with the theme's wood edge colour.
const WOOD_GRAIN =
  "repeating-linear-gradient(90deg, transparent 0 6px, color-mix(in oklab, var(--wood-edge) 25%, transparent) 6px 7px)";

const snap = (v: number) => Math.round(v / SNAP) * SNAP;

function tableSize(shape: string | undefined, seats: number): { w: number; h: number } {
  if (shape === "rectangle") return { w: 64, h: 46 };
  if (shape === "square") return { w: 52, h: 52 };
  if (shape === "oval") return { w: Math.min(56 + seats * 4, 96), h: 44 };
  const d = Math.min(46 + seats * 3, 60);
  return { w: d, h: d };
}

const CHAIR_GAP = 8;

function chairPositions(
  shape: string | undefined,
  seats: number,
  size: { w: number; h: number },
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  if (shape === "rectangle") {
    const perSide = Math.ceil(seats / 2);
    const span = size.w - 14;
    for (let i = 0; i < seats; i++) {
      if (i < perSide) {
        pts.push({ x: -span / 2 + ((i + 0.5) / perSide) * span, y: -(size.h / 2 + CHAIR_GAP) });
      } else {
        pts.push({ x: span / 2 - ((i - perSide + 0.5) / perSide) * span, y: size.h / 2 + CHAIR_GAP });
      }
    }
  } else if (shape === "oval") {
    // Chairs go round the outline, a little off the ellipse so they sit beside the table edge.
    const rx = size.w / 2 + CHAIR_GAP;
    const ry = size.h / 2 + CHAIR_GAP;
    for (let i = 0; i < seats; i++) {
      const a = (i / seats) * 2 * Math.PI - Math.PI / 2;
      pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
    }
  } else if (shape === "square") {
    // Spread the chairs over the four sides (top, bottom, right, left first), centered on each side.
    const half = size.w / 2 + CHAIR_GAP;
    const span = size.w - 12;
    const order = [0, 2, 1, 3];
    for (const side of order) {
      const count = Math.floor(seats / 4) + (order.indexOf(side) < seats % 4 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const along = -span / 2 + ((k + 0.5) / count) * span;
        if (side === 0) pts.push({ x: along, y: -half });
        else if (side === 1) pts.push({ x: half, y: along });
        else if (side === 2) pts.push({ x: -along, y: half });
        else pts.push({ x: -half, y: -along });
      }
    }
  } else {
    const radius = size.w / 2 + CHAIR_GAP;
    for (let i = 0; i < seats; i++) {
      const a = (i / seats) * 2 * Math.PI - Math.PI / 2;
      pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    }
  }
  return pts;
}

type DragTarget = { kind: "table" | "item"; id: string; offsetX: number; offsetY: number };
type ResizeTarget = { id: string; startX: number; startY: number; startW: number; startH: number };

export function FloorCanvas({
  tables,
  items = [],
  mode,
  venueId,
  onSeat,
  onMove,
  onMoveRequest,
  onTableUpdate,
  onItemUpdate,
  onDeleteItem,
}: {
  tables: CanvasTable[];
  items?: CanvasItem[];
  mode: "view" | "edit";
  /** Enables the reservation card on occupied tables (view mode only). */
  venueId?: string;
  onSeat?: (tableId: string) => void;
  onMove?: (reservationId: string, targetTableId: string) => void;
  /** Called from "Move to…" in a seated table's card, for moving it without dragging. */
  onMoveRequest?: (tableId: string) => void;
  onTableUpdate?: (tableId: string, layout: { x?: number; y?: number; rotation?: number }) => void;
  onItemUpdate?: (
    itemId: string,
    layout: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
  ) => void;
  onDeleteItem?: (itemId: string) => void;
}) {
  const skin = FLOOR_SKINS[useUiStore((s) => s.floorSkin)];
  const canvasRef = useRef<HTMLDivElement>(null);
  const [posOverrides, setPosOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, { w: number; h: number }>>({});
  const dragRef = useRef<DragTarget | null>(null);
  const resizeRef = useRef<ResizeTarget | null>(null);

  const posOf = (kind: "table" | "item", id: string, x: number, y: number) =>
    posOverrides[`${kind}:${id}`] ?? { x, y };
  const sizeOf = (id: string, w: number, h: number) => sizeOverrides[id] ?? { w, h };

  function startDrag(e: React.PointerEvent, kind: "table" | "item", id: string, x: number, y: number) {
    if (mode !== "edit") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      kind,
      id,
      offsetX: e.clientX - rect.left - x,
      offsetY: e.clientY - rect.top - y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, snap(e.clientX - rect.left - drag.offsetX));
    const y = Math.max(0, snap(e.clientY - rect.top - drag.offsetY));
    setPosOverrides((prev) => ({ ...prev, [`${drag.kind}:${drag.id}`]: { x, y } }));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = posOverrides[`${drag.kind}:${drag.id}`];
    if (pos) {
      if (drag.kind === "table") onTableUpdate?.(drag.id, { x: pos.x, y: pos.y });
      else onItemUpdate?.(drag.id, { x: pos.x, y: pos.y });
    }
    dragRef.current = null;
  }

  function startResize(e: React.PointerEvent, item: CanvasItem) {
    if (mode !== "edit") return;
    resizeRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      startW: item.width,
      startH: item.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: React.PointerEvent) {
    const r = resizeRef.current;
    if (!r) return;
    const w = Math.max(SNAP, snap(r.startW + (e.clientX - r.startX)));
    const h = Math.max(SNAP, snap(r.startH + (e.clientY - r.startY)));
    setSizeOverrides((prev) => ({ ...prev, [r.id]: { w, h } }));
  }

  function onResizeUp() {
    const r = resizeRef.current;
    if (!r) return;
    const size = sizeOverrides[r.id];
    if (size) onItemUpdate?.(r.id, { width: size.w, height: size.h });
    resizeRef.current = null;
  }

  function rotate(itemId: string, rotation: number, kind: "table" | "item") {
    const next = (rotation + 90) % 360;
    if (kind === "table") onTableUpdate?.(itemId, { rotation: next });
    else onItemUpdate?.(itemId, { rotation: next });
  }

  // The plan uses absolute pixel positions, so on a narrow screen the stage scrolls instead of clipping.
  const tableNames = Object.fromEntries(tables.map((t) => [t.id, t.name]));
  const extentX = Math.max(
    ...tables.map((t) => posOf("table", t.id, t.posX, t.posY).x + NODE),
    ...items.map((i) => posOf("item", i.id, i.posX, i.posY).x + sizeOf(i.id, i.width, i.height).w),
    0,
  );
  const extentY = Math.max(
    ...tables.map((t) => posOf("table", t.id, t.posX, t.posY).y + NODE),
    ...items.map((i) => posOf("item", i.id, i.posX, i.posY).y + sizeOf(i.id, i.width, i.height).h),
    0,
  );

  return (
    <div className="overflow-auto rounded-xl border bg-floor">
      <div
        ref={canvasRef}
        data-testid="floor-canvas"
        className="relative h-[480px] w-full bg-floor"
        style={{
          minWidth: extentX + 24,
          minHeight: extentY + 24,
          ...skin.floor(mode),
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const pos = posOf("item", item.id, item.posX, item.posY);
          const size = sizeOf(item.id, item.width, item.height);
          const rotation = item.rotation ?? 0;
          return (
            <div
              key={item.id}
              style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
              className={cn("absolute select-none", mode === "edit" && "cursor-move touch-none")}
              onPointerDown={(e) => startDrag(e, "item", item.id, item.posX, item.posY)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className={cn("absolute inset-0", skin.itemShadow)}
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                <FloorItemShape type={item.type} />
              </div>
              {mode === "edit" && (
                <>
                  <button
                    type="button"
                    aria-label="Rotate"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => rotate(item.id, rotation, "item")}
                    className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-accent"
                  >
                    <RotateCwIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onDeleteItem?.(item.id)}
                    className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-destructive hover:text-white"
                  >
                    ×
                  </button>
                  <div
                    title="Resize"
                    onPointerDown={(e) => startResize(e, item)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                    onPointerCancel={onResizeUp}
                    className="absolute -bottom-1 -right-1 size-3 cursor-nwse-resize rounded-sm border bg-background"
                  />
                </>
              )}
            </div>
          );
        })}

        {tables.map((t) => {
          const pos = posOf("table", t.id, t.posX, t.posY);
          const shape = t.shape ?? "round";
          const size = tableSize(shape, t.seats);
          const rotation = t.rotation ?? 0;
          const movableInView = mode === "view" && t.occupied;
          const seatable = mode === "view" && !t.occupied;
          return (
            <FloorTableCard key={t.id} venueId={venueId} table={t} tableNames={tableNames} enabled={Boolean(movableInView)} onMoveRequest={onMoveRequest ? () => onMoveRequest(t.id) : undefined}>
            <div
              style={{ left: pos.x, top: pos.y, width: NODE, height: NODE }}
              className={cn(
                "group absolute select-none",
                mode === "edit" ? "cursor-move touch-none" : movableInView ? "cursor-grab" : "cursor-pointer",
              )}
              role={seatable ? "button" : undefined}
              tabIndex={seatable || movableInView ? 0 : undefined}
              aria-label={
                seatable
                  ? `Seat a walk-in at ${t.name}`
                  : mode === "view"
                    ? `${t.name}: ${t.guestName || "reserved"}, ${t.partySize ?? "?"} guests`
                    : undefined
              }
              onKeyDown={
                seatable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSeat?.(t.id);
                      }
                    }
                  : undefined
              }
              draggable={movableInView}
              onDragStart={
                movableInView
                  ? (e) => {
                      e.dataTransfer.setData("text/plain", t.reservationId ?? t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onPointerDown={(e) => startDrag(e, "table", t.id, t.posX, t.posY)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDragOver={(e) => {
                if (mode === "view" && !t.occupied) e.preventDefault();
              }}
              onDrop={(e) => {
                if (mode === "view" && !t.occupied) {
                  e.preventDefault();
                  const reservationId = e.dataTransfer.getData("text/plain");
                  if (reservationId) onMove?.(reservationId, t.id);
                }
              }}
              onClick={() => {
                if (mode === "view" && !t.occupied) onSeat?.(t.id);
              }}
            >
              <div className="absolute inset-0" style={{ transform: `rotate(${rotation}deg)` }}>
                {chairPositions(shape, t.seats, size).map((c, i) => (
                  <div
                    key={i}
                    className={cn(
                      "absolute h-[15px] w-[17px] rounded-[5px] border border-wood-edge bg-wood",
                      skin.chairShadow,
                    )}
                    style={{
                      left: NODE / 2 + c.x - 8.5,
                      top: NODE / 2 + c.y - 7.5,
                      transform: `rotate(${(Math.atan2(c.y, c.x) * 180) / Math.PI + 90}deg)`,
                    }}
                  >
                    <div className="absolute inset-x-0 top-0 h-[4px] rounded-t-[5px] bg-wood-edge" />
                    <div
                      className={cn(
                        "absolute inset-x-[2px] top-[5px] bottom-[1px] rounded-[3px] transition-colors",
                        t.occupied ? "bg-success-soft" : "bg-tabletop",
                      )}
                    />
                  </div>
                ))}
                <div
                  className={cn(
                    "absolute flex flex-col items-center justify-center border-2 text-center transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
                    skin.tableShadow,
                    shape === "round" ? "rounded-full" : shape === "oval" ? "rounded-[50%]" : "rounded-lg",
                    t.occupied
                      ? "border-success bg-success-soft text-success"
                      : shape === "round"
                        ? "border-border bg-tabletop text-[oklch(0.25_0.02_70)]"
                        : "border-wood-edge bg-wood text-[oklch(0.25_0.02_70)]",
                    !t.occupied && mode === "view" && "group-hover:border-primary group-hover:ring-2 group-hover:ring-primary/40",
                  )}
                  style={{
                    left: NODE / 2 - size.w / 2,
                    top: NODE / 2 - size.h / 2,
                    width: size.w,
                    height: size.h,
                    ...(!t.occupied && shape !== "round" ? { backgroundImage: WOOD_GRAIN } : {}),
                  }}
                >
                  <div
                    className="flex flex-col items-center justify-center"
                    style={{ transform: `rotate(${-rotation}deg)` }}
                  >
                    <span className="px-1 text-[11px] font-semibold leading-tight">{t.name}</span>
                    {t.occupied ? (
                      <>
                        <span className="max-w-[48px] truncate text-[10px] font-medium leading-tight">
                          {t.guestName || "—"}
                        </span>
                        <span className="text-[10px] leading-tight opacity-80">
                          {t.partySize ?? "?"} pax
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] opacity-70">{t.seats}</span>
                    )}
                  </div>
                </div>
              </div>
              {mode === "edit" && (
                <button
                  type="button"
                  aria-label="Rotate"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => rotate(t.id, rotation, "table")}
                  className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-accent"
                >
                  <RotateCwIcon className="size-3" />
                </button>
              )}
            </div>
            </FloorTableCard>
          );
        })}
      </div>
    </div>
  );
}
