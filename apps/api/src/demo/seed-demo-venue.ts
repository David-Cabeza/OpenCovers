// Full demo venue for screenshots and videos. Local use only. Built through the public HTTP API
// of a running API (`pnpm dev`), so it exercises the same paths a real client does.
//
//   pnpm demo:seed
//   ALLDAY=1 pnpm demo:seed      # one service 09:00-23:45, so walk-ins and the waitlist work at any hour
//
// Run it once against a fresh database. It stops with a clear message if the account already has
// a venue with the demo name. The API generates the venue id and the script uses the one it returns.
// Environment: BASE (default http://localhost:3000, must be localhost), EMAIL, PASSWORD,
// OWNER_NAME. The default password is a local-development value that is public in the
// source. Every guest is invented and uses an example.com address.
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.EMAIL ?? "demo@opencovers.test";
const PASSWORD = process.env.PASSWORD ?? "demo-password-123";
const OWNER_NAME = process.env.OWNER_NAME ?? "Marta Quiroga";
const VENUE_NAME = "La Taberna del Faro";
const TZ = "Europe/Madrid";
const ALLDAY = process.env.ALLDAY === "1";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to seed ${BASE}: demo data is for a local API only.`);
  process.exit(1);
}

type Json = Record<string, any>;
type Reply = { status: number; json: Json | undefined; text: string; headers: Headers };

let cookie = "";
async function api(method: string, path: string, opts: { body?: unknown; key?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = { Origin: "http://localhost:5173" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.key) headers["Idempotency-Key"] = randomUUID();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: Json | undefined;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

function must(r: Reply, what: string): Json {
  if (r.status >= 400) {
    console.error(`FAILED ${what}: ${r.status} ${r.text.slice(0, 300)}`);
    process.exit(1);
  }
  return r.json ?? {};
}
function soft(r: Reply, what: string): Json | null {
  if (r.status >= 400) console.warn(`  skipped ${what}: ${r.status} ${r.json?.code ?? r.text.slice(0, 120)}`);
  return r.status < 400 ? (r.json ?? {}) : null;
}

const dateInTz = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + offsetDays * 864e5),
  );
const nowHHMM = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

try {
  await fetch(BASE + "/health");
} catch {
  console.error(`No API at ${BASE}. Start it first with \`pnpm dev\` (after \`pnpm db:migrate\`).`);
  process.exit(1);
}

let r = await api("POST", "/api/auth/sign-up/email", { body: { email: EMAIL, password: PASSWORD, name: OWNER_NAME } });
if (r.status !== 200) r = await api("POST", "/api/auth/sign-in/email", { body: { email: EMAIL, password: PASSWORD } });
must(r, `sign up or sign in as ${EMAIL}`);
cookie = r.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");

const mine = must(await api("GET", "/v1/venues"), "list venues");
if ((mine.venues ?? []).some((v: Json) => v.name === VENUE_NAME)) {
  console.error(`Venue "${VENUE_NAME}" already exists for ${EMAIL}. Use a fresh database or another EMAIL.`);
  process.exit(1);
}
const VENUE = must(await api("POST", "/v1/venues", { body: { name: VENUE_NAME, timezone: TZ } }), "create venue").venue.id as string;
const V = `/v1/venues/${VENUE}`;
console.log(`venue ${VENUE} created`);

const services = ALLDAY
  ? [{ name: "Todo el dia", openStart: "09:00", openEnd: "23:45", minPartySize: 1, maxPartySize: 12 }]
  : [
      { name: "Comidas", openStart: "13:00", openEnd: "16:30", minPartySize: 1, maxPartySize: 10 },
      { name: "Cenas", openStart: "20:00", openEnd: "23:30", minPartySize: 1, maxPartySize: 12 },
    ];
for (const s of services) must(await api("POST", `${V}/services`, { body: s }), `service ${s.name}`);

