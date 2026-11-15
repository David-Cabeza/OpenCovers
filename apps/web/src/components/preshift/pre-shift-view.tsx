import { useState } from "react";
import { ClipboardListIcon, PrinterIcon, StarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { CONSENT_OPTIONS } from "@/components/reservation/consent-select";
import { useAgenda } from "@/hooks/use-agenda";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { useWaitlist } from "@/hooks/use-waitlist";
import type { Consent, WaitlistEntry } from "@/lib/api";
import { todayIso } from "@/lib/date";
import { buildPreShift, LARGE_PARTY_MIN, totalCovers, type PreShiftRow } from "@/lib/pre-shift";

const ALL_SERVICES = "all";

const consentLabel = (consent: Consent | undefined) =>
  CONSENT_OPTIONS.find((o) => o.value === (consent ?? "unknown"))?.label ?? "Not asked";

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Pre-shift</h2>
          <p className="text-sm text-muted-foreground">
            Who is coming and what they need, before service.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SERVICES}>All services</SelectItem>
              {(services.data?.services ?? []).map((s) => (
                <SelectItem key={s.name} value={s.name} className="capitalize">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-fit"
          />
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon className="size-4" />
            Print
          </Button>
        </div>
      </div>

      <p className="hidden text-sm print:block">
        {date}
        {service !== ALL_SERVICES && ` · ${service}`}
      </p>

      {agenda.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title="Nobody expected"
          description="No upcoming reservations for this day and service."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} reservations · {totalCovers(rows)} covers
            {largeCount > 0 && ` · ${largeCount} large (${LARGE_PARTY_MIN}+)`}
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Consent</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <PreShiftRowView key={row.reservation.id} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <WaitlistPending entries={entries} />
    </div>
  );
}

function PreShiftRowView({ row }: { row: PreShiftRow }) {
  const { reservation, tableNames, large, commentary } = row;
  return (
    <TableRow className={large ? "bg-amber-500/10 print:bg-transparent" : undefined}>
      <TableCell className="font-medium tabular-nums">{reservation.time}</TableCell>
      <TableCell>
        <div className="font-medium">{reservation.guest.name || "—"}</div>
        {reservation.guest.contact && (
          <div className="text-xs text-muted-foreground">{reservation.guest.contact}</div>
        )}
      </TableCell>
      <TableCell>
        {large ? (
          <Badge className="tabular-nums">{reservation.partySize} large</Badge>
        ) : (
          <span className="tabular-nums">{reservation.partySize}</span>
        )}
      </TableCell>
      <TableCell>{tableNames.length > 0 ? tableNames.join(", ") : "Unassigned"}</TableCell>
      <TableCell>
        <Badge variant={reservation.guest.consent === "granted" ? "secondary" : "outline"}>
          {consentLabel(reservation.guest.consent)}
        </Badge>
      </TableCell>
      <TableCell>
        {reservation.rating ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <StarIcon className="size-3.5" />
            {reservation.rating}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell data-slot="booking-note" className="max-w-64 whitespace-normal">
        {commentary ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
    </TableRow>
  );
}

function WaitlistPending({ entries }: { entries: WaitlistEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-medium">Waitlist now ({entries.length})</h3>
      <ul className="divide-y rounded-lg border text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2">
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
