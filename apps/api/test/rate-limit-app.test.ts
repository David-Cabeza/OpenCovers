import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { user, venueMemberships } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { createVenue } from "../src/lib/venue";

process.env.RATE_LIMIT = "on";
process.env.TRUST_PROXY = "true";
process.env.RATE_LIMIT_AUTH = "3/1h";
process.env.RATE_LIMIT_SIGNUP = "2/1h";
process.env.RATE_LIMIT_INVITATION = "4/1h";

const { default: app } = await import("../src/app");

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterAll(() => {
  delete process.env.RATE_LIMIT;
  delete process.env.TRUST_PROXY;
  delete process.env.RATE_LIMIT_AUTH;
  delete process.env.RATE_LIMIT_SIGNUP;
  delete process.env.RATE_LIMIT_INVITATION;
});

let counter = 0;
function freshIp() {
  counter += 1;
  return `198.51.${Math.floor(counter / 250)}.${counter % 250}`;
}

function post(path: string, ip: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": ip,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function signIn(ip: string, email: string, password = "wrong-password-1") {
  return post("/api/auth/sign-in/email", ip, { email, password });
}

function signUp(ip: string, email: string, headers: Record<string, string> = {}) {
  return post("/api/auth/sign-up/email", ip, { name: "Staff", email, password: "password123" }, headers);
}

async function adminCookie(venueId: string): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { name: "Admin", email: `admin-${venueId}@example.com`, password: "password123" },
    asResponse: true,
  });
  const body = await res.json();
  await createVenue(db, body.user.id, { id: venueId, name: venueId });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-up did not set a session cookie");
  return cookie;
}

async function invite(cookie: string, venueId: string): Promise<string> {
  const res = await app.request(`/v1/venues/${venueId}/invitations`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ role: "write" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).invitation.token;
}

describe("rate limiting on the real app", () => {
  it("limits sign-in per client address and then answers 429 with Retry-After", async () => {
    const ip = freshIp();
    const out: number[] = [];
    for (let i = 0; i < 3; i += 1) out.push((await signIn(ip, "nobody@example.com")).status);
    expect(out).toEqual([401, 401, 401]);

    const res = await signIn(ip, "nobody@example.com");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ code: "rate_limited", message: expect.any(String), retryable: true });
  });

  it("is the only limiter, so better-auth never answers its own 429", async () => {
    const context = await auth.$context;
    expect(context.rateLimit.enabled).toBe(false);
  });

  it("leaves another client address alone", async () => {
    const spent = freshIp();
    for (let i = 0; i < 4; i += 1) await signIn(spent, "nobody@example.com");
    expect((await signIn(freshIp(), "nobody@example.com")).status).toBe(401);
  });

  it("answers the same 429 whether the account exists or not, and a right password does not skip it", async () => {
    await auth.api.signUpEmail({
      body: { name: "Staff", email: "staff@example.com", password: "password123" },
    });
    const ipKnown = freshIp();
    const ipUnknown = freshIp();
    for (let i = 0; i < 3; i += 1) {
      await signIn(ipKnown, "staff@example.com");
      await signIn(ipUnknown, "ghost@example.com");
    }
    const known = await signIn(ipKnown, "staff@example.com", "password123");
    const unknown = await signIn(ipUnknown, "ghost@example.com");
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(await known.text()).toBe(await unknown.text());
    expect(known.headers.get("retry-after")).toBe(unknown.headers.get("retry-after"));
  });

  it("limits sign-up and creates no account once the limit is spent", async () => {
    const ip = freshIp();
    for (let i = 0; i < 2; i += 1) {
      expect((await signUp(ip, `staff-${i}@example.com`)).status).toBe(200);
    }
    const res = await signUp(ip, "staff-3@example.com");
    expect(res.status).toBe(429);
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("counts invitation redemption and token sign-ups on one budget", async () => {
    const ip = freshIp();
    const redeem: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      redeem.push((await post("/v1/invitations/redeem", ip, { token: "x.y" })).status);
    }
    expect(redeem.slice(0, 4)).not.toContain(429);
    expect(redeem[4]).toBe(429);

    const withToken = await signUp(ip, "invited@example.com", {
      "x-invitation-token": "not-a-real-id.not-a-real-secret",
    });
    expect(withToken.status).toBe(429);
    expect((await signUp(ip, "plain@example.com")).status).not.toBe(429);

    const other = await post("/v1/invitations/redeem", freshIp(), { token: "x.y" });
    expect(other.status).not.toBe(429);
  });

  it("never limits health, session reads or other reads", async () => {
    const ip = freshIp();
    for (const path of ["/health", "/api/auth/get-session", "/v1/venues"]) {
      for (let i = 0; i < 30; i += 1) {
        const res = await app.request(path, { headers: { "x-forwarded-for": ip } });
        expect(res.status, path).not.toBe(429);
      }
    }
  });

  it("does not change a request's own answer before the limit", async () => {
    const res = await post("/api/auth/sign-up/email", freshIp(), {});
    expect(res.status).toBe(400);
  });

  it("counts a real invitation redeem and a real token sign-up on one budget, and still lets valid ones through", async () => {
    const admin = await adminCookie("v-limit");
    const ip = freshIp();

    const signedUp = await signUp(ip, "invited@example.com", {
      "x-invitation-token": await invite(admin, "v-limit"),
    });
    expect(signedUp.status).toBe(200);
    const [invited] = await db.select().from(user).where(sql`email = 'invited@example.com'`);
    const granted = await db
      .select()
      .from(venueMemberships)
      .where(sql`user_id = ${invited?.id} and venue_id = 'v-limit'`);
    expect(granted.map((m) => m.role)).toEqual(["write"]);

    const cookie = (await auth.api.signInEmail({
      body: { email: "invited@example.com", password: "password123" },
      asResponse: true,
    })).headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const redeemed = await app.request("/v1/invitations/redeem", {
      method: "POST",
      headers: { cookie: cookie ?? "", "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ token: await invite(admin, "v-limit") }),
    });
    expect(redeemed.status).toBe(200);

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await post("/v1/invitations/redeem", ip, { token: "id.secret" })).status);
    }
    expect(statuses).toEqual([401, 401, 429]);

    const refused = await signUp(ip, "late@example.com", {
      "x-invitation-token": await invite(admin, "v-limit"),
    });
    expect(refused.status).toBe(429);
    expect(await db.select().from(user).where(sql`email = 'late@example.com'`)).toHaveLength(0);
  });
});
