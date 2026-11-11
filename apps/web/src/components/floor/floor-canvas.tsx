import { useRef, useState } from "react";
import { cn } from "cn";

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

export function FloorCanvas({
  tables,
  mode,
  onSeat,
  onMove,
  onPosition,
}: {
  tables: CanvasTable[];
  mode: "view" | "edit";
  onSeat?: (tableId: string) => void;
  onMove?: (reservationId: string, targetTableId: string) => void;
  onPosition?: (tableId: string, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ tableId: string; offsetX: number; offsetY: number } | null>(null);

  const posOf = (t: CanvasTable) => overrides[t.id] ?? { x: t.posX, y: t.posY };

  function onPointerDown(e: React.PointerEvent, t: CanvasTable) {
    if (mode !== "edit") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = posOf(t);
    dragRef.current = {
      tableId: t.id,
      offsetX: e.clientX - rect.left - pos.x,
      offsetY: e.clientY - rect.top - pos.y,
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
    setOverrides((prev) => ({ ...prev, [drag.tableId]: { x, y } }));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = overrides[drag.tableId];
    if (pos) onPosition?.(drag.tableId, pos.x, pos.y);
    dragRef.current = null;
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-[480px] w-full overflow-hidden rounded-lg border bg-muted/30"
      onDragOver={(e) => e.preventDefault()}
    >
      {tables.map((t) => {
        const pos = posOf(t);
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
            onPointerDown={(e) => onPointerDown(e, t)}
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
