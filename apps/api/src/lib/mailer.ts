import { renderEmailHtml, renderEmailText, DEFAULT_ACCENT, type EmailBlock, type EmailLayout, type EmailRow } from "./email-layout";
import {
  EMAIL_CATALOGS,
  formatEmailDay,
  formatEmailDayShort,
  magicLinkMessages,
  message,
  partyLabel,
  resolveEmailLocale,
  type EmailMessageId,
} from "./email-messages";
import type { EmailVenue } from "./email-venue";
import { buildIcs, icsInstant, type IcsEvent } from "./ics";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export type EmailKind = "confirmation" | "cancellation" | "notice";

/**
 * Whether the guest's confirmation carries the self-service link (ADR-0017 stage 8). It stays off: the stage waits
 * on the legal review of REQ-N2. The layout slot and the catalog keys `confirmation.manage` and
 * `confirmation.manageHint` are built so that turning it on is this one constant plus the caller passing a `manageUrl`.
 */
export const GUEST_MANAGE_LINK_ENABLED = false;

/** The longest subject line a builder produces. Inboxes cut longer ones, and the day and time are at the end. */
export const MAX_SUBJECT_LENGTH = 60;

interface EmailContext {
  date: string;
  time: string;
  partySize: number;
  /** The venue's name for the service (dinner, lunch). It is configuration, not guest text. */
  service: string;
  /** The booking's guest name, typed by the guest. Used by the venue's `notice` only, never in a mail to the guest. */
  guestName?: string;
  /** The venue the mail is sent on behalf of. Without it the mail is branded OpenCovers. */
  venue?: EmailVenue;
  /** The reservation as the calendar sees it. Without it no calendar entry is built. */
  booking?: { uid: string; version: number; startsAt: Date; endsAt: Date };
  /** The guest's self-service link, used only while `GUEST_MANAGE_LINK_ENABLED` is on. */
  manageUrl?: string;
  /** For the calendar entry's stamp. Tests pass it. */
  now?: Date;
}

/** A file for Resend's `attachments`: `content` is Base64, as its API takes it. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

/** One booking in a `self_service_link` email: when, how many, and its new link. */
export interface LinkLine {
  date: string;
  time: string;
  partySize: number;
  url: string;
}

/** Whether `sendEmail` would reach Resend for a venue, rather than skip with a warning. */
export function canSendEmail(apiKey: string | null, from: string): boolean {
  return Boolean((apiKey || RESEND_API_KEY) && (from || RESEND_FROM_EMAIL));
}

export async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
  html?: string,
  attachments: readonly EmailAttachment[] = [],
): Promise<void> {
  const key = apiKey || RESEND_API_KEY;
  const fromAddress = from || RESEND_FROM_EMAIL;
  if (!key || !fromAddress) {
    console.warn("email not sent: missing Resend API key or from address");
    return;
  }
  const post = (withAttachments: boolean) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
        // Resend's `attachments` take `filename` and a Base64 `content`; the type comes from the file name.
        ...(withAttachments && attachments.length > 0 ? { attachments } : {}),
      }),
    });
  let res = await post(true);
  // A calendar file must never cost the guest the mail itself: if Resend refuses the request, send it without.
  if (!res.ok && attachments.length > 0 && (res.status === 400 || res.status === 422)) res = await post(false);
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

/** The subject for `base` (`confirmation.subject` and `confirmation.subjectNoVenue`), cut to `MAX_SUBJECT_LENGTH`. */
function subjectLine(
  locale: string,
  base: string,
  venueName: string,
  slots: Record<string, string | number>,
): string {
  const withVenue = `${base}.subject` as EmailMessageId;
  const without = `${base}.subjectNoVenue` as EmailMessageId;
  const hasVenueSlot = EMAIL_CATALOGS.es[withVenue].includes("{venue}");
  if (!hasVenueSlot) return message(locale, withVenue, slots);
  if (!venueName) return message(locale, without, slots);
  const line = message(locale, withVenue, { ...slots, venue: venueName });
  if (line.length <= MAX_SUBJECT_LENGTH) return line;
  // Cut the venue name, never the day and time, and mark the cut.
  const keep = Math.max(1, venueName.length - (line.length - MAX_SUBJECT_LENGTH) - 1);
  return message(locale, withVenue, { ...slots, venue: `${venueName.slice(0, keep).trimEnd()}…` });
}

