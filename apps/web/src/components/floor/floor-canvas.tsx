import { useRef, useState } from "react";
import { cn } from "cn";
import { FLOOR_ITEM_TYPES } from "@/lib/floor-item-types";

export interface CanvasTable {
  id: string;
  name: string;
  seats: number;
  posX: number;
  posY: number;
  shape?: string;
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
}

const NODE = 80;

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

export function FloorCanvas({
  tables,
  items = [],
  mode,
  onSeat,
  onMove,
  onPosition,
  onItemPosition,
  onDeleteItem,
}: {
  tables: CanvasTable[];
  items?: CanvasItem[];
  mode: "view" | "edit";
  onSeat?: (tableId: string) => void;
  onMove?: (reservationId: string, targetTableId: string) => void;
  onPosition?: (tableId: string, x: number, y: number) => void;
  onItemPosition?: (itemId: string, x: number, y: number) => void;
  onDeleteItem?: (itemId: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<DragTarget | null>(null);

  const posOf = (kind: "table" | "item", id: string, x: number, y: number) =>
    overrides[`${kind}:${id}`] ?? { x, y };

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
    const x = Math.max(0, Math.round(e.clientX - rect.left - drag.offsetX));
    const y = Math.max(0, Math.round(e.clientY - rect.top - drag.offsetY));
    setOverrides((prev) => ({ ...prev, [`${drag.kind}:${drag.id}`]: { x, y } }));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = overrides[`${drag.kind}:${drag.id}`];
    if (pos) {
      if (drag.kind === "table") onPosition?.(drag.id, pos.x, pos.y);
      else onItemPosition?.(drag.id, pos.x, pos.y);
    }
    dragRef.current = null;
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-[480px] w-full overflow-hidden rounded-lg border bg-muted/30"
      onDragOver={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const config =
          FLOOR_ITEM_TYPES[item.type] ??
          { label: item.label || item.type, className: "bg-foreground/20" };
        const pos = posOf("item", item.id, item.posX, item.posY);
        return (
          <div
            key={item.id}
            style={{ left: pos.x, top: pos.y, width: item.width, height: item.height }}
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
            >
              {config.label || item.label || item.type}
            </div>
            {mode === "edit" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onDeleteItem?.(item.id)}
                className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] shadow-sm hover:bg-destructive hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {tables.map((t) => {
        const pos = posOf("table", t.id, t.posX, t.posY);
        const shape = t.shape ?? "round";
        const size = tableSize(shape, t.seats);
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
        );
      })}
    </div>
  );
}
