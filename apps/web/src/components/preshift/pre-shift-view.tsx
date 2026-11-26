import { useState } from "react";
import { ClipboardListIcon, MessageSquareTextIcon, PrinterIcon, StarIcon, UsersIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DietarySummary } from "@/components/dietary/dietary-summary";
import { DayNav } from "@/components/day-nav";
import { EmptyState } from "@/components/empty-state";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { Pill, type PillTone } from "@/components/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/stat";
import { useAgenda } from "@/hooks/use-agenda";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { useWaitlist } from "@/hooks/use-waitlist";
import { useT, type MessageKey } from "@/i18n";
import type { Reconfirmation, WaitlistEntry } from "@/lib/api";
import { longDate } from "@/lib/date";
import { useDayParam } from "@/lib/day-param";
import { buildPreShift, LARGE_PARTY_MIN, totalCovers, type PreShiftRow } from "@/lib/pre-shift";

const ALL_SERVICES = "all";

const RECONFIRMATION: Record<Exclude<Reconfirmation, "none">, { labelKey: MessageKey; tone: PillTone }> = {
  requested: { labelKey: "preshift.reconfirmation.requested", tone: "info" },
  confirmed: { labelKey: "preshift.reconfirmation.confirmed", tone: "success" },
  declined: { labelKey: "preshift.reconfirmation.declined", tone: "danger" },
  no_answer: { labelKey: "preshift.reconfirmation.noAnswer", tone: "warning" },
};

export function PreShiftView({ venueId }: { venueId: string }) {
  const t = useT();
  const [date, setDate] = useDayParam();
  const [service, setService] = useState(ALL_SERVICES);
  const agenda = useAgenda(venueId, date);
  const tables = useTables(venueId);
  const services = useServices(venueId);
  const waitlist = useWaitlist(venueId);

  const rows = buildPreShift(
    agenda.data?.reservations ?? [],
    tables.data?.tables ?? [],
    service === ALL_SERVICES ? null : service,
  );
  const entries = waitlist.data?.entries ?? [];
  const largeCount = rows.filter((r) => r.large).length;
  const noteCount = rows.filter((r) => r.commentary).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("preshift.title")}
        description={
          <>
            <span className="first-letter:uppercase print:hidden">{longDate(date)}</span>
            <span className="hidden print:inline">
              {longDate(date)}
              {service !== ALL_SERVICES && ` · ${service}`}
            </span>
            <span className="print:hidden"> · {t("preshift.subtitle")}</span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="w-[200px]" aria-label={t("preshift.service")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SERVICES}>{t("preshift.allServices")}</SelectItem>
                {(services.data?.services ?? []).map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DayNav date={date} onChange={setDate} />
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon />
              {t("preshift.print")}
            </Button>
          </div>
        }
      />

      {agenda.isPending ? (
        <Loading className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </Loading>
      ) : agenda.isError && !agenda.data ? (
        <LoadError
          what={t("preshift.loadWhat")}
          error={agenda.error}
          retrying={agenda.isRefetching}
          onRetry={() => void agenda.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title={t("preshift.empty.title")}
          description={t("preshift.empty.description")}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
            <Stat label={t("preshift.stat.reservations")} value={rows.length} />
            <Stat label={t("preshift.stat.covers")} value={totalCovers(rows)} />
            <Stat
              label={t("preshift.stat.large", { min: LARGE_PARTY_MIN })}
              value={largeCount}
              tone={largeCount > 0 ? "warning" : "default"}
            />
            <Stat label={t("preshift.stat.notes")} value={noteCount} />
          </div>
          <p className="hidden text-sm print:block">
            {t("preshift.reservations", { count: rows.length })} ·{" "}
            {t("preshift.covers", { count: totalCovers(rows) })}
            {largeCount > 0 && ` · ${t("preshift.largeCount", { count: largeCount, min: LARGE_PARTY_MIN })}`}
          </p>

          <ul className="@container divide-y overflow-hidden rounded-xl border bg-card print:rounded-none print:border-x-0">
            {rows.map((row) => (
              <PreShiftRowView key={row.reservation.id} row={row} />
            ))}
          </ul>
        </>
      )}

      <WaitlistPending entries={entries} />
    </div>
  );
}