const tables: [string, string, number, string, string, number, number][] = [
  ["1", "Mesa 1", 2, "Sala", "square", 60, 60],
  ["2", "Mesa 2", 2, "Sala", "square", 200, 60],
  ["3", "Mesa 3", 4, "Sala", "round", 340, 60],
  ["4", "Mesa 4", 4, "Sala", "round", 480, 60],
  ["5", "Mesa 5", 4, "Sala", "round", 60, 200],
  ["6", "Mesa 6", 6, "Sala", "rect", 200, 200],
  ["7", "Mesa 7", 6, "Sala", "rect", 360, 200],
  ["8", "Mesa 8", 8, "Sala", "rect", 60, 340],
  ["T1", "Terraza 1", 2, "Terraza", "square", 700, 60],
  ["T2", "Terraza 2", 2, "Terraza", "square", 700, 200],
  ["T3", "Terraza 3", 4, "Terraza", "round", 840, 60],
  ["T4", "Terraza 4", 4, "Terraza", "round", 840, 200],
];
for (const [id, name, seats, zone, shape, x, y] of tables) {
  must(await api("POST", `${V}/tables`, { body: { id, name, seats, zone, shape } }), `table ${name}`);
  must(await api("PATCH", `${V}/tables/${id}`, { body: { x, y, rotation: 0 } }), `layout ${name}`);
}
for (const item of [
  { type: "bar", label: "Barra", posX: 300, posY: 360, width: 260, height: 48 },
  { type: "kitchen", label: "Cocina", posX: 620, posY: 340, width: 160, height: 100 },
  { type: "entrance", label: "Entrada", posX: 20, posY: 440, width: 100, height: 24 },
  { type: "plant", label: "", posX: 540, posY: 200, width: 40, height: 40 },
]) {
  soft(await api("POST", `${V}/floor-items`, { body: item }), `floor item ${item.type}`);
}

must(
  await api("PUT", `${V}/config`, { body: { maxAdvanceDays: 90, maxActivePerGuestPerDay: 3, overbookingCeiling: 0 } }),
  "booking policy",
);
soft(
  await api("PUT", `${V}/public-profile`, {
    body: {
      publicProfileEnabled: true,
      street: "Calle del Faro 7",
      locality: "Madrid",
      postalCode: "28012",
      region: "Madrid",
      country: "ES",
      cuisine: "Cocina mediterranea de mercado",
      phone: "+34 910 555 010",
    },
  }),
  "public profile",
);
const onlineBooking = soft(
  await api("PUT", `${V}/online-booking`, {
    body: {
      enabled: true,
      allowedOrigins: ["https://tabernadelfaro.example"],
      askConsent: true,
      minPartySize: 1,
      maxPartySize: 8,
      leadTimeMinutes: 0,
      maxAdvanceDays: 60,
      selfServiceCutoffMinutes: 120,
      locale: "es",
    },
  }),
  "online booking",
);

const guests = [
  ["Lucia Prado", "lucia.prado"], ["Pablo Serrano", "pablo.serrano"], ["Irene Molina", "irene.molina"],
  ["Hector Gil", "hector.gil"], ["Carmen Ortiz", "carmen.ortiz"], ["Diego Ferrer", "diego.ferrer"],
  ["Noelia Vidal", "noelia.vidal"], ["Raul Campos", "raul.campos"], ["Paula Iglesias", "paula.iglesias"],
  ["Adrian Mora", "adrian.mora"], ["Sara Beltran", "sara.beltran"], ["Javier Roldan", "javier.roldan"],
  ["Marina Cuesta", "marina.cuesta"], ["Oscar Pena", "oscar.pena"], ["Elena Santos", "elena.santos"],
  ["Tomas Aguilar", "tomas.aguilar"], ["Alba Ruiz", "alba.ruiz"], ["Victor Lara", "victor.lara"],
] as const;
const slots = ["13:00", "13:30", "14:00", "14:30", "15:00", "20:00", "20:30", "21:00", "21:30", "22:00"];
const parties = [2, 2, 4, 3, 2, 6, 4, 2, 5, 2, 8, 4];
const created: { id: string; time: string; partySize: number; day: number }[] = [];
let g = 0;
for (let day = 0; day <= 3; day += 1) {
  const date = dateInTz(day);
  for (let i = 0; i < slots.length; i += 1) {
    if ((i + day) % 2 === 1 && day > 0) continue;
    const [name, local] = guests[g % guests.length]!;
    const partySize = parties[g % parties.length]!;
    g += 1;
    const out = soft(
      await api("POST", `${V}/reservations`, {
        key: true,
        body: {
          date,
          time: slots[i],
          partySize,
          guest: { name, contact: `${local}@example.com`, consent: "granted" },
          commentary: i === 3 ? "Cumpleanos, una vela en el postre" : "",
        },
      }),
      `reservation ${date} ${slots[i]}`,
    );
    if (out) created.push({ id: out.id, time: out.time, partySize: out.partySize, day });
  }
}

