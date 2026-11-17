// Every string the widget shows, keyed by id, one catalog per locale (ADR-0017 section 5). `{name}` is a slot.

const es = {
  "page.title": "Reservar en {venue}",
  "loading": "Cargando…",
  "unavailable.title": "Reservas no disponibles",
  "unavailable.body": "Las reservas en línea no están disponibles ahora mismo.",
  "step.choose": "Elige día, personas y hora",
  "step.details": "Tus datos",
  "field.date": "Día",
  "field.party": "Personas",
  "field.partyOption": "{n} personas",
  "field.partyOptionOne": "1 persona",
  "field.partyMore": "Más de {n}",
  "field.time": "Hora",
  "field.name": "Nombre",
  "field.contact": "Email o teléfono",
  "field.contactHint": "Solo lo usamos para esta reserva.",
  "field.note": "Comentario (opcional)",
  "field.noteHint": "No escribas aquí alergias ni información de salud.",
  "field.honeypot": "No rellenes este campo",
  "times.loading": "Buscando horas libres…",
  "times.none": "No quedan horas libres ese día para {n} personas. Prueba otro día.",
  "times.closed": "Ese día no se reserva en línea. Prueba otro día.",
  "times.pickDate": "Elige un día para ver las horas libres.",
  "party.large": "Para grupos de más de {n} personas, llama al local.",
  "party.largePhone": "Para grupos de más de {n} personas, llama al {phone}.",
  "action.continue": "Continuar",
  "action.back": "Volver",
  "action.book": "Reservar",
  "action.copy": "Copiar enlace",
  "action.copied": "Enlace copiado",
  "action.open": "Abrir el enlace",
  "summary": "{date} a las {time}, {party}",
  "progress.checking": "Comprobando el formulario… {percent} %",
  "progress.sending": "Enviando la reserva…",
  "done.title": "Reserva confirmada",
  "done.body": "Te esperamos el {date} a las {time}. Mesa para {party} a nombre de {name}.",
  "done.contact": "Contacto: {contact}",
  "done.linkTitle": "Tu enlace para ver, cambiar o cancelar",
  "done.linkBody": "Guárdalo ahora: es la única vez que lo verás aquí. Quien tenga el enlace puede cambiar la reserva.",
  "done.noLink": "Usa el enlace que recibiste al reservar para ver, cambiar o cancelar la reserva.",
  "validate.name": "Escribe tu nombre.",
  "validate.contact": "Escribe un email o un teléfono válido.",
  "validate.time": "Elige una hora.",
  "error.network": "No hemos podido conectar. Comprueba la conexión e inténtalo otra vez.",
  "error.rateLimited": "Demasiados intentos seguidos. Espera unos minutos e inténtalo otra vez.",
  "error.slotTaken": "Esa hora acaba de ocuparse. Elige otra.",
  "error.timeUnavailable": "Esa hora ya no se puede reservar en línea. Elige otra.",
  "error.partySize": "No podemos reservar para ese número de personas a esa hora. Prueba otra hora o llama al local.",
  "error.contactLimit": "Ya tienes el máximo de reservas permitidas con este contacto. Para otra reserva, llama al local.",
  "error.invalid": "Revisa tus datos e inténtalo otra vez.",
  "error.unavailable": "Las reservas en línea no están disponibles ahora mismo.",
  "error.generic": "No hemos podido completar la reserva en línea. Ponte en contacto con el local.",
  "error.genericPhone": "No hemos podido completar la reserva en línea. Llama al local: {phone}.",
};

export type MessageId = keyof typeof es;

const en: Record<MessageId, string> = {
  "page.title": "Book at {venue}",
  "loading": "Loading…",
  "unavailable.title": "Booking unavailable",
  "unavailable.body": "Online booking is not available right now.",
  "step.choose": "Choose a day, party size and time",
  "step.details": "Your details",
  "field.date": "Day",
  "field.party": "Guests",
  "field.partyOption": "{n} guests",
  "field.partyOptionOne": "1 guest",
  "field.partyMore": "More than {n}",
  "field.time": "Time",
  "field.name": "Name",
  "field.contact": "Email or phone",
  "field.contactHint": "Used for this booking only.",
  "field.note": "Note (optional)",
  "field.noteHint": "Do not write allergies or health information here.",
  "field.honeypot": "Leave this field empty",
  "times.loading": "Looking for free times…",
  "times.none": "No free times left that day for {n} guests. Try another day.",
  "times.closed": "Online booking is closed that day. Try another day.",
  "times.pickDate": "Choose a day to see the free times.",
  "party.large": "For more than {n} guests, please call the venue.",
  "party.largePhone": "For more than {n} guests, please call {phone}.",
  "action.continue": "Continue",
  "action.back": "Back",
  "action.book": "Book",
  "action.copy": "Copy link",
  "action.copied": "Link copied",
  "action.open": "Open the link",
  "summary": "{date} at {time}, {party}",
  "progress.checking": "Checking the form… {percent}%",
  "progress.sending": "Sending your booking…",
  "done.title": "Booking confirmed",
  "done.body": "See you on {date} at {time}. A table for {party} under {name}.",
  "done.contact": "Contact: {contact}",
  "done.linkTitle": "Your link to view, change or cancel",
  "done.linkBody": "Save it now: this is the only time you see it here. Anyone with the link can change the booking.",
  "done.noLink": "Use the link you received when you booked to view, change or cancel.",
  "validate.name": "Enter your name.",
  "validate.contact": "Enter a valid email or phone number.",
  "validate.time": "Choose a time.",
  "error.network": "We could not connect. Check your connection and try again.",
  "error.rateLimited": "Too many attempts in a row. Wait a few minutes and try again.",
  "error.slotTaken": "That time was just taken. Choose another.",
  "error.timeUnavailable": "That time can no longer be booked online. Choose another.",
  "error.partySize": "We cannot book that party size at that time. Try another time or call the venue.",
  "error.contactLimit": "You already hold the most bookings allowed for this contact. For another, call the venue.",
  "error.invalid": "Check your details and try again.",
  "error.unavailable": "Online booking is not available right now.",
  "error.generic": "We could not complete the booking online. Please contact the venue.",
  "error.genericPhone": "We could not complete the booking online. Please call the venue: {phone}.",
};

export const CATALOGS = { es, en } as const;
export type Locale = keyof typeof CATALOGS;

export function localeOf(lang: string | null | undefined): Locale {
  const base = (lang ?? "").toLowerCase().split("-")[0];
  return base in CATALOGS ? (base as Locale) : "es";
}

export function translator(locale: Locale) {
  const catalog = CATALOGS[locale];
  return (id: MessageId, values: Record<string, string | number> = {}) =>
    catalog[id].replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot));
}

export type Translate = ReturnType<typeof translator>;
