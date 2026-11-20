// Full demo venue for screenshots and videos. Local use only. Built through the public HTTP API
// of a running API (`pnpm dev`), so it exercises the same paths a real client does. What it builds comes from
// ./template.ts, the same definition `provisionSandbox` uses for the hosted demo (ADR-0022); only the second
// team member, the API keys and the printed MCP config are specific to this script.
//
//   pnpm demo:seed
//   ALLDAY=1 pnpm demo:seed      # one service 09:00-23:45, so walk-ins and the waitlist work at any hour
//
// It also fills the Team screen: a second member "Andrés Roca" (role write, joined by redeeming an
// invitation at sign-up) and one pending read invitation for sala@example.com, so the audit log has
// invitation created and redeemed rows. All through the real routes.
//
// Run it once against a fresh database. A second run exits cleanly with a message because the
// account already has a venue with the demo name, and creates nothing. The API generates the venue id and the script uses the one it returns.
// Environment: BASE (default http://localhost:3000, must be localhost), EMAIL, PASSWORD,
// OWNER_NAME, MEMBER_EMAIL, MEMBER_PASSWORD. The default passwords is a local-development value that is public in the
// source. Every guest is invented and uses an example.com address.
import { randomUUID } from "node:crypto";
import { DEMO_TEMPLATE, planReservations, settle, templateServices, timeInTz } from "./template";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.EMAIL ?? "demo@opencovers.test";
const PASSWORD = process.env.PASSWORD ?? "demo-password-123";
const OWNER_NAME = process.env.OWNER_NAME ?? "Marta Quiroga";
const MEMBER_NAME = "Andrés Roca";
const MEMBER_EMAIL = process.env.MEMBER_EMAIL ?? "andres.roca@example.com";
const MEMBER_PASSWORD = process.env.MEMBER_PASSWORD ?? "demo-member-123";
const PENDING_INVITE_EMAIL = DEMO_TEMPLATE.pendingInvitation.email;
const VENUE_NAME = DEMO_TEMPLATE.venue.name;
const TZ = DEMO_TEMPLATE.venue.timezone;
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
async function api(
  method: string,
  path: string,
  opts: { body?: unknown; key?: boolean; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { Origin: "http://localhost:5173" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.key) headers["Idempotency-Key"] = randomUUID();
  const jar = opts.cookie ?? cookie;
  if (jar) headers.cookie = jar;
  Object.assign(headers, opts.headers);
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

const nowHHMM = () => timeInTz(TZ);

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
const VENUE = must(await api("POST", "/v1/venues", { body: DEMO_TEMPLATE.venue }), "create venue").venue.id as string;
const V = `/v1/venues/${VENUE}`;
console.log(`venue ${VENUE} created`);

const cookieOf = (reply: Reply) =>
  reply.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const memberInvite = must(
  await api("POST", `${V}/invitations`, { body: { role: "write", email: MEMBER_EMAIL } }),
  "invitation for the second member",
).invitation;
let memberReply = await api("POST", "/api/auth/sign-up/email", {
  body: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD, name: MEMBER_NAME },
  headers: { "x-invitation-token": memberInvite.token },
});
if (memberReply.status !== 200) {
  memberReply = await api("POST", "/api/auth/sign-in/email", { body: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD } });
  must(memberReply, `sign up or sign in as ${MEMBER_EMAIL}`);
  must(
    await api("POST", "/v1/invitations/redeem", { body: { token: memberInvite.token }, cookie: cookieOf(memberReply) }),
    "redeem the invitation as the second member",
  );
}
must(await api("POST", `${V}/invitations`, { body: DEMO_TEMPLATE.pendingInvitation }), "pending invitation");
console.log(`team: ${MEMBER_NAME} (write) joined, invitation for ${PENDING_INVITE_EMAIL} (read) pending`);

for (const s of templateServices(DEMO_TEMPLATE, ALLDAY)) must(await api("POST", `${V}/services`, { body: s }), `service ${s.name}`);

for (const t of DEMO_TEMPLATE.tables) {
  must(
    await api("POST", `${V}/tables`, { body: { id: t.id, name: t.name, seats: t.seats, zone: t.zone, shape: t.shape } }),
    `table ${t.name}`,
  );
  must(await api("PATCH", `${V}/tables/${t.id}`, { body: { x: t.x, y: t.y, rotation: 0 } }), `layout ${t.name}`);
}
for (const item of DEMO_TEMPLATE.floorItems) {
  soft(await api("POST", `${V}/floor-items`, { body: item }), `floor item ${item.type}`);
}

must(await api("PUT", `${V}/config`, { body: DEMO_TEMPLATE.config }), "booking policy");
soft(await api("PUT", `${V}/public-profile`, { body: DEMO_TEMPLATE.publicProfile }), "public profile");
const onlineBooking = soft(
  await api("PUT", `${V}/online-booking`, {
    body: { ...DEMO_TEMPLATE.onlineBooking, allowedOrigins: ["https://tabernadelfaro.example"] },
  }),
  "online booking",
);

const created: { id: string; time: string; partySize: number; day: number }[] = [];
for (const p of planReservations(DEMO_TEMPLATE)) {
  const out = soft(
    await api("POST", `${V}/reservations`, {
      key: true,
      body: {
        date: p.date,
        time: p.time,
        partySize: p.partySize,
        guest: { name: p.guestName, contact: p.contact, consent: "granted" },
        commentary: p.commentary,
      },
    }),
    `reservation ${p.date} ${p.time}`,
  );
  if (out) created.push({ id: out.id, time: out.time, partySize: out.partySize, day: p.day });
}

for (const s of settle(created, nowHHMM())) {
  const path = `${V}/reservations/${created[s.index]!.id}`;
  if (s.action === "cancel") soft(await api("POST", `${path}/cancel`, { key: true }), "cancel");
  else if (s.action === "modify") soft(await api("POST", `${path}/modify`, { key: true, body: { partySize: s.partySize } }), "modify");
  else soft(await api("POST", `${path}/status`, { key: true, body: { status: s.action } }), s.action);
}

for (const w of DEMO_TEMPLATE.waitlist) {
  soft(
    await api("POST", `${V}/waitlist`, {
      body: { partySize: w.partySize, guest: { name: w.name, contact: `${w.local}@example.com` } },
    }),
    "waitlist add",
  );
}
soft(
  await api("POST", `${V}/reservations/walk-in`, {
    key: true,
    body: { partySize: DEMO_TEMPLATE.walkIn.partySize, guest: { name: DEMO_TEMPLATE.walkIn.name } },
  }),
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
console.log(`Second member (write): ${MEMBER_EMAIL} / ${MEMBER_PASSWORD}   (local demo password)`);
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
