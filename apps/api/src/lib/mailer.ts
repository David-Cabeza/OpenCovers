const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export type EmailKind = "confirmation" | "cancellation" | "notice";

interface EmailContext {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  service: string;
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
    body: JSON.stringify({ from: fromAddress, to: [to], subject, text }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

// Placeholder templates. The wording and the legal basis are pending review. Emails to the guest carry no
// guest name: whoever books types it, so it would put a stranger's text, links included, in the guest's inbox.
export function buildEmail(kind: EmailKind, c: EmailContext): { subject: string; text: string } {
  switch (kind) {
    case "confirmation":
      return {
        subject: `Tu reserva está confirmada — ${c.date} a las ${c.time}`,
        text: `Hola, tu reserva para ${c.partySize} personas el ${c.date} a las ${c.time} está confirmada.`,
      };
    case "cancellation":
      return {
        subject: `Tu reserva está cancelada — ${c.date} a las ${c.time}`,
        text: `Hola, tu reserva del ${c.date} a las ${c.time} ha sido cancelada.`,
      };
    case "notice":
      return {
        subject: `Nueva reserva — ${c.date} a las ${c.time}`,
        text: `Nueva reserva para ${c.partySize} personas el ${c.date} a las ${c.time} (${c.guestName || "sin nombre"}).`,
      };
  }
}

// The `self_service_link` kind (ADR-0017), a placeholder like the templates above, pending the same review. It
// carries only what the engine wrote: dates, times, party sizes and links. No name, note or other text a guest typed.
export function buildLinkEmail(lines: readonly LinkLine[]): { subject: string; text: string } {
  const bookings = lines.map((l) => `- ${l.date} a las ${l.time}, ${l.partySize} personas: ${l.url}`).join("\n");
  return {
    subject: "Tu enlace para gestionar tu reserva",
    text: `Hola, aquí tienes un enlace nuevo para ver, cambiar o cancelar tu reserva:\n\n${bookings}\n\nLos enlaces anteriores ya no funcionan.`,
  };
}
