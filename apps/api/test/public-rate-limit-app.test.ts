import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, selfServiceLinks, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";

process.env.RATE_LIMIT = "on";
process.env.TRUST_PROXY = "true";
process.env.RATE_LIMIT_PUBLIC_BOOKING = "1/1h";
process.env.RATE_LIMIT_PUBLIC_VENUE = "2/1h";
process.env.RATE_LIMIT_PUBLIC_SELF_SERVICE = "3/15m";
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
    "RATE_LIMIT_PUBLIC_SELF_SERVICE",
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
  for (const id of ["rl-a", "rl-b", "rl-c"]) {
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

describe("C52 public_venue counts only creates that reach the booking", () => {
  it("does not let malformed bodies or unknown keys spend a venue's budget", async () => {
    const path = `/v1/public/${keys["rl-c"]}/reservations`;
    for (const [i, body] of ["{}", "not json", JSON.stringify({ date: "2030-06-01" })].entries()) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "x-forwarded-for": `203.0.113.${40 + i}` },
        body,
      });
      expect(res.status).toBe(400);
    }
    const unknown = await app.request("/v1/public/pk_ZZZZZZZZZZZZZZZZZZZZZZ/reservations", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "x-forwarded-for": "203.0.113.43" },
      body: "{}",
    });
    expect(unknown.status).toBe(404);
    expect((await create("rl-c", "203.0.113.44")).status).toBe(200);
    expect((await create("rl-c", "203.0.113.45")).status).toBe(200);
    expect((await create("rl-c", "203.0.113.46")).status).toBe(429);
    expect(await booked("rl-c")).toBe(2);
  });
});

describe("C52 self_service limit in the app", () => {
  async function staffLink(ip: string): Promise<{ id: string; token: string }> {
    const headers = { apikey: "rl-b-admin", "content-type": "application/json", "x-forwarded-for": ip };
    const made = await app.request("/v1/venues/rl-b/reservations", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: "2030-06-01", time: "22:00", partySize: 2, guest: { name: "Eva", contact: `${ip}@example.com` } }),
    });
    const { id } = await made.json();
    const issued = await app.request(`/v1/venues/rl-b/reservations/${id}/self-service-link`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    });
    return { id, token: (await issued.json()).selfServiceToken };
  }

  const guest = (path: string, ip: string, token: string, method = "GET", payload?: unknown) =>
    app.request(`/v1/public/self-service${path}`, {
      method,
      headers: {
        "x-forwarded-for": ip,
        "X-Self-Service-Token": token,
        "Idempotency-Key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  it("shares one budget per address across read, modify and cancel, and a refused cancel does nothing", async () => {
    const { id, token } = await staffLink("203.0.113.20");
    const ip = "203.0.113.21";
    expect((await guest("", ip, token)).status).toBe(200);
    expect((await guest("/modify", ip, token, "POST", { version: 1, commentary: "x" })).status).toBe(200);
    expect((await guest("", ip, "bad")).status).toBe(404);
    const refused = await guest("/cancel", ip, token, "POST");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    const other = await guest("/cancel", ip, "bad", "POST");
    expect(other.status).toBe(429);
    expect(await other.text()).toBe(await refused.text());
    const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
    expect(r.status).toBe("booked");
    const [link] = await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, id));
    expect(link.revokedAt).toBeNull();
    expect((await guest("/cancel", "203.0.113.22", token, "POST")).status).toBe(200);
  });
});
