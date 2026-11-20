// A calendar entry (RFC 5545) for a reservation, attached to the confirmation, the change and the cancellation.
//
// The UID is stable per reservation and SEQUENCE is the reservation's version, so a change or a cancel replaces the
// entry the guest's calendar already holds. Instants are UTC, taken from the stored `startsAt` and `endsAt`. Only
// engine and venue data goes in: never text a guest typed. Lines end in CRLF and fold at 75 octets (RFC 5545 3.1).

import { createHash } from "node:crypto";

export interface IcsEvent {
  uid: string;
  /** The reservation's version. A higher one replaces a lower one in the calendar. */
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  /** `CANCELLED` is sent with `method: "CANCEL"`. */
  status: "CONFIRMED" | "CANCELLED";
  /** `PUBLISH` adds or updates the entry without asking the guest to reply. */
  method: "PUBLISH" | "CANCEL";
  /** When this copy was made. */
  stamp: Date;
  /** The reminder text. Set it to add a display alarm two hours ahead. */
  alarm?: string;
}

/** A stable calendar UID for a reservation that does not reveal its id. */
export function icsUid(venueId: string, reservationId: string): string {
  return `${createHash("sha256").update(`${venueId}:${reservationId}`).digest("hex").slice(0, 32)}@opencovers.dev`;
}

/** `20261201T193000Z` for an instant. */
export function icsInstant(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** TEXT escaping: backslash, semicolon, comma and line breaks (RFC 5545 3.3.11). Control characters are dropped. */
export function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds one content line at 75 octets, never inside a UTF-8 sequence. Continuation lines start with a space. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space counts
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenCovers//Reservations//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsInstant(e.stamp)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(e.sequence))}`,
    `DTSTART:${icsInstant(e.start)}`,
    `DTEND:${icsInstant(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    `STATUS:${e.status}`,
    "TRANSP:OPAQUE",
    ...(e.alarm && e.status === "CONFIRMED"
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.alarm)}`, "TRIGGER:-PT2H", "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
