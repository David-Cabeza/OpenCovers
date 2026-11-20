// The text of the emails the engine sends a guest (ADR-0024, stage 2). One catalog per locale, and only
// locales a native speaker reviewed ship (ADR-0024 Q3): the others are added later, one small PR each, by adding
// an entry to `EMAIL_CATALOGS`. Every catalog has the same ids and the same {slots} as `es`. Emails to the guest
// carry no guest name and no typed text (C61), and they are plain text.

const es = {
  // Words the booking card and the party size share.
  "party.one": "1 persona",
  "party.other": "{partySize} personas",
  "row.day": "Día",
  "row.time": "Hora",
  "row.party": "Personas",
  "row.service": "Servicio",
  "row.guest": "A nombre de",
  "row.where": "Dónde",
  "row.phone": "Teléfono",
  "map.open": "Cómo llegar",
  "calendar.add": "Añadir al calendario",
  "calendar.attached": "También la tienes adjunta como archivo .ics.",
  "calendar.updated": "El archivo .ics adjunto actualiza la reserva en tu calendario.",
  "calendar.removed": "Abre el archivo .ics adjunto para quitar la reserva de tu calendario.",
  // The guest's confirmation, after a change, and after a cancel.
  "confirmation.subject": "Reserva confirmada en {venue}: {dayShort}, {time}",
  "confirmation.subjectNoVenue": "Reserva confirmada: {dayShort}, {time}",
  "confirmation.preheader": "{day} a las {time}, {party}. Te esperamos.",
  "confirmation.heading": "Tu reserva está confirmada",
  "confirmation.lead": "Todo listo: tienes mesa en {venue} para {party}.",
  "confirmation.leadNoVenue": "Todo listo: tienes mesa para {party}.",
  "confirmation.change": "¿Cambio de planes? Avisa al restaurante cuanto antes: otro grupo podrá ocupar tu mesa.",
  // Stays off until ADR-0017 stage 8 passes legal review (REQ-N2). See `GUEST_MANAGE_LINK_ENABLED`.
  "confirmation.manage": "Gestionar mi reserva",
  "confirmation.manageHint": "Desde aquí puedes ver, cambiar o cancelar tu reserva.",
  "modification.subject": "Reserva modificada en {venue}: {dayShort}, {time}",
  "modification.subjectNoVenue": "Reserva modificada: {dayShort}, {time}",
  "modification.preheader": "Nuevo horario: {day} a las {time}, {party}.",
  "modification.heading": "Tu reserva ha cambiado",
  "modification.lead": "Hemos actualizado tu reserva en {venue}. Estos son los datos nuevos.",
  "modification.leadNoVenue": "Hemos actualizado tu reserva. Estos son los datos nuevos.",
  "cancellation.subject": "Reserva cancelada en {venue}: {dayShort}, {time}",
  "cancellation.subjectNoVenue": "Reserva cancelada: {dayShort}, {time}",
  "cancellation.preheader": "Cancelada: {day} a las {time}, {party}.",
  "cancellation.heading": "Tu reserva está cancelada",
  "cancellation.lead": "Hemos cancelado tu reserva en {venue}. Estos eran los datos.",
  "cancellation.leadNoVenue": "Hemos cancelado tu reserva. Estos eran los datos.",
  "cancellation.again": "¿Fue un error o quieres otro día? Contacta con el restaurante para reservar de nuevo.",
  // The venue's notice of a new booking.
  "notice.subject": "Nueva reserva: {party}, {dayShort} a las {time}",
  "notice.preheader": "{party}, {day} a las {time}.",
  "notice.heading": "Nueva reserva",
  "notice.lead": "Hay una reserva nueva en {venue}.",
  "notice.leadNoVenue": "Hay una reserva nueva.",
  "notice.where": "La encontrarás en la agenda de OpenCovers.",
  // The calendar entry.
  "ics.summary": "Reserva en {venue}",
  "ics.summaryNoVenue": "Reserva",
  "ics.cancelled": "Cancelada: {summary}",
  "ics.description": "Reserva para {party}.",
  "ics.alarm": "Tu reserva es en 2 horas, a las {time}.",
  // The self-service link (ADR-0017).
  "link.subject": "Tu enlace para gestionar tu reserva en {venue}",
  "link.subjectNoVenue": "Tu enlace para gestionar tu reserva",
  "link.preheader": "Un enlace nuevo para ver, cambiar o cancelar tu reserva.",
  "link.heading": "Tu enlace para gestionar tu reserva",
  "link.intro": "Aquí tienes un enlace nuevo para ver, cambiar o cancelar tu reserva.",
  "link.intro.many": "Aquí tienes un enlace nuevo para cada una de tus reservas.",
  "link.outro": "Los enlaces anteriores ya no funcionan. Si no lo has pedido tú, puedes ignorar este mensaje.",
  "link.button": "Gestionar mi reserva",
  // The public waitlist join (ADR-0021, section 3, C70). PROVISIONAL text, pending the legal review of the consent
  // and email wording (ADR-0021, Q11), like the placeholder templates above: replace it once the owner confirms it.
  // It holds the venue, the date, the window, the party and the leave link, and never the guest's name.
  "waitlist.subject": "Estás en la lista de espera de {venue}: {dayShort}",
  "waitlist.subjectNoVenue": "Estás en la lista de espera: {dayShort}",
  "waitlist.preheader": "{day}, {party}. Aún no tienes mesa.",
  "waitlist.heading": "Estás en la lista de espera",
  "waitlist.lead": "Te hemos apuntado en la lista de espera de {venue}. Esto no es una reserva: el restaurante te escribirá o te llamará si queda una mesa libre.",
  "waitlist.leadNoVenue": "Te hemos apuntado en la lista de espera. Esto no es una reserva: el restaurante te escribirá o te llamará si queda una mesa libre.",
  "waitlist.leaveHint": "Si ya no puedes venir, sal de la lista con este enlace.",
  "waitlist.leave": "Salir de la lista de espera",
  "waitlist.outro": "Solo te escribimos sobre esta solicitud. Si no la has hecho tú, puedes ignorar este mensaje.",
  "row.window": "Franja",
  "footer.whyWaitlist": "Recibes este mensaje porque te has apuntado en la lista de espera de {venue}.",
  "footer.whyWaitlistNoVenue": "Recibes este mensaje porque te has apuntado en una lista de espera.",
  "footer": "Reservas con OpenCovers",
  "footer.why": "Recibes este mensaje porque has hecho una reserva en {venue}.",
  "footer.whyNoVenue": "Recibes este mensaje porque has hecho una reserva.",
  "footer.notice": "Aviso automático de las reservas de {venue}.",
} as const;