/** The longest guest name the notice shows. */
export const MAX_NOTICE_NAME = 80;

/** A guest-typed name as one safe line: control characters and line breaks become spaces, and it is cut. */
export function noticeName(raw: string | undefined): string {
  const line = (raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > MAX_NOTICE_NAME ? `${chars.slice(0, MAX_NOTICE_NAME - 1).join("").trimEnd()}…` : line;
}

function brandOf(venue: EmailVenue | undefined): Pick<EmailLayout, "brand" | "accent"> {
  return venue?.name
    ? { brand: { kind: "venue", name: venue.name, ...(venue.logoUrl ? { logoUrl: venue.logoUrl } : {}) }, accent: venue.accent }
    : { brand: { kind: "opencovers" }, accent: DEFAULT_ACCENT };
}

function googleCalendarUrl(summary: string, location: string | undefined, start: Date, end: Date): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: summary, dates: `${icsInstant(start)}/${icsInstant(end)}` });
  if (location) q.set("location", location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// The wording and the legal basis are pending review (REQ-N2). Emails to the guest carry no guest name or other typed
// text: whoever books types it, so it would put a stranger's text, links included, in the guest's inbox. The venue's
// notice keeps the same rule, so nothing a guest typed reaches either inbox. `requested` is the resolved locale
// (`resolveEmailLocale`); a locale without a catalog reads, and dates, in es.
export function buildEmail(
  kind: EmailKind,
  c: EmailContext,
  requested: string,
  { manageLinkEnabled = GUEST_MANAGE_LINK_ENABLED }: { manageLinkEnabled?: boolean } = {},
): BuiltEmail {
  const locale = resolveEmailLocale(requested, null);
  const venue = c.venue;
  const venueName = venue?.name ?? "";
  // A confirmation after the first version is the confirmation of a change.
  const base = kind === "confirmation" && c.booking && c.booking.version > 1 ? "modification" : kind;
  const day = formatEmailDay(c.date, locale);
  const party = partyLabel(locale, c.partySize);
  const slots = { day, dayShort: formatEmailDayShort(c.date, locale), time: c.time, party };
  const id = (suffix: string) => `${base}.${suffix}` as EmailMessageId;
  const lead = venueName
    ? message(locale, id("lead"), { venue: venueName, ...slots })
    : message(locale, id("leadNoVenue"), slots);

  const rows: EmailRow[] = [
    { label: message(locale, "row.day"), value: day },
    { label: message(locale, "row.time"), value: c.time },
    { label: message(locale, "row.party"), value: String(c.partySize) },
  ];
  // Only the venue's own notice names the guest. It goes to staff, who see the name in the agenda; the guest's
  // mails never carry it. It is plain text in a row, never a link.
  const guest = kind === "notice" ? noticeName(c.guestName) : "";
  if (guest) rows.push({ label: message(locale, "row.guest"), value: guest });
  const service = c.service.trim();
  if (service) rows.push({ label: message(locale, "row.service"), value: service });
  if (kind !== "notice") {
    if (venue?.address) rows.push({ label: message(locale, "row.where"), value: venue.address, ...(venue.mapUrl ? { href: venue.mapUrl } : {}) });
    if (venue?.phone) rows.push({ label: message(locale, "row.phone"), value: venue.phone.display, href: venue.phone.href });
  }

  const blocks: EmailBlock[] = [{ kind: "paragraph", text: lead }, { kind: "summary", rows }];
  const attachments: EmailAttachment[] = [];

  if (kind !== "notice") {
    const cancelled = kind === "cancellation";
    if (!cancelled && venue?.mapUrl) blocks.push({ kind: "button", label: message(locale, "map.open"), url: venue.mapUrl });
    if (c.booking) {
      const summary = venueName ? message(locale, "ics.summary", { venue: venueName }) : message(locale, "ics.summaryNoVenue");
      const location = venue?.address ? [venueName, venue.address].filter(Boolean).join(", ") : undefined;
      const description = [message(locale, "ics.description", { party }), service].filter(Boolean).join(" ");
      const event: IcsEvent = {
        uid: c.booking.uid,
        sequence: c.booking.version,
        start: c.booking.startsAt,
        end: c.booking.endsAt,
        summary: cancelled ? message(locale, "ics.cancelled", { summary }) : summary,
        ...(location ? { location } : {}),
        description,
        status: cancelled ? "CANCELLED" : "CONFIRMED",
        method: cancelled ? "CANCEL" : "PUBLISH",
        stamp: c.now ?? new Date(),
        ...(cancelled ? {} : { alarm: message(locale, "ics.alarm", { time: c.time }) }),
      };
      attachments.push({ filename: cancelled ? "reserva-cancelada.ics" : "reserva.ics", content: Buffer.from(buildIcs(event), "utf8").toString("base64") });
      if (cancelled) {
        blocks.push({ kind: "note", text: message(locale, "calendar.removed") });
      } else {
        blocks.push({
          kind: "button",
          label: message(locale, "calendar.add"),
          url: googleCalendarUrl(summary, location, c.booking.startsAt, c.booking.endsAt),
          style: "secondary",
        });
        blocks.push({ kind: "note", text: message(locale, base === "modification" ? "calendar.updated" : "calendar.attached") });
      }
    }
    if (cancelled) {
      blocks.push({ kind: "paragraph", text: message(locale, "cancellation.again") });
    } else {
      blocks.push({ kind: "paragraph", text: message(locale, "confirmation.change") });
      if (manageLinkEnabled && c.manageUrl) {
        blocks.push({ kind: "paragraph", text: message(locale, "confirmation.manageHint") });
        blocks.push({ kind: "button", label: message(locale, "confirmation.manage"), url: c.manageUrl });
      }
    }
  } else {
    blocks.push({ kind: "paragraph", text: message(locale, "notice.where") });
  }

  const footerNote =
    kind === "notice"
      ? venueName
        ? message(locale, "footer.notice", { venue: venueName })
        : undefined
      : venueName
        ? message(locale, "footer.why", { venue: venueName })
        : message(locale, "footer.whyNoVenue");

  const layout: EmailLayout = {
    ...brandOf(venue),
    preheader: message(locale, id("preheader"), slots),
    heading: message(locale, id("heading")),
    blocks,
    footer: message(locale, "footer"),
    ...(footerNote ? { footerNote } : {}),
    lang: locale,
  };
  return {
    subject: subjectLine(locale, base, venueName, slots),
    text: renderEmailText(layout),
    html: renderEmailHtml(layout),
    attachments,
  };
}

// The `self_service_link` kind (ADR-0017), a placeholder like the templates above, pending the same review. It
// carries only what the engine wrote: dates, times, party sizes and links. No name, note or other text a guest typed.
export function buildLinkEmail(lines: readonly LinkLine[], requested: string, venue?: EmailVenue): BuiltEmail {
  const locale = resolveEmailLocale(requested, null);
  const venueName = venue?.name ?? "";
  const blocks: EmailBlock[] = [
    { kind: "paragraph", text: message(locale, lines.length > 1 ? "link.intro.many" : "link.intro") },
    ...lines.flatMap((l): EmailBlock[] => [
      {
        kind: "summary",
        rows: [
          { label: message(locale, "row.day"), value: formatEmailDay(l.date, locale) },
          { label: message(locale, "row.time"), value: l.time },
          { label: message(locale, "row.party"), value: String(l.partySize) },
        ],
      },
      { kind: "button", label: message(locale, "link.button"), url: l.url, showUrl: true },
    ]),
    { kind: "paragraph", text: message(locale, "link.outro") },
  ];
  const layout: EmailLayout = {
    ...brandOf(venue),
    preheader: message(locale, "link.preheader"),
    heading: message(locale, "link.heading"),
    blocks,
    footer: message(locale, "footer"),
    footerNote: venueName ? message(locale, "footer.why", { venue: venueName }) : message(locale, "footer.whyNoVenue"),
    lang: locale,
  };
  return {
    subject: subjectLine(locale, "link", venueName, {}),
    text: renderEmailText(layout),
    html: renderEmailHtml(layout),
    attachments: [],
  };
}

/** What the waitlist join email says (C70): only what the engine stored, never the guest's name. */
export interface WaitlistJoinMail {
  date: string;
  window: { from: string; to: string } | null;
  partySize: number;
  /** The leave link, `/r/waitlist?lang=<locale>#<token>` on the widget origin. */
  url: string;
}

// The waitlist join kind (ADR-0021, section 3, C70). PROVISIONAL like the templates above: its text waits for the
// legal review of the consent and email wording (ADR-0021, Q11). One email per successful join, sent after the commit.
export function buildWaitlistJoinEmail(mail: WaitlistJoinMail, requested: string, venue?: EmailVenue): BuiltEmail {
  const locale = resolveEmailLocale(requested, null);
  const venueName = venue?.name ?? "";
  const day = formatEmailDay(mail.date, locale);
  const slots = { day, dayShort: formatEmailDayShort(mail.date, locale), party: partyLabel(locale, mail.partySize) };
  const rows: EmailRow[] = [{ label: message(locale, "row.day"), value: day }];
  if (mail.window) rows.push({ label: message(locale, "row.window"), value: `${mail.window.from}–${mail.window.to}` });
  rows.push({ label: message(locale, "row.party"), value: String(mail.partySize) });
  const layout: EmailLayout = {
    ...brandOf(venue),
    preheader: message(locale, "waitlist.preheader", slots),
    heading: message(locale, "waitlist.heading"),
    blocks: [
      {
        kind: "paragraph",
        text: venueName ? message(locale, "waitlist.lead", { venue: venueName }) : message(locale, "waitlist.leadNoVenue"),
      },
      { kind: "summary", rows },
      { kind: "paragraph", text: message(locale, "waitlist.leaveHint") },
      { kind: "button", label: message(locale, "waitlist.leave"), url: mail.url, showUrl: true },
      { kind: "paragraph", text: message(locale, "waitlist.outro") },
    ],
    footer: message(locale, "footer"),
    footerNote: venueName
      ? message(locale, "footer.whyWaitlist", { venue: venueName })
      : message(locale, "footer.whyWaitlistNoVenue"),
    lang: locale,
  };
  return {
    subject: subjectLine(locale, "waitlist", venueName, slots),
    text: renderEmailText(layout),
    html: renderEmailHtml(layout),
    attachments: [],
  };
}

/** The demo's sign-in mail. OpenCovers sends it itself, so it is fully branded: no venue stands behind it. */
export function buildMagicLinkEmail(locale: string, url: string): BuiltEmail {
  const { lang, text: t } = magicLinkMessages(locale);
  const layout: EmailLayout = {
    brand: { kind: "opencovers" },
    preheader: t.preheader,
    heading: t.heading,
    blocks: [
      { kind: "paragraph", text: t.intro },
      { kind: "button", label: t.button, url, showUrl: true },
      { kind: "paragraph", text: t.outro },
    ],
    footer: t.footer,
    lang,
  };
  return { subject: t.subject, text: renderEmailText(layout), html: renderEmailHtml(layout), attachments: [] };
}