const now = nowHHMM();
for (const [n, res] of created.filter((x) => x.day === 0 && x.time < now).entries()) {
  const path = `${V}/reservations/${res.id}`;
  if (n % 5 === 4) soft(await api("POST", `${path}/status`, { key: true, body: { status: "no_show" } }), "no_show");
  else if (n % 5 === 3) soft(await api("POST", `${path}/cancel`, { key: true }), "cancel");
  else {
    soft(await api("POST", `${path}/status`, { key: true, body: { status: "seated" } }), "seated");
    if (n % 2 === 0) soft(await api("POST", `${path}/status`, { key: true, body: { status: "attended" } }), "attended");
  }
}
const future = created.find((x) => x.day === 1);
if (future) {
  soft(await api("POST", `${V}/reservations/${future.id}/modify`, { key: true, body: { partySize: future.partySize + 1 } }), "modify");
}

for (const [name, local, partySize] of [
  ["Familia Herrero", "herrero.familia", 5],
  ["Cristina Nieto", "cristina.nieto", 2],
] as const) {
  soft(await api("POST", `${V}/waitlist`, { body: { partySize, guest: { name, contact: `${local}@example.com` } } }), "waitlist add");
}
soft(
  await api("POST", `${V}/reservations/walk-in`, { key: true, body: { partySize: 2, guest: { name: "Mesa de barra" } } }),
  "walk-in (only works while a service is open)",
);

const readKey = `oc_demo_read_${randomUUID().replace(/-/g, "")}`;
const writeKey = `oc_demo_write_${randomUUID().replace(/-/g, "")}`;
must(await api("POST", `${V}/keys`, { body: { key: readKey, principal: "demo-read", role: "read" } }), "read key");
must(await api("POST", `${V}/keys`, { body: { key: writeKey, principal: "demo-agent", role: "write" } }), "write key");
let link = "";
const any = created.find((x) => x.day >= 1);
if (any) {
  const l = soft(await api("POST", `${V}/reservations/${any.id}/self-service-link`, { key: true }), "self-service link");
  if (l) link = `${BASE}/r#${l.selfServiceToken}`;
}

console.log(`\nDone: ${created.length} reservations created.`);
console.log(`Staff app:   http://localhost:5173  (sign in as ${EMAIL} / ${PASSWORD}, local demo password)`);
if (onlineBooking?.bookingKey) {
  console.log(`Booking widget: http://localhost:5173/w/${onlineBooking.bookingKey}   (API direct: ${BASE}/w/${onlineBooking.bookingKey})`);
}
if (link) console.log(`Self-service page for one booking: ${link}`);
console.log(`Read key:  ${readKey}`);
console.log(`Write key: ${writeKey}   (shown once; revoke in Setup > API keys)`);
console.log("\nMCP host config:");
console.log(
  JSON.stringify(
    { mcpServers: { opencovers: { command: "npx", args: ["-y", "@opencovers/mcp"], env: { OPENCOVERS_API_KEY: writeKey, OPENCOVERS_BASE_URL: BASE } } } },
    null,
    2,
  ),
);
console.log(`\nVenue id for prompts: ${VENUE}`);
process.exit(0);
