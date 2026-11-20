import { renderEmailHtml, type EmailLayout } from "./email-layout";
import { formatEmailDate, message, resolveEmailLocale } from "./email-messages";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export type EmailKind = "confirmation" | "cancellation" | "notice";

interface EmailContext {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  service: string;
  /** The venue the mail is sent on behalf of. It leads the HTML; empty falls back to OpenCovers branding. */
  venueName?: string;
}

/** Mail to a guest or staff is the restaurant's, with a small OpenCovers credit in the footer. */
function venueBrand(name: string | undefined): EmailLayout["brand"] {
  const trimmed = name?.trim();
  return trimmed ? { kind: "venue", name: trimmed } : { kind: "opencovers" };
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
): Promise<void> {
  const key = apiKey || RESEND_API_KEY;
  const fromAddress = from || RESEND_FROM_EMAIL;
  if (!key || !fromAddress) {
    console.warn("email not sent: missing Resend API key or from address");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ from: fromAddress, to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

// Placeholder templates, now catalogs (email-messages.ts). The wording and the legal basis are pending review.
// Emails to the guest carry no guest name: whoever books types it, so it would put a stranger's text, links
// included, in the guest's inbox. `requested` is the resolved locale (`resolveEmailLocale`); a locale without a
// catalog reads, and dates, in es.
export function buildEmail(
  kind: EmailKind,
  c: EmailContext,
  requested: string,
): { subject: string; text: string; html: string } {
  const locale = resolveEmailLocale(requested, null);
  const slots = { date: formatEmailDate(c.date, locale), time: c.time, partySize: c.partySize };
  // The notice goes to the venue, not the guest, so it keeps the name (or none) and the venue's locale.
  const text = message(locale, `${kind}.text`, {
    ...slots,
    guestName: c.guestName || message(locale, "notice.noName"),
  });
  const heading = message(locale, `${kind}.heading`);
  return {
    subject: message(locale, `${kind}.subject`, slots),
    text,
    html: renderEmailHtml({
      brand: venueBrand(c.venueName),
      heading,
      blocks: [{ kind: "paragraph", text }],
      footer: message(locale, "footer"),
      lang: locale,
    }),
  };
}

// The `self_service_link` kind (ADR-0017), a placeholder like the templates above, pending the same review. It
// carries only what the engine wrote: dates, times, party sizes and links. No name, note or other text a guest typed.
export function buildLinkEmail(
  lines: readonly LinkLine[],
  requested: string,
  venueName?: string,
): { subject: string; text: string; html: string } {
  const locale = resolveEmailLocale(requested, null);
  const rows = lines.map((l) => ({
    booking: message(locale, "link.booking", { date: formatEmailDate(l.date, locale), time: l.time, partySize: l.partySize }),
    url: l.url,
  }));
  const intro = message(locale, "link.intro");
  const outro = message(locale, "link.outro");
  const bookings = rows.map((r) => message(locale, "link.line", r)).join("\n");
  const subject = message(locale, "link.subject");
  return {
    subject,
    text: `${intro}\n\n${bookings}\n\n${outro}`,
    html: renderEmailHtml({
      brand: venueBrand(venueName),
      heading: subject,
      blocks: [
        { kind: "paragraph", text: intro },
        ...rows.flatMap((r): EmailLayout["blocks"][number][] => [
          { kind: "paragraph", text: r.booking },
          { kind: "button", label: message(locale, "link.button"), url: r.url },
        ]),
        { kind: "paragraph", text: outro },
      ],
      footer: message(locale, "footer"),
      lang: locale,
    }),
  };
}
