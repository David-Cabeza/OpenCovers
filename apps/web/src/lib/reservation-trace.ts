import type { PillTone } from "@/components/pill";
import { t, type MessageKey } from "@/i18n";
import { dateTime } from "@/lib/date";

export type TraceChannel = "widget" | "staff" | "api" | "mcp";

/** One event of a reservation as the API sends it (`GET .../reservations/{id}/trace`). */
export interface TraceEntryDto {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  idempotencyKey: string | null;
  /** Absent from a server older than ADR-0023's trace; read as unknown. */
  channel?: TraceChannel | null;
  actor?: string | null;
  recorded?: boolean;
}

/** The top-level `source` and `actor` are deprecated (the booking's creator); the app reads each entry instead. */
export interface ReservationTraceDto {
  reservationId: string;
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
  channel: TraceChannel | null;
  actor: string | null;
  /** False when the origin was not stored: the channel is inferred from the booking, or unknown. */
  recorded: boolean;
}

export interface Trace {
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

const CHANNELS: Record<TraceChannel, MessageKey> = {
  widget: "reservation.trace.channel.widget",
  staff: "reservation.trace.channel.staff",
  api: "reservation.trace.channel.api",
  mcp: "reservation.trace.channel.mcp",
};

/** A type this app does not know yet still shows, under its own name. */
export function eventLabel(type: string): { label: string; tone: PillTone } {
  const known = EVENT_TYPES[type];
  return known ? { label: t(known.key), tone: known.tone } : { label: type, tone: "muted" };
}

/** Where a change came from. A channel the app does not know, or none, reads as unknown; an inferred one says so. */
export function channelLabel(entry: Pick<TraceEntry, "channel" | "recorded">): string {
  const key = entry.channel ? CHANNELS[entry.channel] : undefined;
  if (!key) return t("reservation.trace.channel.unknown");
  return entry.recorded ? t(key) : t("reservation.trace.channel.inferred", { channel: t(key) });
}

/** Who made it, as a label. Null when there is nothing honest to show. */
export function actorLabel(entry: Pick<TraceEntry, "channel" | "actor" | "recorded">): string | null {
  if (!entry.recorded) return null;
  switch (entry.channel) {
    case "widget":
      return t("reservation.trace.guestViaWidget");
    case "staff":
      return entry.actor ?? t("reservation.trace.actor.staff");
    case "api":
    case "mcp":
      return entry.actor ? t("reservation.trace.actor.key", { key: entry.actor }) : null;
    default:
      return null;
  }
}

export function toTrace(dto: ReservationTraceDto): Trace {
  return {
    entries: dto.entries.map((e) => ({
      id: e.eventId,
      type: e.type,
      tone: eventLabel(e.type).tone,
      version: e.version,
      occurredAt: e.occurredAt,
      idempotencyKey: e.idempotencyKey,
      channel: e.channel ?? null,
      actor: e.actor ?? null,
      recorded: e.recorded ?? false,
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