function PreShiftRowView({ row }: { row: PreShiftRow }) {
  const t = useT();
  const { reservation, tableNames, large, commentary } = row;
  return (
    <li
      data-slot="preshift-row"
      className={cn(
        "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-l-4 border-l-transparent px-4 py-3 @[53rem]:grid-cols-[4rem_minmax(0,13rem)_9rem_8rem_minmax(0,1fr)] @[53rem]:items-start @[53rem]:gap-x-4 print:grid-cols-[4rem_minmax(0,13rem)_9rem_8rem_minmax(0,1fr)] print:items-start print:gap-x-4 print:break-inside-avoid print:py-2",
        large && "border-l-warning",
      )}
    >
      <div className="font-display text-xl tabular-nums">{reservation.time}</div>
      <div className="min-w-0">
        <div className="line-clamp-2 break-words font-medium @[53rem]:line-clamp-1 print:line-clamp-1" title={reservation.guest.name || undefined}>{reservation.guest.name || "—"}</div>
        {reservation.guest.contact && (
          <div className="truncate text-xs text-muted-foreground">{reservation.guest.contact}</div>
        )}
      </div>
      <div className="col-span-2 col-start-1 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[calc(3.5rem+0.75rem)] @[53rem]:contents print:contents">
        <div>
          {large ? (
            <Pill tone="warning" className="tabular-nums">
              {t("preshift.large", { count: reservation.partySize })}
            </Pill>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm tabular-nums">
              <UsersIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t("common.partyOf", { count: reservation.partySize })}</span>
              <span aria-hidden="true">{reservation.partySize}</span>
            </span>
          )}
        </div>
        <div className="text-sm">
          {tableNames.length > 0 ? (
            tableNames.join(", ")
          ) : (
            <Pill tone="danger">{t("preshift.unassigned")}</Pill>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 md:basis-auto">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 print:flex-nowrap">
              <span className="text-xs text-muted-foreground">{t("preshift.consent")}</span>
              <Pill tone={reservation.guest.consent === "granted" ? "success" : "muted"}>
                {t(`common.consent.${reservation.guest.consent ?? "unknown"}`)}
              </Pill>
            </span>
            <span data-slot="reconfirmation">
              <ReconfirmationPill value={reservation.reconfirmation} />
            </span>
            {reservation.rating ? (
              <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                <StarIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{t("preshift.rating", { rating: reservation.rating })}</span>
                <span aria-hidden="true">{reservation.rating}</span>
              </span>
            ) : null}
          </div>
          {commentary && (
            <p
              data-slot="booking-note"
              className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {commentary}
            </p>
          )}
        </div>
      </div>
      {reservation.dietary && (
        <DietarySummary
          dietary={reservation.dietary}
          className="col-span-2 @[53rem]:col-span-4 @[53rem]:col-start-2 print:col-span-4 print:col-start-2"
        />
      )}
    </li>
  );
}

export function ReconfirmationPill({ value }: { value: Reconfirmation | undefined }) {
  const t = useT();
  if (!value || value === "none") return null;
  const r = RECONFIRMATION[value];
  return <Pill tone={r.tone}>{t(r.labelKey)}</Pill>;
}

function WaitlistPending({ entries }: { entries: WaitlistEntry[] }) {
  const t = useT();
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-display text-lg">{t("preshift.waitlistNow", { count: entries.length })}</h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm print:rounded-none print:border-x-0">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <span className="font-medium">{e.guestName || "—"}</span>
            <span className="text-muted-foreground">
              {t("common.partyOf", { count: e.partySize })}
              {e.zone && ` · ${e.zone}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
