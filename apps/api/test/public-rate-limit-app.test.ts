import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";

process.env.RATE_LIMIT = "on";
process.env.TRUST_PROXY = "true";
process.env.RATE_LIMIT_PUBLIC_BOOKING = "1/1h";
process.env.RATE_LIMIT_PUBLIC_VENUE = "2/1h";
process.env.PUBLIC_CHALLENGE_SECRET = "rate-limit-test-secret-for-the-public-challenge";
process.env.PUBLIC_POW_DIFFICULTY = "0";

const { default: app } = await import("../src/app");
const challenges = challengeConfigFromEnv();

afterAll(() => {
  for (const name of [
    "RATE_LIMIT",
    "TRUST_PROXY",
    "RATE_LIMIT_PUBLIC_BOOKING",
    "RATE_LIMIT_PUBLIC_VENUE",
    "PUBLIC_CHALLENGE_SECRET",
    "PUBLIC_POW_DIFFICULTY",
  ]) {
    delete process.env[name];
  }
});

const keys: Record<string, string> = {};

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
  for (const id of ["rl-a", "rl-b"]) {
    await db.insert(venues).values({ id, name: id, timezone: "Europe/Madrid" });
    await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
    await db.insert(tables).values([1, 2, 3, 4].map((i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: 4 })));
    await addKey(db, `${id}-admin`, `admin-${id}`, [id], "admin");
    const res = await app.request(`/v1/venues/${id}/online-booking`, {
      method: "PUT",
      headers: { apikey: `${id}-admin`, "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
      body: JSON.stringify({ enabled: true }),
    });
    keys[id] = (await res.json()).bookingKey;
  }
});

function create(venue: string, ip: string) {
  const challenge = issueChallenge(challenges, keys[venue]!, Date.now() - 10_000);
  return app.request(`/v1/public/${keys[venue]}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "x-forwarded-for": ip },
    body: JSON.stringify({
      date: "2030-06-01",
      time: "20:00",
      partySize: 2,
      guest: { name: "Ana", contact: `${ip}@example.com` },
      challenge,
      solution: solve(challenge),
    }),
  });
}

const booked = async (venue: string) =>
  (await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venue)))[0]!.n;

describe("C52 public limits in the app", () => {
  it("refuses with 429, Retry-After and no-store, and a refused create books nothing", async () => {
    expect((await create("rl-a", "203.0.113.1")).status).toBe(200);
    const refused = await create("rl-a", "203.0.113.1");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect((await refused.json()).code).toBe("rate_limited");
    expect(await booked("rl-a")).toBe(1);
  });

  it("stops public creates for a venue whose budget is spent, and nothing else", async () => {
    expect((await create("rl-a", "203.0.113.2")).status).toBe(200);
    expect((await create("rl-a", "203.0.113.3")).status).toBe(429);
    expect(await booked("rl-a")).toBe(2);
    expect((await create("rl-b", "203.0.113.4")).status).toBe(200);
    const read = await app.request(`/v1/public/${keys["rl-a"]}`, { headers: { "x-forwarded-for": "203.0.113.5" } });
    expect(read.status).toBe(200);
    const staff = await app.request("/v1/venues/rl-a/reservations", {
      method: "POST",
      headers: {
        apikey: "rl-a-admin",
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "x-forwarded-for": "203.0.113.6",
      },
      body: JSON.stringify({ date: "2030-06-01", time: "21:00", partySize: 2 }),
    });
    expect(staff.status).toBe(200);
  });
});
