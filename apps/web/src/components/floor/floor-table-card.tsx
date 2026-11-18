import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { StatusBadge } from "@/components/agenda/status-badge";
import { ReconfirmationPill } from "@/components/preshift/pre-shift-view";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Reservation } from "@/lib/api";
import { longDate } from "@/lib/date";

const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;
const STALE_MS = 15_000;
const GC_MS = 60_000;

interface CardTable {
  id: string;
  name: string;
  reservationId?: string;
  partySize?: number;
  guestName?: string;
}

/**
 * Wraps one table node of the floor plan (the single child, which keeps its own layout, drag and
 * click behaviour) and shows the reservation behind an occupied table in a small card.
 *
 * One controlled popover serves every input: mouse hover (after a short delay), keyboard focus,
 * Enter on the focused table (also moves focus into the card) and a tap on touch screens.
 * Dragging the table closes the card and keeps it closed until the drag ends.
 */
export function FloorTableCard({
  venueId,
  table,
  tableNames,
  enabled,
  children,
}: {
  venueId?: string;
  table: CardTable;
  tableNames: Record<string, string>;
  enabled: boolean;
  children: ReactElement;
}) {
  const reservationId = table.reservationId;
  const active = enabled && Boolean(venueId) && Boolean(reservationId);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  const focusCard = useRef(false);
  const lastPointer = useRef("mouse");

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!active) return children;

  function schedule(next: boolean, delay: number) {
    clearTimeout(timer.current);
    if (next && dragging.current) return;
    timer.current = setTimeout(() => setOpen(next), delay);
  }

  function show() {
    clearTimeout(timer.current);
    if (!dragging.current) setOpen(true);
  }

  function hide() {
    clearTimeout(timer.current);
    focusCard.current = false;
    setOpen(false);
  }

  const inCard = (node: EventTarget | null) =>
    node instanceof Node && Boolean(contentRef.current?.contains(node));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) show();
        else hide();
      }}
    >
      <PopoverAnchor
        asChild
        data-table-card-anchor=""
        aria-describedby={open ? contentId : undefined}
        onPointerEnter={(e: React.PointerEvent) => {
          lastPointer.current = e.pointerType;
          if (e.pointerType === "mouse") schedule(true, OPEN_DELAY);
        }}
        onPointerLeave={(e: React.PointerEvent) => {
          if (e.pointerType === "mouse") schedule(false, CLOSE_DELAY);
        }}
        onPointerDown={(e: React.PointerEvent) => {
          lastPointer.current = e.pointerType;
        }}
        onClick={() => {
          // A mouse click already has the card open from hover; only touch and pen toggle on tap.
          if (lastPointer.current === "mouse") return;
          if (open) hide();
          else show();
        }}
        onFocus={(e: React.FocusEvent) => {
          let visible = true;
          try {
            visible = e.currentTarget.matches(":focus-visible");
          } catch {
            // Browsers without :focus-visible support: treat focus as keyboard focus.
          }
          if (visible) show();
        }}
        onBlur={(e: React.FocusEvent) => {
          if (!inCard(e.relatedTarget)) hide();
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            focusCard.current = true;
            if (open) contentRef.current?.focus();
            else show();
          }
        }}
        onDragStart={() => {
          dragging.current = true;
          hide();
        }}
        onDragEnd={() => {
          dragging.current = false;
        }}
      >
        {children}
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        ref={contentRef}
        side="top"
        aria-label={`Reservation for ${table.guestName || table.name}`}
        onOpenAutoFocus={(e) => {
          if (!focusCard.current) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // A tap on a table is handled by that table (toggle), not by outside-dismiss.
          if (e.target instanceof Element && e.target.closest("[data-table-card-anchor]")) e.preventDefault();
        }}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") schedule(false, CLOSE_DELAY);
        }}
        onBlur={(e) => {
          if (!inCard(e.relatedTarget) && !(e.relatedTarget instanceof Element && e.relatedTarget.closest("[data-table-card-anchor]"))) {
            hide();
          }
        }}
      >
        <CardBody
          venueId={venueId as string}
          reservationId={reservationId as string}
          table={table}
          tableNames={tableNames}
          open={open}
          onClose={hide}
        />
      </PopoverContent>
    </Popover>
  );
}

function CardBody({
  venueId,
  reservationId,
  table,
  tableNames,
  open,
  onClose,
}: {
  venueId: string;
  reservationId: string;
  table: CardTable;
  tableNames: Record<string, string>;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["reservation", venueId, reservationId],
    queryFn: () => api.getReservation(venueId, reservationId),
    enabled: open,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  });
  const r: Reservation | undefined = data;
  const name = r?.guest.name || table.guestName || "—";
  const party = r?.partySize ?? table.partySize;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight">{name}</p>
          <p className="text-muted-foreground">
            {party ?? "?"} {party === 1 ? "guest" : "guests"} · {table.name}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 size-7 shrink-0" aria-label="Close" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {isError ? (
        <p role="alert" className="text-destructive">
          Could not load the reservation.
        </p>
      ) : isPending || !r ? (
        <div data-testid="card-loading" role="status" aria-label="Loading reservation" className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <Row label="When">
            {longDate(r.date)} · {r.time}
          </Row>
          <Row label="Service">{r.service || "—"}</Row>
          <Row label="Status">
            <StatusBadge status={r.status} />
          </Row>
          <Row label="Tables">
            {(r.tables ?? []).map((id) => tableNames[id] ?? "Table").join(", ") || "—"}
          </Row>
          <Row label="Contact">{r.guest.contact || "—"}</Row>
          <Row label="Booked via">{r.bookedVia || "—"}</Row>
          {r.reconfirmation && r.reconfirmation !== "none" && (
            <Row label="Reconfirmation">
              <ReconfirmationPill value={r.reconfirmation} />
            </Row>
          )}
          {r.commentary && <Row label="Notes">{r.commentary}</Row>}
        </dl>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
