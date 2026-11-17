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
