import type { PillTone } from "@/components/pill";
import { t, type MessageKey } from "@/i18n";
import { dateTime } from "@/lib/date";

export type TraceSource = "widget" | "staff" | "api";

/** One event of a reservation as the API sends it (`GET .../reservations/{id}/trace`). */
export interface TraceEntryDto {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
}

export interface ReservationTraceDto {
  reservationId: string;
  source: TraceSource;
  actor: string;
  entries: TraceEntryDto[];
}

/** One line of the trace as the panel shows it. */
export interface TraceEntry {
  id: string;
  /** The event type as the API sends it; the label is read with `eventLabel` when shown, so it follows the language. */
  type: string;
  tone: PillTone;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
}

export interface Trace {
  source: TraceSource;
  actor: string;
  entries: TraceEntry[];
}

const EVENT_TYPES: Record<string, { key: MessageKey; tone: PillTone }> = {
  created: { key: "reservation.trace.event.created", tone: "info" },
  modified: { key: "reservation.trace.event.modified", tone: "muted" },
  seated: { key: "common.status.seated", tone: "success" },
  attended: { key: "common.status.attended", tone: "muted" },
  no_show: { key: "reservation.trace.event.no_show", tone: "warning" },
  cancelled: { key: "common.status.cancelled", tone: "danger" },
  erased: { key: "reservation.trace.event.erased", tone: "muted" },
};

const SOURCES: Record<TraceSource, MessageKey> = {
  widget: "reservation.trace.source.widget",
  staff: "reservation.trace.source.staff",
  api: "reservation.trace.source.api",
};

/** A type this app does not know yet still shows, under its own name. */
export function eventLabel(type: string): { label: string; tone: PillTone } {
  const known = EVENT_TYPES[type];
  return known ? { label: t(known.key), tone: known.tone } : { label: type, tone: "muted" };
}

export function sourceLabel(source: TraceSource): string {
  return SOURCES[source] ? t(SOURCES[source]) : source;
}

export function actorLabel(trace: Pick<Trace, "source" | "actor">): string {
  return trace.source === "widget" ? t("reservation.trace.guestViaWidget") : trace.actor;
}

export function toTrace(dto: ReservationTraceDto): Trace {
  return {
    source: dto.source,
    actor: dto.actor,
    entries: dto.entries.map((e) => ({
      id: e.eventId,
      type: e.type,
      tone: eventLabel(e.type).tone,
      version: e.version,
      occurredAt: e.occurredAt,
      idempotencyKey: e.idempotencyKey,
    })),
  };
}

export function traceTime(iso: string): string {
  return dateTime(iso, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