/** The OpenCovers-owned sign-in mail of the hosted demo. English and Spanish, reviewed with the site copy. */
export interface MagicLinkMessages {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  button: string;
  outro: string;
  footer: string;
}

const MAGIC_LINK: Record<"es" | "en", MagicLinkMessages> = {
  es: {
    subject: "Tu enlace para entrar en la demo de OpenCovers",
    preheader: "Pulsa el enlace para entrar. Caduca en 5 minutos.",
    heading: "Entra en la demo",
    intro: "Pulsa el botón para entrar en la demo de OpenCovers. El enlace caduca en 5 minutos.",
    button: "Entrar en la demo",
    outro: "Si no lo has pedido tú, ignora este mensaje.",
    footer: "OpenCovers · opencovers.dev",
  },
  en: {
    subject: "Your link to the OpenCovers demo",
    preheader: "Tap the link to sign in. It expires in 5 minutes.",
    heading: "Sign in to the demo",
    intro: "Tap the button to sign in to the OpenCovers demo. The link expires in 5 minutes.",
    button: "Open the demo",
    outro: "If you did not ask for this, you can ignore this message.",
    footer: "OpenCovers · opencovers.dev",
  },
};

/** The sign-in mail text for a locale: Spanish for `es*`, English for everything else. */
export function magicLinkMessages(locale: string): { lang: "es" | "en"; text: MagicLinkMessages } {
  return locale.toLowerCase().startsWith("es") ? { lang: "es", text: MAGIC_LINK.es } : { lang: "en", text: MAGIC_LINK.en };
}

