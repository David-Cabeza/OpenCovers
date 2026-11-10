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

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    console.warn("email not sent: RESEND_API_KEY or RESEND_FROM_EMAIL is not set");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

// Placeholder templates. The wording and the legal basis are pending review.
export function buildEmail(kind: EmailKind, c: EmailContext): { subject: string; text: string } {
  const guest = c.guestName || "Cliente";
  switch (kind) {
    case "confirmation":
      return {
        subject: `Tu reserva está confirmada — ${c.date} a las ${c.time}`,
        text: `Hola ${guest}, tu reserva para ${c.partySize} personas el ${c.date} a las ${c.time} está confirmada.`,
      };
    case "cancellation":
      return {
        subject: `Tu reserva está cancelada — ${c.date} a las ${c.time}`,
        text: `Hola ${guest}, tu reserva del ${c.date} a las ${c.time} ha sido cancelada.`,
      };
    case "notice":
      return {
        subject: `Nueva reserva — ${c.date} a las ${c.time}`,
        text: `Nueva reserva para ${c.partySize} personas el ${c.date} a las ${c.time} (${c.guestName || "sin nombre"}).`,
      };
  }
}
