import { errorMessage, isApiError } from "@/lib/error-message";
import { statusLabel } from "@/components/agenda/status-badge";
import { refreshBookings, rememberReservation, rereadReservation, sameTables } from "@/lib/reservation-cache";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { LoadError } from "@/components/load-error";
import { StaleNotice } from "@/components/stale-notice";
import { canEditSetup, useNavigation } from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { FloorCanvas } from "@/components/floor/floor-canvas";
import { FloorSkinToggle } from "@/components/floor/floor-skin-toggle";
import { EditReservationDialog } from "@/components/reservation/edit-reservation-dialog";
import { MoveDialog } from "@/components/floor/move-dialog";
import { useAgenda } from "@/hooks/use-agenda";
import { useCanRecordDietary } from "@/hooks/use-can-record-dietary";
import { useDietaryShortcut } from "@/hooks/use-dietary-shortcut";
import { useFloor } from "@/hooks/use-floor";
import { useFloorItems } from "@/hooks/use-floor-items";
import { useStaleMessage } from "@/hooks/use-stale-message";
import { useVenueConfig } from "@/hooks/use-venue-config";
import { api, ApiError, type FloorTable, type Reservation } from "@/lib/api";
import { useT } from "@/i18n";
import { nowTime, todayIso } from "@/lib/date";
import { useDayParam } from "@/lib/day-param";

/** A move being made: the tables the plan showed the booking on, and the booking as read when the move began. */
interface MoveStart {
  reservationId: string;
  shown: string[];
  read: Promise<Reservation>;
}

/** The statuses whose tables the engine changes. */
const MOVABLE = ["booked", "seated"];

