import type { PillTone } from "@/components/pill";

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
  label: string;
  tone: PillTone;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
}

export interface Trace {
  source: TraceSource;
  sourceLabel: string;
  actorLabel: string;
  entries: TraceEntry[];
}

const EVENT_TYPES: Record<string, { label: string; tone: PillTone }> = {
  created: { label: "Booked", tone: "info" },
  modified: { label: "Changed", tone: "muted" },
  seated: { label: "Seated", tone: "success" },
  attended: { label: "Attended", tone: "muted" },
  no_show: { label: "Marked no-show", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
  erased: { label: "Personal data erased", tone: "muted" },
};

const SOURCES: Record<TraceSource, string> = {
  widget: "Online booking widget",
  staff: "Staff app",
  api: "API or MCP",
};

/** A type this app does not know yet still shows, under its own name. */
export function eventLabel(type: string): { label: string; tone: PillTone } {
  return EVENT_TYPES[type] ?? { label: type, tone: "muted" };
}

export function toTrace(dto: ReservationTraceDto): Trace {
  return {
    source: dto.source,
    sourceLabel: SOURCES[dto.source] ?? dto.source,
    actorLabel: dto.source === "widget" ? "A guest, through the widget" : dto.actor,
    entries: dto.entries.map((e) => ({
      id: e.eventId,
      ...eventLabel(e.type),
      version: e.version,
      occurredAt: e.occurredAt,
      idempotencyKey: e.idempotencyKey,
    })),
  };
}

export function traceTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
