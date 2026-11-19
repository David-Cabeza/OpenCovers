import { useState } from "react";
import { ClipboardListIcon, MessageSquareTextIcon, PrinterIcon, StarIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/stat";
import { CONSENT_OPTIONS } from "@/components/reservation/consent-select";
import { useAgenda } from "@/hooks/use-agenda";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { useWaitlist } from "@/hooks/use-waitlist";
import type { Consent, Reconfirmation, WaitlistEntry } from "@/lib/api";
import { longDate, todayIso } from "@/lib/date";
import { buildPreShift, LARGE_PARTY_MIN, totalCovers, type PreShiftRow } from "@/lib/pre-shift";

const ALL_SERVICES = "all";

const consentLabel = (consent: Consent | undefined) =>
  CONSENT_OPTIONS.find((o) => o.value === (consent ?? "unknown"))?.label ?? "Not asked";

const RECONFIRMATION: Record<Exclude<Reconfirmation, "none">, { label: string; tone: PillTone }> = {
  requested: { label: "Reconfirmation requested", tone: "info" },
  confirmed: { label: "Reconfirmed", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  no_answer: { label: "No answer", tone: "warning" },
};

export function PreShiftView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
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
        title="Pre-shift"
        description={
          <>
            <span className="first-letter:uppercase print:hidden">{longDate(date)}</span>
            <span className="hidden print:inline">
              {longDate(date)}
              {service !== ALL_SERVICES && ` · ${service}`}
            </span>
            <span className="print:hidden"> · Who is coming and what they need, before service.</span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="w-[160px]" aria-label="Service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SERVICES}>All services</SelectItem>
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
              Print
            </Button>
          </div>
        }
      />

      {agenda.isPending ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : agenda.isError && !agenda.data ? (
        <LoadError
          what="the pre-shift list"
          error={agenda.error}
          retrying={agenda.isRefetching}
          onRetry={() => void agenda.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title="Nobody expected"
          description="No upcoming reservations for this day and service."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
            <Stat label="Reservations" value={rows.length} />
            <Stat label="Covers" value={totalCovers(rows)} />
            <Stat
              label={`Large parties (${LARGE_PARTY_MIN}+)`}
              value={largeCount}
              tone={largeCount > 0 ? "warning" : "default"}
            />
            <Stat label="With notes" value={noteCount} />
          </div>
          <p className="hidden text-sm print:block">
            {rows.length} reservations · {totalCovers(rows)} covers
            {largeCount > 0 && ` · ${largeCount} large (${LARGE_PARTY_MIN}+)`}
          </p>

          <ul className="divide-y overflow-hidden rounded-xl border bg-card print:rounded-none print:border-x-0">
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
  const { reservation, tableNames, large, commentary } = row;
  return (
    <li
      data-slot="preshift-row"
      className={cn(
        "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-l-4 border-l-transparent px-4 py-3 md:grid-cols-[4rem_minmax(0,13rem)_6rem_8rem_minmax(0,1fr)] md:items-start md:gap-x-4 print:break-inside-avoid print:py-2",
        large && "border-l-warning",
      )}
    >
      <div className="font-display text-xl tabular-nums">{reservation.time}</div>
      <div className="min-w-0">
        <div className="truncate font-medium">{reservation.guest.name || "—"}</div>
        {reservation.guest.contact && (
          <div className="truncate text-xs text-muted-foreground">{reservation.guest.contact}</div>
        )}
      </div>
      <div className="col-span-2 col-start-1 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[calc(3.5rem+0.75rem)] md:contents">
        <div>
          {large ? (
            <Pill tone="warning" className="tabular-nums">
              {reservation.partySize} large
            </Pill>
          ) : (
            <span className="text-sm tabular-nums">
              <span className="sr-only">Party of </span>
              {reservation.partySize}
            </span>
          )}
        </div>
        <div className="text-sm">
          {tableNames.length > 0 ? (
            tableNames.join(", ")
          ) : (
            <Pill tone="danger">Unassigned</Pill>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 md:basis-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={reservation.guest.consent === "granted" ? "success" : "muted"}>
              {consentLabel(reservation.guest.consent)}
            </Pill>
            <span data-slot="reconfirmation">
              <ReconfirmationPill value={reservation.reconfirmation} />
            </span>
            {reservation.rating ? (
              <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                <StarIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Rating </span>
                {reservation.rating}
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
    </li>
  );
}

export function ReconfirmationPill({ value }: { value: Reconfirmation | undefined }) {
  if (!value || value === "none") return null;
  const r = RECONFIRMATION[value];
  return <Pill tone={r.tone}>{r.label}</Pill>;
}

function WaitlistPending({ entries }: { entries: WaitlistEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-display text-lg">Waitlist now ({entries.length})</h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm print:rounded-none print:border-x-0">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <span className="font-medium">{e.guestName || "—"}</span>
            <span className="text-muted-foreground">
              Party of {e.partySize}
              {e.zone && ` · ${e.zone}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