export const MAGIC_LINK_CATALOGS = MAGIC_LINK;

export type EmailMessageId = keyof typeof es;

/** The shipped catalogs. A locale without an entry here has no catalog yet and falls back (see `resolveEmailLocale`). */
export const EMAIL_CATALOGS: Readonly<Record<string, Readonly<Record<EmailMessageId, string>>>> = { es };

/** The locale every fallback ends in. */
export const FALLBACK_EMAIL_LOCALE = "es";

function hasCatalog(locale: string | null | undefined): locale is string {
  return typeof locale === "string" && Object.hasOwn(EMAIL_CATALOGS, locale);
}

/**
 * The locale of an email: the guest's stored locale if a catalog ships for it, else the venue's online-booking
 * locale if one does, else `es`. Never throws, whatever the inputs.
 */
export function resolveEmailLocale(stored: string | null | undefined, venue: string | null | undefined): string {
  if (hasCatalog(stored)) return stored;
  if (hasCatalog(venue)) return venue;
  return FALLBACK_EMAIL_LOCALE;
}

/** Fills `{slot}`s from `slots`. A slot with no value is left as written, and a value is never read for slots. */
export function fill(template: string, slots: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(slots, name) ? String(slots[name]) : whole));
}

/** The names of the `{slots}` in a template. */
export function slotNames(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** The message `id` in `locale`, with slots filled. A locale without a catalog reads `es`. */
export function message(locale: string, id: EmailMessageId, slots: Readonly<Record<string, string | number>> = {}): string {
  const catalog = hasCatalog(locale) ? EMAIL_CATALOGS[locale] : EMAIL_CATALOGS[FALLBACK_EMAIL_LOCALE];
  return fill(catalog[id], slots);
}

/**
 * A calendar date (`YYYY-MM-DD`) written for `locale`. Built from the calendar date and formatted in UTC, so no
 * timezone moves the day. Anything that is not a calendar date, or a locale the runtime rejects, comes back as given
 * or formatted in `es`: this never throws.
 */
export function formatEmailDate(date: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (at.toISOString().slice(0, 10) !== date) return date;
  for (const tag of [locale, FALLBACK_EMAIL_LOCALE]) {
    try {
      return new Intl.DateTimeFormat(tag, { dateStyle: "full", timeZone: "UTC" }).format(at);
    } catch {
      // try the fallback
    }
  }
  return date;
}

function formatUtc(date: string, locale: string, options: Intl.DateTimeFormatOptions): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (at.toISOString().slice(0, 10) !== date) return null;
  for (const tag of [locale, FALLBACK_EMAIL_LOCALE]) {
    try {
      const text = new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC" }).format(at);
      // Spanish writes "martes 1 de diciembre", with no comma after the weekday.
      return tag.startsWith("es") ? text.replace(",", "") : text;
    } catch {
      // try the fallback
    }
  }
  return null;
}

/** `martes 1 de diciembre`: the weekday and day of a calendar date, with no year, for the card and the text. */
export function formatEmailDay(date: string, locale: string): string {
  return formatUtc(date, locale, { weekday: "long", day: "numeric", month: "long" }) ?? date;
}

/** `mar 1 dic`: the short form for subject lines. */
export function formatEmailDayShort(date: string, locale: string): string {
  return (formatUtc(date, locale, { weekday: "short", day: "numeric", month: "short" }) ?? date).replace(/\./g, "");
}

/** `1 persona` or `4 personas`. */
export function partyLabel(locale: string, partySize: number): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(hasCatalog(locale) ? locale : FALLBACK_EMAIL_LOCALE).select(partySize);
  } catch {
    // keep "other"
  }
  return message(locale, category === "one" ? "party.one" : "party.other", { partySize });
}
