// The one definition of the demo restaurant (ADR-0022, decision 4). `provisionSandbox` builds it in-process
// for every visitor, and `seed-demo-venue.ts` builds it through the HTTP API for screenshots. Both read the same
// object, so the demo cannot drift from the engine: a feature that adds a screen or a setting adds it here.
//
// Bodies (`publicProfile`, `onlineBooking`, `config`) have the shape of the matching HTTP request. Dates are never
// written down. `planReservations` derives them from the day of provisioning. Every guest is invented and uses an
// example.com address.

export interface ServiceTemplate {
  name: string;
  openStart: string;
  openEnd: string;
  minPartySize: number;
  maxPartySize: number;
}

export interface TableTemplate {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: "square" | "round" | "rect";
  x: number;
  y: number;
}

export interface FloorItemTemplate {
  type: string;
  label: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
}

export interface GuestTemplate {
  name: string;
  /** The part before `@example.com`. */
  local: string;
}

export interface DemoTemplate {
  venue: { name: string; timezone: string };
  services: ServiceTemplate[];
  /** Replaces `services` when a trial needs a service open at any hour (walk-ins, waitlist). */
  allDayService: ServiceTemplate;
  tables: TableTemplate[];
  floorItems: FloorItemTemplate[];
  config: { maxAdvanceDays: number; maxActivePerGuestPerDay: number; overbookingCeiling: number };
  publicProfile: Record<string, unknown>;
  onlineBooking: Record<string, unknown>;
  guests: GuestTemplate[];
  /** Booking times, party sizes and the number of days ahead (today included) the agenda is filled for. */
  slots: string[];
  parties: number[];
  bookingDays: number;
  /** The slot index that gets the birthday note. */
  commentarySlot: number;
  commentary: string;
  waitlist: { name: string; local: string; partySize: number }[];
  walkIn: { name: string; partySize: number };
  pendingInvitation: { role: "read"; email: string };
}

export const DEMO_TEMPLATE: DemoTemplate = {
  venue: { name: "La Taberna del Faro", timezone: "Europe/Madrid" },
  services: [
    { name: "Comidas", openStart: "13:00", openEnd: "16:30", minPartySize: 1, maxPartySize: 10 },
    { name: "Cenas", openStart: "20:00", openEnd: "23:30", minPartySize: 1, maxPartySize: 12 },
  ],
  allDayService: { name: "Todo el día", openStart: "09:00", openEnd: "23:45", minPartySize: 1, maxPartySize: 12 },
  tables: [
    { id: "1", name: "Mesa 1", seats: 2, zone: "Sala", shape: "square", x: 60, y: 60 },
    { id: "2", name: "Mesa 2", seats: 2, zone: "Sala", shape: "square", x: 200, y: 60 },
    { id: "3", name: "Mesa 3", seats: 4, zone: "Sala", shape: "round", x: 340, y: 60 },
    { id: "4", name: "Mesa 4", seats: 4, zone: "Sala", shape: "round", x: 480, y: 60 },
    { id: "5", name: "Mesa 5", seats: 4, zone: "Sala", shape: "round", x: 60, y: 200 },
    { id: "6", name: "Mesa 6", seats: 6, zone: "Sala", shape: "rect", x: 200, y: 200 },
    { id: "7", name: "Mesa 7", seats: 6, zone: "Sala", shape: "rect", x: 360, y: 200 },
    { id: "8", name: "Mesa 8", seats: 8, zone: "Sala", shape: "rect", x: 60, y: 340 },
    { id: "T1", name: "Terraza 1", seats: 2, zone: "Terraza", shape: "square", x: 700, y: 60 },
    { id: "T2", name: "Terraza 2", seats: 2, zone: "Terraza", shape: "square", x: 700, y: 200 },
    { id: "T3", name: "Terraza 3", seats: 4, zone: "Terraza", shape: "round", x: 840, y: 60 },
    { id: "T4", name: "Terraza 4", seats: 4, zone: "Terraza", shape: "round", x: 840, y: 200 },
  ],
  floorItems: [
    { type: "bar", label: "Barra", posX: 300, posY: 360, width: 260, height: 48 },
    { type: "kitchen", label: "Cocina", posX: 620, posY: 340, width: 160, height: 100 },
    { type: "entrance", label: "Entrada", posX: 20, posY: 440, width: 100, height: 24 },
    { type: "plant", label: "", posX: 540, posY: 200, width: 40, height: 40 },
  ],
  config: { maxAdvanceDays: 90, maxActivePerGuestPerDay: 3, overbookingCeiling: 0 },
  publicProfile: {
    publicProfileEnabled: true,
    street: "Calle del Faro 7",
    locality: "Madrid",
    postalCode: "28012",
    region: "Madrid",
    country: "ES",
    cuisine: "Cocina mediterránea de mercado",
    phone: "+34 910 555 010",
  },
  onlineBooking: {
    enabled: true,
    askConsent: true,
    minPartySize: 1,
    maxPartySize: 8,
    leadTimeMinutes: 0,
    maxAdvanceDays: 60,
    selfServiceCutoffMinutes: 120,
    locale: "es",
    privacyNoticeUrl: "https://opencovers.dev/privacidad.html",
    // ADR-0021, section 2: the two zones of the tables above, and the service named on each time.
    publicZones: ["Sala", "Terraza"],
    showServiceNames: true,
    // ADR-0021, section 3: the public waitlist. The sandbox's email goes to its owner only (limits.ts mayEmail).
  },
  guests: [
    { name: "Lucía Prado", local: "lucia.prado" },
    { name: "Pablo Serrano", local: "pablo.serrano" },
    { name: "Irene Molina", local: "irene.molina" },
    { name: "Héctor Gil", local: "hector.gil" },
    { name: "Carmen Ortiz", local: "carmen.ortiz" },
    { name: "Diego Ferrer", local: "diego.ferrer" },
    { name: "Noelia Vidal", local: "noelia.vidal" },
    { name: "Raúl Campos", local: "raul.campos" },
    { name: "Paula Iglesias", local: "paula.iglesias" },
    { name: "Adrián Mora", local: "adrian.mora" },
    { name: "Sara Beltrán", local: "sara.beltran" },
    { name: "Javier Roldán", local: "javier.roldan" },
    { name: "Marina Cuesta", local: "marina.cuesta" },
    { name: "Óscar Peña", local: "oscar.pena" },
    { name: "Elena Santos", local: "elena.santos" },
    { name: "Tomás Aguilar", local: "tomas.aguilar" },
    { name: "Alba Ruiz", local: "alba.ruiz" },
    { name: "Víctor Lara", local: "victor.lara" },
  ],
  slots: ["13:00", "13:30", "14:00", "14:30", "15:00", "20:00", "20:30", "21:00", "21:30", "22:00"],
  parties: [2, 2, 4, 3, 2, 6, 4, 2, 5, 2, 8, 4],
  bookingDays: 4,
  commentarySlot: 3,
  commentary: "Cumpleaños, una vela en el postre",
  waitlist: [
    { name: "Familia Herrero", local: "herrero.familia", partySize: 5 },
    { name: "Cristina Nieto", local: "cristina.nieto", partySize: 2 },
  ],
  walkIn: { name: "Mesa de barra", partySize: 2 },
  pendingInvitation: { role: "read", email: "sala@example.com" },
};

