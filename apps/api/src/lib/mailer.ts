import { renderEmailHtml, type EmailLayout } from "./email-layout";

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

// Placeholder wording, like the texts below. The layout takes it as parameters (ADR-0024 will feed it from a catalog).
const VENUE_FOOTER = "Reservas con OpenCovers";

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

// Placeholder templates. The wording and the legal basis are pending review. Emails to the guest carry no
// guest name: whoever books types it, so it would put a stranger's text, links included, in the guest's inbox.
export function buildEmail(kind: EmailKind, c: EmailContext): { subject: string; text: string; html: string } {
  const page = (heading: string, text: string) =>
    renderEmailHtml({
      brand: venueBrand(c.venueName),
      heading,
      blocks: [{ kind: "paragraph", text }],
      footer: VENUE_FOOTER,
      lang: "es",
    });
  switch (kind) {
    case "confirmation": {
      const text = `Hola, tu reserva para ${c.partySize} personas el ${c.date} a las ${c.time} está confirmada.`;
      return {
        subject: `Tu reserva está confirmada — ${c.date} a las ${c.time}`,
        text,
        html: page("Tu reserva está confirmada", text),
      };
    }
    case "cancellation": {
      const text = `Hola, tu reserva del ${c.date} a las ${c.time} ha sido cancelada.`;
      return {
        subject: `Tu reserva está cancelada — ${c.date} a las ${c.time}`,
        text,
        html: page("Tu reserva está cancelada", text),
      };
    }
    case "notice": {
      const text = `Nueva reserva para ${c.partySize} personas el ${c.date} a las ${c.time} (${c.guestName || "sin nombre"}).`;
      return { subject: `Nueva reserva — ${c.date} a las ${c.time}`, text, html: page("Nueva reserva", text) };
    }
  }
}

// The `self_service_link` kind (ADR-0017), a placeholder like the templates above, pending the same review. It
// carries only what the engine wrote: dates, times, party sizes and links. No name, note or other text a guest typed.
export function buildLinkEmail(
  lines: readonly LinkLine[],
  venueName?: string,
): { subject: string; text: string; html: string } {
  const bookings = lines.map((l) => `- ${l.date} a las ${l.time}, ${l.partySize} personas: ${l.url}`).join("\n");
  const subject = "Tu enlace para gestionar tu reserva";
  const intro = "Hola, aquí tienes un enlace nuevo para ver, cambiar o cancelar tu reserva:";
  const outro = "Los enlaces anteriores ya no funcionan.";
  return {
    subject,
    text: `${intro}\n\n${bookings}\n\n${outro}`,
    html: renderEmailHtml({
      brand: venueBrand(venueName),
      heading: subject,
      blocks: [
        { kind: "paragraph", text: intro },
        ...lines.flatMap((l): EmailLayout["blocks"][number][] => [
          { kind: "paragraph", text: `${l.date} a las ${l.time}, ${l.partySize} personas` },
          { kind: "button", label: "Gestionar mi reserva", url: l.url },
        ]),
        { kind: "paragraph", text: outro },
      ],
      footer: VENUE_FOOTER,
      lang: "es",
    }),
  };
}
