import { Fragment, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, XIcon } from "lucide-react";
import { StatusBadge } from "@/components/agenda/status-badge";
import { DietarySummary } from "@/components/dietary/dietary-summary";
import { ReconfirmationPill } from "@/components/preshift/pre-shift-view";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Reservation } from "@/lib/api";
import { useT } from "@/i18n";
import { longDate } from "@/lib/date";
import { guestsText } from "./guests-text";

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
  onMoveRequest,
  children,
}: {
  venueId?: string;
  table: CardTable;
  tableNames: Record<string, string>;
  enabled: boolean;
  /** Adds a "Move to…" button to the card, which closes it and calls this. */
  onMoveRequest?: () => void;
  children: ReactElement;
}) {
  const t = useT();
  const reservationId = table.reservationId;
  const active = enabled && Boolean(venueId) && Boolean(reservationId);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  const focusCard = useRef(false);
  const lastPointer = useRef("mouse");
  const anchorEl = useRef<HTMLElement | null>(null);
  const returning = useRef(false);

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

  // Closing from the card (Escape, close button, Move) hands focus back to the table that opened it.
  function closeToTable() {
    hide();
    const el = anchorEl.current;
    if (!el || !el.isConnected) return;
    returning.current = true;
    el.focus();
    returning.current = false;
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
          anchorEl.current = e.currentTarget as HTMLElement;
          lastPointer.current = e.pointerType;
          if (e.pointerType === "mouse") schedule(true, OPEN_DELAY);
        }}
        onPointerLeave={(e: React.PointerEvent) => {
          if (e.pointerType === "mouse") schedule(false, CLOSE_DELAY);
        }}
        onPointerDown={(e: React.PointerEvent) => {
          anchorEl.current = e.currentTarget as HTMLElement;
          lastPointer.current = e.pointerType;
        }}
        onClick={() => {
          // A mouse click already has the card open from hover; only touch and pen toggle on tap.
          if (lastPointer.current === "mouse") return;
          if (open) hide();
          else show();
        }}
        onFocus={(e: React.FocusEvent) => {
          anchorEl.current = e.currentTarget as HTMLElement;
          if (returning.current) return;
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
          anchorEl.current = e.currentTarget as HTMLElement;
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
        collisionPadding={8}
        className="max-h-(--radix-popover-content-available-height) overflow-y-auto"
        onEscapeKeyDown={() => closeToTable()}
        aria-label={t("floor.card.label", { name: table.guestName || table.name })}
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
          onClose={closeToTable}
          onMoveRequest={
            onMoveRequest
              ? () => {
                  closeToTable();
                  onMoveRequest();
                }
              : undefined
          }
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
  onMoveRequest,
}: {
  venueId: string;
  reservationId: string;
  table: CardTable;
  tableNames: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onMoveRequest?: () => void;
}) {
  const t = useT();
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
            {t("floor.card.summary", { guests: guestsText(party), table: table.name })}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 size-7 coarse:size-11 shrink-0" aria-label={t("common.close")} onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Above the details, so it is on screen before anything has to be scrolled to. */}
      {r?.dietary && <DietarySummary dietary={r.dietary} />}

      {isError ? (
        <p role="alert" className="text-destructive">
          {t("floor.card.loadFailed")}
        </p>
      ) : isPending || !r ? (
        <div data-testid="card-loading" role="status" aria-busy="true" aria-label={t("floor.card.loading")} className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <Row label={t("floor.card.when")}>
            {longDate(r.date)} · {r.time}
          </Row>
          <Row label={t("floor.card.service")}>{r.service || "—"}</Row>
          <Row label={t("floor.card.status")}>
            <StatusBadge status={r.status} />
          </Row>
          <Row label={t("floor.card.tables")}>
            {(r.tables ?? []).map((id) => tableNames[id] ?? t("floor.card.table")).join(", ") || "—"}
          </Row>
          <Row label={t("floor.card.contact")}>{r.guest.contact ? <Contact value={r.guest.contact} /> : "—"}</Row>
          <Row label={t("floor.card.bookedVia")}>{r.bookedVia || "—"}</Row>
          {r.reconfirmation && r.reconfirmation !== "none" && (
            <Row label={t("floor.card.reconfirmation")}>
              <ReconfirmationPill value={r.reconfirmation} />
            </Row>
          )}
          {r.commentary && <Row label={t("floor.card.notes")}>{r.commentary}</Row>}
        </dl>
      )}

      {onMoveRequest && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onMoveRequest}>
          <ArrowRightLeftIcon className="size-4" /> {t("floor.card.move")}
        </Button>
      )}
    </div>
  );
}

// An email that does not fit breaks after the @ first, and mid-word only when a part is still too long.
function Contact({ value }: { value: string }) {
  return value.split(/(?<=@)/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