export function FloorView({ venueId }: { venueId: string }) {
  const t = useT();
  const nav = useNavigation();
  const [date, setDate] = useDayParam();
  // null until the person picks one. Until then, today's plan follows the clock.
  const [picked, setPicked] = useState<string | null>(null);
  const [seatTable, setSeatTable] = useState<FloorTable | null>(null);
  const [moveFrom, setMoveFrom] = useState<{ table: FloorTable; start: MoveStart } | null>(null);
  const queryClient = useQueryClient();
  const following = picked === null && date === todayIso();
  // The last time followed, which another day shows while none is picked.
  const lastNow = useRef(nowTime());
  const floor = useFloor(venueId, date, following ? null : (picked ?? lastNow.current));
  const { data, isPending, isError, error, isRefetching, refetch } = floor;
  if (following && data) lastNow.current = data.time;
  const time = picked ?? lastNow.current;
  const floorItems = useFloorItems(venueId, { live: true });
  const { data: itemsData } = floorItems;

  // The floor route carries no allergies, and the day's agenda does.
  const agenda = useAgenda(venueId, date, { live: true });
  const staleMessage = useStaleMessage([floor, floorItems, agenda]);
  const config = useVenueConfig(venueId);
  const canRecordDietary = useCanRecordDietary(venueId);
  const shortcut = useDietaryShortcut(venueId);
  const dietaryById = new Map((agenda.data?.reservations ?? []).map((r) => [r.id, r.dietary]));

  const tables = data?.tables ?? [];
  const items = itemsData?.items ?? [];

  const occupied = tables.filter((t) => t.occupied).length;
  const free = tables.length - occupied;
  const seatedCovers = tables.reduce((n, t) => n + (t.occupied ? (t.partySize ?? 0) : 0), 0);

  // The plan carries no version, so the booking is read as a move begins: when "Move to…" opens, or at a drop.
  function startMove(reservationId: string): MoveStart {
    const read = api.getReservation(venueId, reservationId);
    // A dialog closed without a move leaves nobody to hear a failed read.
    read.catch(() => {});
    return { reservationId, shown: tables.filter((x) => x.reservationId === reservationId).map((x) => x.id), read };
  }

  /** Why a move was refused, from what is stored now. */
  async function moveRefused({ reservationId, shown }: MoveStart) {
    const fresh = await rereadReservation(venueId, reservationId);
    if (typeof fresh === "string") return t(`floor.moveConflict.${fresh}`);
    rememberReservation(queryClient, venueId, fresh);
    if (!MOVABLE.includes(fresh.status)) return t("floor.moveConflict.status", { status: statusLabel(fresh.status) });
    if (sameTables(fresh.tables, shown)) return t("floor.moveConflict.changed");
    const names = (fresh.tables ?? []).map((id) => tables.find((x) => x.id === id)?.name ?? id).join(", ");
    return names ? t("floor.moveConflict.at", { tables: names }) : t("floor.moveConflict.noTable");
  }

  const move = useMutation({
    mutationFn: async ({ start, targetTableId }: { start: MoveStart; targetTableId: string }) => {
      const booking = await start.read;
      // The booking is not where the plan showed it, so this would not be the move the person made.
      if (!MOVABLE.includes(booking.status) || !sameTables(booking.tables, start.shown)) {
        throw new ApiError("reservation_changed", 409);
      }
      return api.modifyReservation(venueId, booking.id, { tables: [targetTableId], version: booking.version });
    },
    onSuccess: (saved) => {
      toast.success(t("floor.moved"));
      rememberReservation(queryClient, venueId, saved);
      refreshBookings(queryClient, venueId);
    },
    onError: async (err, { start }) => {
      if (!isApiError(err, "reservation_changed") && !isApiError(err, "reservation_not_found")) {
        toast.error(errorMessage(err, t("floor.moveFailed")));
        return;
      }
      const why = await moveRefused(start);
      refreshBookings(queryClient, venueId);
      // Longer than usual: with no form to stay open, this is all that says the move did not happen.
      toast.error(why, { duration: 10_000 });
    },
    onSettled: () => setMoveFrom(null),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl">{t("floor.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("floor.intro")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label={t("floor.date")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-fit"
          />
          <Input
            type="time"
            aria-label={t("floor.time")}
            value={time}
            onChange={(e) => setPicked(e.target.value)}
            className="w-fit"
          />
          <Button
            variant="outline"
            onClick={() => {
              setDate(todayIso());
              setPicked(null);
              lastNow.current = nowTime();
              void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
            }}
          >
            {t("floor.now")}
          </Button>
        </div>
      </div>

      {tables.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Legend tone="free" label={t("floor.free")} value={free} />
          <Legend tone="occupied" label={t("floor.occupied")} value={occupied} />
          <span className="text-muted-foreground tabular-nums">{t("floor.seatedCovers", { count: seatedCovers })}</span>
          <span className="ml-auto">
            <FloorSkinToggle />
          </span>
        </div>
      )}

      {/* Said out loud, because a plan with no marks would look like a plan with nothing to mark. */}
      {agenda.isError && !agenda.data && config.data?.dietaryEnabled === true && (
        <p role="alert" className="rounded-lg border-2 border-destructive bg-danger-soft px-3 py-2 text-sm">
          {t("dietary.floor.loadFailed")}
        </p>
      )}

      {isPending ? (
        <Loading><Skeleton className="h-[480px] w-full" /></Loading>
      ) : isError && !data ? (
        <LoadError what={t("floor.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
      ) : tables.length === 0 ? (
        <EmptyState
          icon={ArmchairIcon}
          title={t("floor.empty.title")}
          description={t("floor.empty.description")}
          action={
            nav && canEditSetup(nav.role) ? (
              <Button className="mt-2" onClick={() => nav.goTo("setup", "room")}>
                {t("floor.empty.action")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <FloorCanvas
          tables={tables.map((table) => ({ ...table, dietary: table.reservationId ? dietaryById.get(table.reservationId) : undefined }))}
          items={items}
          mode="view"
          venueId={venueId}
          onSeat={(tableId) => {
            const table = tables.find((t) => t.id === tableId);
            if (table) setSeatTable(table);
          }}
          onMove={(reservationId, targetTableId) => move.mutate({ start: startMove(reservationId), targetTableId })}
          onMoveRequest={(tableId) => {
            const table = tables.find((t) => t.id === tableId);
            if (table?.reservationId) setMoveFrom({ table, start: startMove(table.reservationId) });
          }}
          onDietaryRequest={canRecordDietary ? (reservationId) => void shortcut.open(reservationId) : undefined}
        />
      )}

      <MoveDialog
        source={moveFrom?.table ?? null}
        tables={tables}
        pending={move.isPending}
        onMove={(_, targetTableId) => moveFrom && move.mutate({ start: moveFrom.start, targetTableId })}
        onClose={() => setMoveFrom(null)}
      />

      <EditReservationDialog
        venueId={venueId}
        reservation={shortcut.reservation}
        startOnDietary
        onOpenChange={(open) => !open && shortcut.close()}
      />

      <WalkInDialog
        venueId={venueId}
        open={seatTable !== null}
        onOpenChange={(open) => !open && setSeatTable(null)}
        tableId={seatTable?.id}
        tableName={seatTable?.name}
      />
      <StaleNotice message={staleMessage} />
    </div>
  );
}

function Legend({ tone, label, value }: { tone: "free" | "occupied"; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={
          tone === "occupied"
            ? "size-3 rounded-full border-2 border-success bg-success-soft"
            : "size-3 rounded-full border-2 border-wood-edge bg-tabletop"
        }
      />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground tabular-nums">{value}</span>
    </span>
  );
}
