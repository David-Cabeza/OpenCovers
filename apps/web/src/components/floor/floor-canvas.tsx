import { useRef, useState } from "react";
import { RotateCwIcon } from "lucide-react";
import { cn } from "cn";
import { FLOOR_ITEM_TYPES } from "@/lib/floor-item-types";

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

const snap = (v: number) => Math.round(v / SNAP) * SNAP;

function tableSize(shape: string | undefined, seats: number): { w: number; h: number } {
  if (shape === "rectangle") return { w: 56, h: 40 };
  if (shape === "square") return { w: 44, h: 44 };
  const d = Math.min(36 + seats * 4, 56);
  return { w: d, h: d };
}

function chairPositions(shape: string | undefined, seats: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  if (shape === "rectangle") {
    const perSide = Math.ceil(seats / 2);
    for (let i = 0; i < seats; i++) {
      if (i < perSide) {
        pts.push({ x: -22 + ((i + 0.5) / perSide) * 44, y: -26 });
      } else {
        pts.push({ x: 22 - ((i - perSide + 0.5) / perSide) * 44, y: 26 });
      }
    }
  } else {
    const radius = shape === "square" ? 28 : Math.min(24 + seats * 2, 34);
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
  onSeat,
  onMove,
  onTableUpdate,
  onItemUpdate,
  onDeleteItem,
}: {
  tables: CanvasTable[];
  items?: CanvasItem[];
  mode: "view" | "edit";
  onSeat?: (tableId: string) => void;
  onMove?: (reservationId: string, targetTableId: string) => void;
  onTableUpdate?: (tableId: string, layout: { x?: number; y?: number; rotation?: number }) => void;
  onItemUpdate?: (
    itemId: string,
    layout: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
  ) => void;
  onDeleteItem?: (itemId: string) => void;
}) {
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

  return (
    <div
      ref={canvasRef}
      className="relative h-[480px] w-full overflow-hidden rounded-lg border bg-muted/30"
      onDragOver={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const config =
          FLOOR_ITEM_TYPES[item.type] ?? { label: item.label || item.type, className: "bg-foreground/20" };
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
              className={cn(
                "flex size-full items-center justify-center text-xs font-medium",
                config.className,
              )}
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              {config.label || item.label || item.type}
            </div>
            {mode === "edit" && (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => rotate(item.id, rotation, "item")}
                  className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-accent"
                >
                  <RotateCwIcon className="size-3" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onDeleteItem?.(item.id)}
                  className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-destructive hover:text-white"
                >
                  ×
                </button>
                <div
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
        return (
          <div
            key={t.id}
            style={{ left: pos.x, top: pos.y, width: NODE, height: NODE }}
            className={cn(
              "absolute select-none",
              mode === "edit" ? "cursor-move touch-none" : movableInView ? "cursor-grab" : undefined,
            )}
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
              {chairPositions(shape, t.seats).map((c, i) => (
                <div
                  key={i}
                  className="absolute size-2 rounded-full bg-muted-foreground/40"
                  style={{ left: NODE / 2 + c.x - 4, top: NODE / 2 + c.y - 4 }}
                />
              ))}
              <div
                className={cn(
                  "absolute flex flex-col items-center justify-center border-2 text-center shadow-sm transition-colors",
                  shape === "round" ? "rounded-full" : "rounded-lg",
                  t.occupied
                    ? "border-primary bg-primary/15"
                    : mode === "view"
                      ? "border-border bg-background hover:border-primary"
                      : "border-border bg-background",
                )}
                style={{
                  left: NODE / 2 - size.w / 2,
                  top: NODE / 2 - size.h / 2,
                  width: size.w,
                  height: size.h,
                }}
              >
                <span className="px-1 text-[11px] font-semibold leading-tight">{t.name}</span>
                {t.occupied ? (
                  <>
                    <span className="max-w-[52px] truncate text-[10px] font-medium">
                      {t.guestName || "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.partySize ?? "?"} pax
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t.seats}</span>
                )}
              </div>
            </div>
            {mode === "edit" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => rotate(t.id, rotation, "table")}
                className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-accent"
              >
                <RotateCwIcon className="size-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
