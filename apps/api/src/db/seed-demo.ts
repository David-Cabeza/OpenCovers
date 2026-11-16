// Demo venue for screenshots, videos and local trials. Local use only.
//
//   pnpm db:seed-demo you@example.com
//
// The email must belong to an account that already signed up in the staff app. The script
// creates "Bar La Plaza" (or reuses it), makes that account its admin, adds two services,
// eight tables and a fresh `write` agent key, and prints the MCP host configuration.
// Running it again keeps the venue and mints one more key.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { services, tables, user, venues } from "./schema";
import { addVenueKey } from "../lib/api-keys";
import { addMembership } from "../lib/memberships";

const VENUE_ID = "demo-bar-la-plaza";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: pnpm db:seed-demo <email of an existing staff account>");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const account = (await db.select().from(user).where(eq(user.email, email)).limit(1))[0];
if (!account) {
  console.error(`No account for ${email}. Sign up in the staff app first, then run this again.`);
  process.exit(1);
}

await db
  .insert(venues)
  .values({ id: VENUE_ID, name: "Bar La Plaza", timezone: "Europe/Madrid" })
  .onConflictDoNothing();
await addMembership(db, account.id, VENUE_ID, "admin");

await db
  .insert(services)
  .values([
    { venueId: VENUE_ID, name: "Comidas", openStart: "13:00", openEnd: "16:00" },
    { venueId: VENUE_ID, name: "Cenas", openStart: "19:00", openEnd: "23:00" },
  ])
  .onConflictDoNothing();

await db
  .insert(tables)
  .values([
    { id: "1", venueId: VENUE_ID, name: "Mesa 1", seats: 2, zone: "Sala", shape: "square", posX: 48, posY: 48 },
    { id: "2", venueId: VENUE_ID, name: "Mesa 2", seats: 2, zone: "Sala", shape: "square", posX: 192, posY: 48 },
    { id: "3", venueId: VENUE_ID, name: "Mesa 3", seats: 4, zone: "Sala", shape: "round", posX: 336, posY: 48 },
    { id: "4", venueId: VENUE_ID, name: "Mesa 4", seats: 4, zone: "Sala", shape: "round", posX: 48, posY: 192 },
    { id: "5", venueId: VENUE_ID, name: "Mesa 5", seats: 4, zone: "Sala", shape: "round", posX: 192, posY: 192 },
    { id: "6", venueId: VENUE_ID, name: "Mesa 6", seats: 6, zone: "Sala", shape: "rect", posX: 336, posY: 192 },
    { id: "7", venueId: VENUE_ID, name: "Terraza 1", seats: 2, zone: "Terraza", shape: "square", posX: 528, posY: 48 },
    { id: "8", venueId: VENUE_ID, name: "Terraza 2", seats: 4, zone: "Terraza", shape: "round", posX: 528, posY: 192 },
  ])
  .onConflictDoNothing();

const key = `oc_demo_${randomBytes(18).toString("hex")}`;
await addVenueKey(db, VENUE_ID, key, "demo-agent", "write", account.id);

const config = {
  mcpServers: {
    opencovers: {
      command: "npx",
      args: ["-y", "@opencovers/mcp"],
      env: { OPENCOVERS_API_KEY: key, OPENCOVERS_BASE_URL: "http://localhost:3000" },
    },
  },
};

console.log(`Demo venue "${VENUE_ID}" ready for ${email}.`);
console.log("The key below is shown once. Revoke it under Setup > API keys when you are done.\n");
console.log(JSON.stringify(config, null, 2));
console.log(`\nVenue id for prompts: ${VENUE_ID}`);
process.exit(0);
