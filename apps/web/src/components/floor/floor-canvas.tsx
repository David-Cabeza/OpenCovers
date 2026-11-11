import { useRef } from "react";
import { cn } from "cn";

export interface CanvasTable {
  id: string;
  name: string;
  seats: number;
  posX: number;
  posY: number;
  occupied?: boolean;
  reservationId?: string;
  partySize?: number;
  guestName?: string;
}

const NODE_SIZE = 64;

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

  function handleCanvasDrop(e: React.DragEvent) {
    if (mode !== "edit") return;
    e.preventDefault();
    const tableId = e.dataTransfer.getData("text/plain");
    if (!tableId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - NODE_SIZE / 2));
    const y = Math.max(0, Math.round(e.clientY - rect.top - NODE_SIZE / 2));
    onPosition?.(tableId, x, y);
  }

  return (
    <div
      ref={canvasRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleCanvasDrop}
      className="relative h-[480px] w-full overflow-hidden rounded-lg border bg-muted/30"
    >
      {tables.map((t) => {
        const draggable = mode === "edit" || (mode === "view" && t.occupied);
        return (
          <div
            key={t.id}
            style={{ left: t.posX, top: t.posY, width: NODE_SIZE, height: NODE_SIZE }}
            className="absolute"
            draggable={draggable}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "text/plain",
                mode === "edit" ? t.id : (t.reservationId ?? t.id),
              );
              e.dataTransfer.effectAllowed = "move";
            }}
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
            <div
              className={cn(
                "flex size-full cursor-grab flex-col items-center justify-center rounded-full border-2 text-center shadow-sm transition-colors active:cursor-grabbing",
                t.occupied
                  ? "border-primary bg-primary/15"
                  : mode === "view"
                    ? "border-border bg-background hover:border-primary"
                    : "border-border bg-background",
              )}
            >
              <span className="px-1 text-xs font-semibold leading-tight">{t.name}</span>
              {t.occupied ? (
                <>
                  <span className="max-w-[56px] truncate text-[10px] font-medium">
                    {t.guestName || "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.partySize ?? "?"} pax
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-muted-foreground">{t.seats} seats</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
