import { useEffect, useId, useRef, useState } from "react";
import { MaximizeIcon, MinimizeIcon, RotateCwIcon, TriangleAlertIcon, UtensilsIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { isAllergyRisk, type Dietary } from "@/lib/dietary";
import { FloorTableCard } from "./floor-table-card";
import { FloorItemShape } from "./floor-item-shape";
import { guestsText } from "./guests-text";
import { useFloorSkinGate } from "./skin-gate";
import { FLOOR_SKINS } from "./skins";
import { arrowMove, SNAP } from "./floor-keys";
import { fitTableLabel, isShallow, TEXT_PX } from "./table-label";

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
  dietary?: Dietary;
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
const MARGIN = 24;
const MIN_HEIGHT = 480;
// A plan that needs less shrinking than this to fit the screen is shrunk by default (a tablet). Below it the names
// would be too small to read, so the plan opens at its real size and scrolls sideways (a phone).
const AUTO_FIT_MIN = 0.7;

// Edit handles are 20 px discs. Their tap area grows to 44 px, mostly outwards, so it takes little from the table or
// element underneath and the areas of two handles on a 40 px element meet without overlapping.
const HANDLE =
  "absolute -top-2 flex size-5 items-center justify-center rounded-full border border-foreground/40 bg-card text-[10px] text-foreground shadow-sm before:absolute before:-top-4 before:-bottom-[10px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const HANDLE_LEFT = "-left-2 z-10 before:-left-4 before:-right-[10px] hover:bg-accent";
// Keyboard focus ring of a table or element in the editor: the opaque ring of the view-mode table.
const FOCUS_RING =
  "focus-visible:ring-[3px] focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const HANDLE_RIGHT = "-right-2 before:-left-[10px] before:-right-4 hover:bg-destructive hover:text-white";

// Faint grain lines for wooden table tops, drawn with the theme's wood edge colour.
const WOOD_GRAIN =
  "repeating-linear-gradient(90deg, transparent 0 6px, color-mix(in oklab, var(--wood-edge) 25%, transparent) 6px 7px)";

const snap = (v: number) => Math.round(v / SNAP) * SNAP;

// Older data and the demo template say "rect" for a rectangular table.
const shapeOf = (shape: string | undefined) => (shape === "rect" ? "rectangle" : (shape ?? "round"));

function tableSize(shape: string | undefined, seats: number): { w: number; h: number } {
  if (shape === "rectangle") return { w: 64, h: 46 };
  if (shape === "square") return { w: 52, h: 52 };
  // A long (banquet) table gets about 20 px per chair along each side.
  if (shape === "long") return { w: Math.min(Math.max(Math.ceil(seats / 2) * 20 + 14, 110), 220), h: 36 };
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
  if (shape === "rectangle" || shape === "long") {
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

// `last` is the latest position or size of the gesture. It is saved from here when the pointer lifts, because the
// state that draws it can still be one move behind at that moment.
type DragTarget = {
  kind: "table" | "item";
  id: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  last?: { x: number; y: number };
};
type ResizeTarget = {
  id: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  scale: number;
  last?: { w: number; h: number };
};

export function FloorCanvas({
  tables,
  items = [],
  mode,
  venueId,
  onSeat,
  onMove,
  onMoveRequest,
  onDietaryRequest,
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
  /** Called from a seated table's card to write that booking's allergies and diets. */
  onDietaryRequest?: (reservationId: string) => void;
  onTableUpdate?: (tableId: string, layout: { x?: number; y?: number; rotation?: number }) => void;
  onItemUpdate?: (
    itemId: string,
    layout: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
  ) => void;
  onDeleteItem?: (itemId: string) => void;
}) {
  const tr = useT();
  const keysHintId = useId();
  const skin = FLOOR_SKINS[useFloorSkinGate().skin];
  const canvasRef = useRef<HTMLDivElement>(null);
  const [posOverrides, setPosOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, { w: number; h: number }>>({});
  const dragRef = useRef<DragTarget | null>(null);
  const resizeRef = useRef<ResizeTarget | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [zoomChoice, setZoomChoice] = useState<"fit" | "actual" | null>(null);
  // While something is dragged or resized the scale stays put, so the plan does not shrink or grow under the finger.
  const [heldScale, setHeldScale] = useState<number | null>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFrameWidth(frame.clientWidth));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  function updateMore() {
    const frame = frameRef.current;
    if (!frame) return;
    const left = frame.scrollLeft > 1;
    const right = frame.scrollLeft + frame.clientWidth < frame.scrollWidth - 1;
    setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }

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
      offsetX: (e.clientX - rect.left) / scale - x,
      offsetY: (e.clientY - rect.top) / scale - y,
      scale,
    };
    setHeldScale(scale);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, snap((e.clientX - rect.left) / drag.scale - drag.offsetX));
    const y = Math.max(0, snap((e.clientY - rect.top) / drag.scale - drag.offsetY));
    drag.last = { x, y };
    setPosOverrides((prev) => ({ ...prev, [`${drag.kind}:${drag.id}`]: { x, y } }));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = drag.last;
    if (pos) {
      if (drag.kind === "table") onTableUpdate?.(drag.id, { x: pos.x, y: pos.y });
      else onItemUpdate?.(drag.id, { x: pos.x, y: pos.y });
    }
    dragRef.current = null;
    setHeldScale(null);
  }

  // Arrow keys move the focused object one grid step (Shift: four) and save it the way the end of a drag does.
  function onObjectKeyDown(e: React.KeyboardEvent, kind: "table" | "item", id: string, name: string, x: number, y: number) {
    if (mode !== "edit" || e.target !== e.currentTarget) return;
    const to = arrowMove(e.key, e.shiftKey, x, y);
    if (!to) return;
    e.preventDefault();
    setPosOverrides((prev) => ({ ...prev, [`${kind}:${id}`]: to }));
    if (kind === "table") onTableUpdate?.(id, { x: to.x, y: to.y });
    else onItemUpdate?.(id, { x: to.x, y: to.y });
    setAnnouncement(tr("floor.edit.moved", { name, x: to.x, y: to.y }));
  }

  function startResize(e: React.PointerEvent, item: CanvasItem) {
    if (mode !== "edit") return;
    // The handle sits inside the element, which would otherwise take the same press as the start of a drag.
    e.stopPropagation();
    resizeRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      startW: item.width,
      startH: item.height,
      scale,
    };
    setHeldScale(scale);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: React.PointerEvent) {
    const r = resizeRef.current;
    if (!r) return;
    const w = Math.max(SNAP, snap(r.startW + (e.clientX - r.startX) / r.scale));
    const h = Math.max(SNAP, snap(r.startH + (e.clientY - r.startY) / r.scale));
    r.last = { w, h };
    setSizeOverrides((prev) => ({ ...prev, [r.id]: { w, h } }));
  }

  function onResizeUp() {
    const r = resizeRef.current;
    if (!r) return;
    const size = r.last;
    if (size) onItemUpdate?.(r.id, { width: size.w, height: size.h });
    resizeRef.current = null;
    setHeldScale(null);
  }

  function rotate(itemId: string, rotation: number, kind: "table" | "item") {
    const next = (rotation + 90) % 360;
    if (kind === "table") onTableUpdate?.(itemId, { rotation: next });
    else onItemUpdate?.(itemId, { rotation: next });
  }

  // The plan uses absolute pixel positions. When it is wider than the screen it is either shrunk to fit or shown at
  // its real size and scrolled sideways; the bar under it says which and switches between the two.
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
  const naturalWidth = extentX + MARGIN;
  const naturalHeight = Math.max(MIN_HEIGHT, extentY + MARGIN);
  const fit = frameWidth > 0 && naturalWidth > frameWidth ? Math.floor((frameWidth / naturalWidth) * 1000) / 1000 : 1;
  const zoom = zoomChoice ?? (fit >= AUTO_FIT_MIN ? "fit" : "actual");
  const scale = heldScale ?? (zoom === "fit" ? fit : 1);
  const scaled = scale < 1;
  // The handles keep their size on screen when the plan is shrunk, so their tap area stays 44 px.
  const handleStyle = scaled ? { scale: 1 / scale } : undefined;
  // Table text is drawn at 11 px, scaled plan or not; the plan geometry does not change.
  const textStyle = { fontSize: TEXT_PX / scale };

  useEffect(updateMore, [frameWidth, naturalWidth, scale]);

  return (
    <div className="overflow-hidden rounded-xl border bg-floor">
      {mode === "edit" && (
        <>
          <p id={keysHintId} className="sr-only">
            {tr("floor.edit.keysHint")}
          </p>
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </>
      )}
      <div className="relative">
      <div ref={frameRef} data-testid="floor-frame" className="overflow-x-auto overscroll-x-contain" onScroll={updateMore}>
      <div style={scaled ? { width: naturalWidth * scale, height: naturalHeight * scale, overflow: "hidden" } : undefined}>
      <div
        ref={canvasRef}
        data-testid="floor-canvas"
        className={cn("relative bg-floor", scaled ? "origin-top-left" : "w-full")}
        style={{
          ...(scaled
            ? { width: naturalWidth, height: naturalHeight, transform: `scale(${scale})` }
            : { minWidth: naturalWidth, height: naturalHeight }),
          ...skin.floor(mode),
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const pos = posOf("item", item.id, item.posX, item.posY);
          const size = sizeOf(item.id, item.width, item.height);
          const rotation = item.rotation ?? 0;
          const itemName = item.label || item.type;
          return (
            <div
              key={item.id}
              style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
              className={cn("absolute select-none", mode === "edit" && cn("cursor-move touch-none outline-none", FOCUS_RING))}
              role={mode === "edit" ? "group" : undefined}
              tabIndex={mode === "edit" ? 0 : undefined}
              aria-label={mode === "edit" ? itemName : undefined}
              aria-describedby={mode === "edit" ? keysHintId : undefined}
              onKeyDown={(e) => onObjectKeyDown(e, "item", item.id, itemName, pos.x, pos.y)}
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
                    aria-label={tr("floor.rotateNamed", { name: itemName })}
                    style={handleStyle}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => rotate(item.id, rotation, "item")}
                    className={cn(HANDLE, HANDLE_LEFT)}
                  >
                    <RotateCwIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={tr("floor.deleteNamed", { name: itemName })}
                    style={handleStyle}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onDeleteItem?.(item.id)}
                    className={cn(HANDLE, HANDLE_RIGHT)}
                  >
                    ×
                  </button>
                  <div
                    title={tr("floor.resize")}
                    onPointerDown={(e) => startResize(e, item)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                    onPointerCancel={onResizeUp}
                    className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize touch-none rounded-sm border border-foreground/40 bg-card shadow-sm before:absolute before:-left-1 before:-top-1 before:-bottom-5 before:-right-5 before:content-['']"
                  />
                </>
              )}
            </div>
          );
        })}

        {tables.map((t) => {
          const pos = posOf("table", t.id, t.posX, t.posY);
          const shape = shapeOf(t.shape);
          const size = tableSize(shape, t.seats);
          const rotation = t.rotation ?? 0;
          const movableInView = mode === "view" && t.occupied;
          const seatable = mode === "view" && !t.occupied;
          const shallow = isShallow(shape);
          const pax = tr("floor.table.pax", { party: t.partySize ?? "?" });
          const label = fitTableLabel(
            { shape, ...size, rotation, scale },
            {
              name: t.name,
              guest: t.guestName,
              count: t.occupied ? pax : String(t.seats),
              occupied: Boolean(t.occupied),
            },
          );
          const written = label.name?.text === t.name;
          return (
            <FloorTableCard key={t.id} venueId={venueId} table={t} tableNames={tableNames} enabled={Boolean(movableInView)} onMoveRequest={onMoveRequest ? () => onMoveRequest(t.id) : undefined} onDietaryRequest={onDietaryRequest}>
            <div
              style={{ left: pos.x, top: pos.y, width: NODE, height: NODE }}
              className={cn(
                "group absolute select-none outline-none",
                mode === "edit" ? cn("cursor-move touch-none", FOCUS_RING) : movableInView ? "cursor-grab" : "cursor-pointer",
              )}
              role={seatable || movableInView ? "button" : mode === "edit" ? "group" : undefined}
              tabIndex={seatable || movableInView || mode === "edit" ? 0 : undefined}
              aria-describedby={mode === "edit" ? keysHintId : undefined}
              // A free table is named by its own text, so the name always contains what is drawn on it.
              // The mark's words follow the table's name, which keeps the drawn text first (WCAG 2.5.3).
              aria-label={
                seatable
                  ? undefined
                  : mode === "view"
                    ? tr("floor.table.occupiedLabel", {
                        name: t.name,
                        guest: t.guestName ? `${t.guestName} ` : "",
                        pax: tr("floor.table.pax", { party: t.partySize ?? "?" }),
                        guests: guestsText(t.partySize),
                      }) + (t.dietary ? `. ${tr(isAllergyRisk(t.dietary) ? "dietary.floor.allergy" : "dietary.floor.diet")}` : "")
                    : mode === "edit"
                      ? t.name
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
                  : mode === "edit"
                    ? (e) => onObjectKeyDown(e, "table", t.id, t.name, pos.x, pos.y)
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
                    "absolute flex flex-col items-center justify-center border-2 text-center transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-foreground group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
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
                    {/* The name is drawn upright, so on a turned table it has only the room a level line has across
                        it. The whole name stays in the tooltip and is what a screen reader hears. */}
                    {label.name && (
                      <span
                        title={t.name}
                        aria-hidden={written ? undefined : true}
                        className={cn(
                          "font-semibold leading-tight",
                          label.name.lines === 1 ? "block truncate" : "line-clamp-2 text-balance [overflow-wrap:normal]",
                        )}
                        style={{ maxWidth: label.name.maxWidth, ...textStyle }}
                      >
                        {label.name.text}
                      </span>
                    )}
                    {!written && <span className="sr-only">{t.name}</span>}
                    {/* Blank text between the drawn parts is not rendered in a flex box, but it makes the drawn text read
                        "Mesa 6 Ana 4 pax", the start of the accessible name (WCAG 2.5.3). */}
                    {t.occupied && " "}
                    {t.occupied ? (
                      label.count && (
                        <span
                          className={cn(
                            "flex max-w-full leading-tight",
                            shallow ? "items-baseline justify-center gap-1" : "flex-col items-center",
                          )}
                          style={{ maxWidth: label.detailWidth, ...textStyle }}
                        >
                          {label.guest && <span className="max-w-full truncate font-medium">{t.guestName}</span>}
                          {" "}
                          <span className="shrink-0 whitespace-nowrap">{pax}</span>
                        </span>
                      )
                    ) : (
                      <>
                        {label.count && (
                          <span aria-hidden="true" className="font-medium leading-tight" style={textStyle}>
                            {t.seats}
                          </span>
                        )}
                        {seatable && (
                          <span className="sr-only">
                            {tr("floor.table.seatable", { seats: tr("common.seats", { count: t.seats }) })}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              {mode === "view" && t.occupied && t.dietary && <DietaryMark dietary={t.dietary} />}
              {mode === "edit" && (
                <button
                  type="button"
                  aria-label={tr("floor.rotateNamed", { name: t.name })}
                  style={handleStyle}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => rotate(t.id, rotation, "table")}
                  className={cn(HANDLE, HANDLE_LEFT)}
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
      </div>
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 w-6 from-foreground/15 to-transparent transition-opacity duration-200",
            side === "left" ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l",
            more[side] ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      </div>
      {fit < 1 && (
        <div className="flex items-center justify-between gap-2 border-t bg-card py-1 pl-3 pr-1 text-xs text-muted-foreground">
          <span>
            {zoom === "fit" ? tr("floor.zoom.fitted", { percent: Math.round(fit * 100) }) : tr("floor.zoom.scrollHint")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-foreground"
            onClick={() => setZoomChoice(zoom === "fit" ? "actual" : "fit")}
          >
            {zoom === "fit" ? <MaximizeIcon className="size-4" /> : <MinimizeIcon className="size-4" />}
            {zoom === "fit" ? tr("floor.zoom.actual") : tr("floor.zoom.fit")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A mark on a table whose booking has allergies or a diet recorded. The table's card says which. */
function DietaryMark({ dietary }: { dietary: Dietary }) {
  const risk = isAllergyRisk(dietary);
  const Icon = risk ? TriangleAlertIcon : UtensilsIcon;
  return (
    <span
      aria-hidden="true"
      data-slot="dietary-mark"
      className={cn(
        "pointer-events-none absolute -top-1 -right-1 z-10 flex size-7 items-center justify-center rounded-full border-2 shadow-sm",
        risk ? "border-card bg-destructive text-background" : "border-foreground bg-card text-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