export function templateServices(template: DemoTemplate, allDay: boolean): ServiceTemplate[] {
  return allDay ? [template.allDayService] : template.services;
}

/** The calendar date `offsetDays` from `now` in `timeZone`, as YYYY-MM-DD. */
export function dateInTz(timeZone: string, offsetDays: number, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(now.getTime() + offsetDays * 864e5),
  );
}

/** The wall-clock time in `timeZone`, as HH:MM. */
export function timeInTz(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

export interface PlannedReservation {
  /** 0 is today. */
  day: number;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  contact: string;
  commentary: string;
}

/** The bookings that fill the agenda, relative to `now`. Deterministic: the same day gives the same plan. */
export function planReservations(template: DemoTemplate, now: Date = new Date()): PlannedReservation[] {
  const plan: PlannedReservation[] = [];
  let g = 0;
  for (let day = 0; day < template.bookingDays; day += 1) {
    const date = dateInTz(template.venue.timezone, day, now);
    template.slots.forEach((time, i) => {
      if ((i + day) % 2 === 1 && day > 0) return;
      const guest = template.guests[g % template.guests.length]!;
      const partySize = template.parties[g % template.parties.length]!;
      g += 1;
      plan.push({
        day,
        date,
        time,
        partySize,
        guestName: guest.name,
        contact: `${guest.local}@example.com`,
        commentary: i === template.commentarySlot ? template.commentary : "",
      });
    });
  }
  return plan;
}

export type Settlement =
  | { index: number; action: "seated" | "attended" | "no_show" | "cancel" }
  | { index: number; action: "modify"; partySize: number };

/**
 * What happened to the bookings already past today (`created` are the ones that exist, in plan order), plus one
 * change to a booking tomorrow, so the trace of a booking shows more than its creation.
 */
export function settle(created: readonly { day: number; time: string; partySize: number }[], nowHHMM: string): Settlement[] {
  const out: Settlement[] = [];
  let n = 0;
  created.forEach((res, index) => {
    if (res.day !== 0 || res.time >= nowHHMM) return;
    if (n % 5 === 4) out.push({ index, action: "no_show" });
    else if (n % 5 === 3) out.push({ index, action: "cancel" });
    else {
      out.push({ index, action: "seated" });
      if (n % 2 === 0) out.push({ index, action: "attended" });
    }
    n += 1;
  });
  const tomorrow = created.findIndex((res) => res.day === 1);
  if (tomorrow >= 0) out.push({ index: tomorrow, action: "modify", partySize: created[tomorrow]!.partySize + 1 });
  return out;
}
