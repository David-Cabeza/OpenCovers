// Regression tests for the security audit of PR #211 (ADR-0022, findings F1 to F13).
import { count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-form-challenge";
  process.env.PUBLIC_POW_DIFFICULTY = "4";
  process.env.RESEND_API_KEY = "re_operator";
  process.env.RESEND_FROM_EMAIL = "operator@opencovers.test";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  account as authAccount,
  demoLeads,
  demoSandboxes,
  guests,
  reservations,
  user,
  venueMemberships,
  venues,
  waitlist,
} from "../src/db/schema";
import { createAuth } from "../src/lib/auth";
import { admissionFor } from "../src/demo/admission";
import { cleanupExpiredSandboxes } from "../src/demo/cleanup";
import { assertDemoDatabase } from "../src/demo/guard";
import { consentedLeadsCsv, eraseLead, recordConsent } from "../src/demo/leads";
import { enforceSandboxCap, isSandboxVenue, DemoLimitError } from "../src/demo/limits";
import { normalizeEmail } from "../src/demo/normalize";
import { provisionSandbox } from "../src/demo/provision";
import { purgeVenue } from "../src/demo/purge";
import { demoSettings, poolSettings, sandboxLimits } from "../src/demo/settings";
import { issueSignInChallenge } from "../src/demo/sign-in-challenge";
import { DEMO_TEMPLATE, dateInTz } from "../src/demo/template";
import { blocklistKeys } from "../src/lib/blocklist";
import { addToBlocklist } from "../src/lib/blocklist";
import { addVenueKey } from "../src/lib/api-keys";
import { upsertService, upsertTable } from "../src/lib/catalog";
import { addFloorItem } from "../src/lib/floor-items";
import { createInvitation } from "../src/lib/invitations";
import { solve } from "../src/lib/public-challenge";
import { createRateLimiter, DEFAULT_RULES, rateLimitConfigFromEnv } from "../src/lib/rate-limit";
import { createReservation } from "../src/lib/reservations";
import { addWaitlist } from "../src/lib/waitlist";
import { createVenue } from "../src/lib/venue";

const sent: { to: string; text: string }[] = [];
const demoAuth = createAuth(demoSettings({ DEMO_MODE: "1" }), {
  sendMail: async (to, _subject, text) => {
    sent.push({ to, text });
  },
});

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  sent.length = 0;
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  await db.execute(
    sql`TRUNCATE TABLE demo_lead, demo_sandbox, account, session, verification, "user", venue_memberships, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, self_service_links, grants, api_keys, services, tables, floor_items, webhook_endpoints, venue_online_booking, venues, invitations, guest_blocklist RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let n = 0;
const freshEmail = () => `audit-${++n}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function makeUser(email = freshEmail()) {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name: "V", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  return { id, email };
}

function signInHeaders(extra: Record<string, string> = {}) {
  const challenge = issueSignInChallenge(Date.now() - 10_000);
  return new Headers({
    "x-demo-challenge": JSON.stringify(challenge),
    "x-demo-solution": solve(challenge),
    ...extra,
  });
}

async function signIn(email: string) {
  await demoAuth.api.signInMagicLink({ body: { email }, headers: signInHeaders() });
  const mail = sent.filter((m) => m.to === email).pop()!;
  const url = mail.text.match(/https?:\/\/\S+/)![0];
  const token = new URL(url).searchParams.get("token")!;
  const res = await demoAuth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const [account] = await db.select().from(user).where(eq(user.email, email));
  return { account: account!, cookie, token, url };
}

const json = (cookie: string, init: RequestInit = {}) => ({
  ...init,
  headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json", ...(init.headers ?? {}) },
});

async function sandboxVenue(email: string): Promise<string> {
  const [row] = await db
    .select({ venueId: demoSandboxes.venueId })
    .from(demoSandboxes)
    .innerJoin(user, eq(user.id, demoSandboxes.userId))
    .where(eq(user.email, email));
  return row!.venueId;
}

describe("F1: provisioning never needs a second connection while holding one", () => {
  it("uses a pool of 10 with a connection timeout, and a build slot count well below it", () => {
    const pool = (db as unknown as { $client: { options: { max: number; connectionTimeoutMillis: number } } }).$client;
    expect(pool.options.max).toBe(10);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(sandboxLimits().provisionConcurrency).toBeLessThan(pool.options.max - 2);
    expect(() => sandboxLimits({ DEMO_PROVISION_CONCURRENCY: "9" })).toThrow(/free/);
    expect(poolSettings({ DATABASE_POOL_MAX: "20", DATABASE_CONNECTION_TIMEOUT_MS: "500" })).toEqual({
      max: 20,
      connectionTimeoutMillis: 500,
    });
  });

  it("provisions 20 distinct users at once on a pool of 10, and a bystander query still answers", async () => {
    const users = await Promise.all(Array.from({ length: 20 }, () => makeUser()));
    const started = Date.now();
    const all = Promise.all(users.map((u) => provisionSandbox(db, u.id)));
    await new Promise((r) => setTimeout(r, 300));
    // While the builds run, an unrelated query gets a connection at once.
    const bystander = await Promise.race([
      db.execute(sql`select 1 as ok`).then(() => "answered"),
      new Promise((r) => setTimeout(() => r("hung"), 5_000)),
    ]);
    expect(bystander).toBe("answered");
    const results = await all;
    expect(results.every((r) => r.created)).toBe(true);
    expect(Date.now() - started).toBeLessThan(90_000);
    expect((await db.select({ n: count() }).from(demoSandboxes))[0]!.n).toBe(20);
  }, 120_000);

  it("answers busy when the queue of waiting builds is full", async () => {
    vi.stubEnv("DEMO_PROVISION_CONCURRENCY", "1");
    vi.stubEnv("DEMO_PROVISION_QUEUE", "1");
    const users = await Promise.all(Array.from({ length: 5 }, () => makeUser()));
    const settled = await Promise.allSettled(users.map((u) => provisionSandbox(db, u.id)));
    const refused = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((r) => (r.reason as { reason?: string }).reason === "busy")).toBe(true);
  }, 60_000);
});

describe("F5 and F10: atomic provisioning and cleanup", () => {
  it("a build that fails midway leaves no venue, membership or sandbox row", async () => {
    const u = await makeUser();
    const broken = { ...DEMO_TEMPLATE, onlineBooking: { ...DEMO_TEMPLATE.onlineBooking, services: ["no-such-service"] } };
    await expect(provisionSandbox(db, u.id, { template: broken })).rejects.toThrow();
    expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(0);
    expect((await db.select({ n: count() }).from(venueMemberships))[0]!.n).toBe(0);
    expect((await db.select({ n: count() }).from(demoSandboxes))[0]!.n).toBe(0);
    // And the next attempt works.
    expect((await provisionSandbox(db, u.id)).created).toBe(true);
  });

  it("purgeVenue refuses a venue that has no demo_sandbox row", async () => {
    const real = await makeUser();
    const { id } = await createVenue(db, real.id, { name: "Real Bistro", timezone: "Europe/Madrid" });
    await expect(purgeVenue(db, id)).rejects.toThrow(/not a demo sandbox/);
    expect((await db.select({ n: count() }).from(venues).where(eq(venues.id, id)))[0]!.n).toBe(1);
  });

  it("cleanup deletes accounts that have no sandbox once they are old, and spares recent ones", async () => {
    const old = await makeUser();
    const recent = await makeUser();
    await db.update(user).set({ createdAt: new Date(Date.now() - 20 * 864e5) }).where(eq(user.id, old.id));
    const result = await cleanupExpiredSandboxes(db);
    expect(result.orphanAccounts).toBe(1);
    expect((await db.select().from(user).where(eq(user.id, old.id))).length).toBe(0);
    expect((await db.select().from(user).where(eq(user.id, recent.id))).length).toBe(1);
  });

  it("cleanup never deletes an account that belongs to a venue that is not a sandbox, nor that venue", async () => {
    const owner = await makeUser();
    const { id: realVenue } = await createVenue(db, owner.id, { name: "Real Bistro", timezone: "Europe/Madrid" });
    await db.update(user).set({ createdAt: new Date(Date.now() - 30 * 864e5) }).where(eq(user.id, owner.id));
    // The same account also holds an expired sandbox.
    await provisionSandbox(db, owner.id);
    await db.update(demoSandboxes).set({ lastSignInAt: new Date(Date.now() - 30 * 864e5) });
    const result = await cleanupExpiredSandboxes(db);
    expect(result.accounts).toBe(0);
    expect((await db.select().from(user).where(eq(user.id, owner.id))).length).toBe(1);
    expect((await db.select().from(venues).where(eq(venues.id, realVenue))).length).toBe(1);
  });

  it("a cleanup that fails midway is retried: venue and account go together", async () => {
    const a = await makeUser();
    await provisionSandbox(db, a.id);
    await db.update(demoSandboxes).set({ lastSignInAt: new Date(Date.now() - 30 * 864e5) });
    // Make the account delete fail once: the whole sandbox must survive, then the next run removes both.
    await db.execute(sql`CREATE OR REPLACE FUNCTION fail_user_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fail_user_delete BEFORE DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION fail_user_delete()`);
    try {
      await expect(cleanupExpiredSandboxes(db)).rejects.toThrow();
      expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(1);
      expect((await db.select({ n: count() }).from(demoSandboxes))[0]!.n).toBe(1);
    } finally {
      await db.execute(sql`DROP TRIGGER fail_user_delete ON "user"`);
    }
    const result = await cleanupExpiredSandboxes(db);
    expect(result).toMatchObject({ sandboxes: 1, accounts: 1 });
    expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(0);
  });
});

describe("F2 and F9: the demo never runs over a real instance, and restrictions follow the row", () => {
  it("DEMO_MODE=1 refuses to start over a venue that is not a sandbox", async () => {
    const owner = await makeUser();
    await createVenue(db, owner.id, { name: "Real Bistro", timezone: "Europe/Madrid" });
    await expect(assertDemoDatabase(db, true)).rejects.toThrow(/not demo sandboxes/);
    await expect(assertDemoDatabase(db, false)).resolves.toBeUndefined();
  });

  it("DEMO_MODE=1 refuses to start when an account has a password login", async () => {
    const owner = await makeUser();
    await db.insert(authAccount).values({
      id: crypto.randomUUID(),
      accountId: owner.id,
      providerId: "credential",
      userId: owner.id,
      password: "x",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(assertDemoDatabase(db, true)).rejects.toThrow(/password login/);
  });

  it("DEMO_MODE off refuses to start when the database holds sandboxes", async () => {
    const v = await makeUser();
    await provisionSandbox(db, v.id);
    await expect(assertDemoDatabase(db, true)).resolves.toBeUndefined();
    await expect(assertDemoDatabase(db, false)).rejects.toThrow(/holds 1 demo sandbox/);
  });

  it("passes on an empty database either way", async () => {
    await expect(assertDemoDatabase(db, true)).resolves.toBeUndefined();
    await expect(assertDemoDatabase(db, false)).resolves.toBeUndefined();
  });

  it("isSandboxVenue answers from the row alone, with DEMO_MODE unset", async () => {
    const v = await makeUser();
    const { venueId } = await provisionSandbox(db, v.id);
    vi.stubEnv("DEMO_MODE", "");
    expect(await isSandboxVenue(db, venueId)).toBe(true);
    const res = await app.request(`/v1/venues/${venueId}/webhooks`, { method: "GET" });
    expect(res.status).toBe(401);
  });
});

describe("F3: magic link abuse", () => {
  const config = { ...rateLimitConfigFromEnv({ RATE_LIMIT: "on" }), rules: DEFAULT_RULES };
  function limitedApp(now: () => number = Date.now) {
    const limited = new Hono();
    limited.use("*", createRateLimiter(config, { now }).middleware);
    limited.post("/api/auth/sign-in/magic-link", (c) => c.json({ ok: true }));
    return (email: unknown, init: { ip?: string; pad?: number; length?: boolean } = {}) => {
      const body = JSON.stringify({ email, pad: "x".repeat(init.pad ?? 0) });
      return limited.request("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(init.length === false ? {} : { "content-length": String(Buffer.byteLength(body)) }),
          "x-forwarded-for": init.ip ?? "198.51.100.1",
        },
        body,
      });
    };
  }

  it("counts the 7 Gmail spellings of the audit as one address", async () => {
    const ask = limitedApp();
    const variants = [
      "victim@gmail.com",
      "victim+1@gmail.com",
      "victim+2@gmail.com",
      "v.ictim@gmail.com",
      "vi.ctim@gmail.com",
      "victim@googlemail.com",
      "VICTIM+3@GMAIL.COM",
    ];
    const statuses = [];
    for (const [i, email] of variants.entries()) statuses.push((await ask(email, { ip: `203.0.113.${i + 1}` })).status);
    expect(statuses).toEqual([200, 429, 429, 429, 429, 429, 429]);
  });

  it("normalizes: NFKC, case, Gmail dots and tags, and keeps other domains' tags", () => {
    expect(normalizeEmail(" Víctim@Example.COM ")).toBe("víctim@example.com");
    expect(normalizeEmail("ｖｉｃｔｉｍ@example.com")).toBe("victim@example.com");
    expect(normalizeEmail("a.b+c@googlemail.com")).toBe("ab@gmail.com");
    expect(normalizeEmail("a+tag@example.com")).toBe("a+tag@example.com");
    for (const bad of ["a b@example.com", "a@example.com,b@example.com", "a@exa\nmple.com", "a\u0000@example.com", "@example.com", "a@@b.com", "x", 7, null]) {
      expect(normalizeEmail(bad as string)).toBeNull();
    }
  });

  it("answers 400, not a fallback to the client address, for an oversized, unsized or unusable body", async () => {
    const ask = limitedApp();
    expect((await ask("pad@example.com", { pad: 4200 })).status).toBe(400);
    expect((await ask("nolen@example.com", { length: false })).status).toBe(400);
    expect((await ask("a@example.com,b@example.com")).status).toBe(400);
    expect((await ask(undefined)).status).toBe(400);
    expect((await ask("fine@example.com")).status).toBe(200);
  });

  it("allows 5 per address per day and 10 per client address per hour", async () => {
    let clock = Date.now();
    const ask = limitedApp(() => clock);
    const results: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      results.push((await ask("daily@example.com", { ip: `192.0.2.${i + 1}` })).status);
      clock += 61_000;
    }
    expect(results).toEqual([200, 200, 200, 200, 200, 429]);

    const askIp = limitedApp(() => clock);
    const ipResults: number[] = [];
    for (let i = 0; i < 11; i += 1) ipResults.push((await askIp(`ip${i}@example.com`, { ip: "198.51.100.77" })).status);
    // The generic auth rule (30 per 15 minutes) is not what stops the 11th: the hourly per-address-of-client rule is.
    expect(ipResults).toEqual([...Array<number>(10).fill(200), 429]);
  });

  it("does not spend an address's budget on a request that was refused", async () => {
    const limited = new Hono();
    limited.use("*", createRateLimiter(config).middleware);
    limited.post("/api/auth/sign-in/magic-link", (c) => c.json({ code: "x" }, 400));
    const body = JSON.stringify({ email: "victim2@example.com" });
    const init = { method: "POST", headers: { "content-type": "application/json", "content-length": String(body.length) }, body };
    for (let i = 0; i < 4; i += 1) expect((await limited.request("/api/auth/sign-in/magic-link", init)).status).toBe(400);
  });

  it("requires the signed challenge and proof of work, once", async () => {
    const email = freshEmail();
    await expect(demoAuth.api.signInMagicLink({ body: { email }, headers: new Headers() })).rejects.toMatchObject({
      body: { code: "CHALLENGE_FAILED" },
    });
    const challenge = issueSignInChallenge(Date.now() - 10_000);
    const good = { "x-demo-challenge": JSON.stringify(challenge), "x-demo-solution": solve(challenge) };
    // Wrong solution, too new, forged signature.
    await expect(
      demoAuth.api.signInMagicLink({ body: { email }, headers: new Headers({ ...good, "x-demo-solution": "99999999" }) }),
    ).rejects.toMatchObject({ body: { code: "CHALLENGE_FAILED" } });
    const fresh = issueSignInChallenge();
    await expect(
      demoAuth.api.signInMagicLink({
        body: { email },
        headers: new Headers({ "x-demo-challenge": JSON.stringify(fresh), "x-demo-solution": solve(fresh) }),
      }),
    ).rejects.toMatchObject({ body: { code: "CHALLENGE_FAILED" } });
    await expect(
      demoAuth.api.signInMagicLink({
        body: { email },
        headers: new Headers({ "x-demo-challenge": JSON.stringify({ ...challenge, signature: "A".repeat(43) }), "x-demo-solution": solve(challenge) }),
      }),
    ).rejects.toMatchObject({ body: { code: "CHALLENGE_FAILED" } });
    expect(sent).toEqual([]);
    // The good one works once, and a replay of the same challenge does not.
    await demoAuth.api.signInMagicLink({ body: { email }, headers: new Headers(good) });
    expect(sent).toHaveLength(1);
    await expect(demoAuth.api.signInMagicLink({ body: { email }, headers: new Headers(good) })).rejects.toMatchObject({
      body: { code: "CHALLENGE_FAILED" },
    });
  });

  it("serves a challenge at GET /api/demo/challenge in demo mode only", async () => {
    const res = await app.request("/api/demo/challenge");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nonce: string; difficulty: number; signature: string; issuedAt: string };
    expect(body).toMatchObject({ difficulty: 4 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("DEMO_MODE", "");
    expect((await app.request("/api/demo/challenge")).status).toBe(404);
  });
});

describe("F4: sandbox farming", () => {
  it("one sandbox per normalized address, before any account is created", async () => {
    await signIn("farmer@gmail.com");
    for (const variant of ["farmer+a@gmail.com", "f.armer@gmail.com", "farmer@googlemail.com"]) {
      await expect(
        demoAuth.api.signInMagicLink({ body: { email: variant }, headers: signInHeaders() }),
      ).rejects.toMatchObject({ body: { code: "DEMO_ADDRESS_IN_USE" } });
    }
    expect((await db.select({ n: count() }).from(user))[0]!.n).toBe(1);
    // The returning visitor still gets in with the address they used.
    await demoAuth.api.signInMagicLink({ body: { email: "farmer@gmail.com" }, headers: signInHeaders() });
  });

  it("holds under a race: the unique value stops two accounts of one address", async () => {
    const a = await makeUser("race@gmail.com");
    const b = await makeUser("r.ace+x@gmail.com");
    const settled = await Promise.allSettled([provisionSandbox(db, a.id), provisionSandbox(db, b.id)]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select({ n: count() }).from(demoSandboxes))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(1);
  });

  it("stops at the global cap with a distinct 'demo is full' error, and creates no account", async () => {
    vi.stubEnv("DEMO_MAX_SANDBOXES", "1");
    await signIn(freshEmail());
    await expect(
      demoAuth.api.signInMagicLink({ body: { email: freshEmail() }, headers: signInHeaders() }),
    ).rejects.toMatchObject({ body: { code: "DEMO_FULL" } });
    expect((await db.select({ n: count() }).from(user))[0]!.n).toBe(1);
    // Google takes the same path: the account is refused before it exists.
    expect(await admissionFor(db, "someone@example.com", null)).toBe("full");
  });

  it("stops at the daily cap, and a sandbox created two days ago does not count", async () => {
    vi.stubEnv("DEMO_MAX_NEW_PER_DAY", "2");
    await signIn(freshEmail());
    await signIn(freshEmail());
    expect(await admissionFor(db, "third@example.com", null)).toBe("full");
    await db.update(demoSandboxes).set({ createdAt: new Date(Date.now() - 2 * 864e5) });
    expect(await admissionFor(db, "third@example.com", null)).toBeNull();
  });

  it("holds the global cap under concurrent builds", async () => {
    vi.stubEnv("DEMO_MAX_SANDBOXES", "3");
    const users = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const settled = await Promise.allSettled(users.map((u) => provisionSandbox(db, u.id)));
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await db.select({ n: count() }).from(demoSandboxes))[0]!.n).toBe(3);
    expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(3);
  }, 60_000);

  it("leaves a refused first sign-in with no account", async () => {
    vi.stubEnv("DEMO_MAX_SANDBOXES", "1");
    await signIn(freshEmail());
    // An account that exists already (made before the demo filled up) is refused at provisioning and removed.
    const late = await makeUser();
    await expect(provisionSandbox(db, late.id)).rejects.toMatchObject({ reason: "full" });
    expect((await db.select({ n: count() }).from(venues))[0]!.n).toBe(1);
  });
});

describe("F6: caps count inside the transaction", () => {
  it("150 concurrent bookings cannot pass the reservation cap", async () => {
    const v = await makeUser();
    const { venueId } = await provisionSandbox(db, v.id);
    const [{ n: existing }] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId));
    vi.stubEnv("DEMO_MAX_RESERVATIONS", String(existing! + 4));
    vi.stubEnv("DEMO_MAX_GUESTS", "1000");
    const date = dateInTz(DEMO_TEMPLATE.venue.timezone, 4);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        createReservation(db, venueId, { date, time: i % 2 ? "21:00" : "21:30", partySize: 1, guestName: "G", guestContact: `c${i}@example.com`, overbook: true } as never, `race-${i}`),
      ),
    );
    const total = (await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId)))[0]!.n;
    expect(total).toBeLessThanOrEqual(existing! + 4);
    expect(results.filter((r) => !r.ok && r.code === "guest_booking_limit").length).toBeGreaterThan(0);
  }, 60_000);

  it("concurrent bookings cannot pass the guest cap", async () => {
    const v = await makeUser();
    const { venueId } = await provisionSandbox(db, v.id);
    const [{ n: known }] = await db.select({ n: count() }).from(guests).where(eq(guests.venueId, venueId));
    vi.stubEnv("DEMO_MAX_GUESTS", String(known! + 3));
    vi.stubEnv("DEMO_MAX_RESERVATIONS", "1000");
    const date = dateInTz(DEMO_TEMPLATE.venue.timezone, 4);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createReservation(db, venueId, { date, time: i % 2 ? "21:00" : "21:30", partySize: 1, guestName: "G", guestContact: `new${i}@example.com` }, `g-${i}`),
      ),
    );
    const total = (await db.select({ n: count() }).from(guests).where(eq(guests.venueId, venueId)))[0]!.n;
    expect(total).toBeLessThanOrEqual(known! + 3);
  }, 60_000);

  it("caps waitlist entries under concurrent writes, and answers 409 demo_limit_reached over HTTP", async () => {
    const { cookie, account } = await signIn(freshEmail());
    const venueId = await sandboxVenue(account.email);
    const [{ n }] = await db.select({ n: count() }).from(waitlist).where(eq(waitlist.venueId, venueId));
    vi.stubEnv("DEMO_MAX_WAITLIST", String(n! + 3));
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => addWaitlist(db, venueId, { partySize: 2, guestName: "W" })));
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(settled.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof DemoLimitError)).toBe(true);
    const res = await app.request(`/v1/venues/${venueId}/waitlist`, json(cookie, { method: "POST", body: JSON.stringify({ partySize: 2, guestName: "W" }) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "demo_limit_reached", retryable: false });
  });

  it("caps tables, services, floor items, invitations, keys and blocklist entries of a sandbox only", async () => {
    const v = await makeUser();
    const { venueId } = await provisionSandbox(db, v.id);
    const real = await makeUser();
    const { id: realVenue } = await createVenue(db, real.id, { name: "Real", timezone: "Europe/Madrid" });

    const room = async (limit: string, held: number) => vi.stubEnv(limit, String(held + 1));
    // tables
    await room("DEMO_MAX_TABLES", DEMO_TEMPLATE.tables.length);
    await upsertTable(db, venueId, { id: "extra-1", name: "X1", seats: 2 });
    await expect(upsertTable(db, venueId, { id: "extra-2", name: "X2", seats: 2 })).rejects.toBeInstanceOf(DemoLimitError);
    // An update of an existing table is not a new one.
    await upsertTable(db, venueId, { id: "extra-1", name: "X1b", seats: 3 });
    // services
    await room("DEMO_MAX_SERVICES", DEMO_TEMPLATE.services.length);
    await upsertService(db, venueId, { name: "brunch", openStart: "10:00", openEnd: "12:00" });
    await expect(upsertService(db, venueId, { name: "tea", openStart: "16:00", openEnd: "18:00" })).rejects.toBeInstanceOf(DemoLimitError);
    await upsertService(db, venueId, { name: "brunch", openStart: "10:00", openEnd: "12:30" });
    // floor items
    await room("DEMO_MAX_FLOOR_ITEMS", DEMO_TEMPLATE.floorItems.length);
    await addFloorItem(db, venueId, { type: "plant" });
    await expect(addFloorItem(db, venueId, { type: "plant" })).rejects.toBeInstanceOf(DemoLimitError);
    // invitations (the template made one)
    await room("DEMO_MAX_INVITATIONS", 1);
    await createInvitation(db, venueId, v.id, { role: "read" });
    await expect(createInvitation(db, venueId, v.id, { role: "read" })).rejects.toBeInstanceOf(DemoLimitError);
    // keys
    vi.stubEnv("DEMO_MAX_API_KEYS", "1");
    await addVenueKey(db, venueId, "key-one", "agent", "read");
    await expect(addVenueKey(db, venueId, "key-two", "agent", "read")).rejects.toBeInstanceOf(DemoLimitError);
    // blocklist
    vi.stubEnv("DEMO_MAX_BLOCKLIST", "1");
    const first = await addToBlocklist(db, blocklistKeys, venueId, v.id, { contact: "+34600000001" }, null);
    expect(first.ok).toBe(true);
    expect(await addToBlocklist(db, blocklistKeys, venueId, v.id, { contact: "+34600000002" }, null)).toEqual({ ok: false, code: "blocklist_limit_reached" });

    // A real venue is never capped.
    vi.stubEnv("DEMO_MAX_TABLES", "1");
    vi.stubEnv("DEMO_MAX_WAITLIST", "1");
    await upsertTable(db, realVenue, { id: "r1", name: "R1", seats: 2 });
    await upsertTable(db, realVenue, { id: "r2", name: "R2", seats: 2 });
    await addWaitlist(db, realVenue, { partySize: 2 });
    await addWaitlist(db, realVenue, { partySize: 2 });
    await expect(enforceSandboxCap(db, realVenue, "tables")).resolves.toBeUndefined();
  });
});

describe("F7 and F8: consent is recorded by the signed-in account", () => {
  const consent = (cookie: string, body: unknown, extra: Record<string, string> = {}) =>
    app.request("/api/demo/consent", json(cookie, { method: "POST", body: JSON.stringify(body), headers: extra }));

  it("needs a session", async () => {
    const res = await app.request("/api/demo/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "v1", locale: "en" }),
    });
    expect(res.status).toBe(401);
  });

  it("records the lead for the account's own verified address, and only then", async () => {
    const email = freshEmail();
    const { cookie } = await signIn(email);
    expect((await db.select().from(demoLeads)).length).toBe(0);
    const res = await consent(cookie, { version: "v1", locale: "es", name: "  Ana  " });
    expect(res.status).toBe(204);
    const [lead] = await db.select().from(demoLeads);
    expect(lead).toMatchObject({ email, name: "Ana", locale: "es", contactConsent: true, consentTextVersion: "v1", source: "magic-link", withdrawnAt: null });
  });

  it("validates the body strictly", async () => {
    const { cookie } = await signIn(freshEmail());
    const bad: unknown[] = [
      { version: "v2", locale: "en" },
      { version: "v1", locale: "zz" },
      { version: "v1" },
      { version: "v1", locale: "en", name: "x".repeat(121) },
      { version: "v1", locale: "en", name: 5 },
      { version: "v1", locale: "en", name: "a\nb" },
      { version: "v1", locale: "en", email: "victim@example.org" },
      [],
      "v1",
    ];
    for (const body of bad) expect((await consent(cookie, body)).status).toBe(400);
    expect((await db.select().from(demoLeads)).length).toBe(0);
  });

  it("ignores the old consent headers and a forged claim cookie: nobody consents for another inbox", async () => {
    const victim = freshEmail();
    await demoAuth.api.signInMagicLink({
      body: { email: victim, name: "Evil" } as never,
      headers: signInHeaders({ "x-demo-consent": "v1", "x-demo-locale": "es" }),
    });
    const mail = sent.pop()!;
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    await demoAuth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
    expect((await db.select().from(demoLeads)).length).toBe(0);

    const { cookie } = await signIn(freshEmail());
    const forged = Buffer.from(JSON.stringify({ consentVersion: "v1", locale: "zz", name: "x".repeat(500) })).toString("base64url");
    await app.request("/v1/venues", json(cookie, { headers: { cookie: `${cookie}; oc_demo_claim=${forged}` } }));
    expect((await db.select().from(demoLeads)).length).toBe(0);
  });

  it("is absent when DEMO_MODE is off", async () => {
    const { cookie } = await signIn(freshEmail());
    vi.stubEnv("DEMO_MODE", "");
    expect((await consent(cookie, { version: "v1", locale: "en" })).status).toBe(404);
  });

  it("a withdrawn lead is excluded from the export and --erase deletes the row", async () => {
    const input = { version: "v1", locale: "en", name: null };
    await recordConsent(db, { email: "keep@example.com", source: "google", consent: input });
    await recordConsent(db, { email: "gone@example.com", source: "google", consent: input });
    await db.update(demoLeads).set({ withdrawnAt: new Date() }).where(eq(demoLeads.email, "gone@example.com"));
    expect(await consentedLeadsCsv(db)).not.toContain("gone@example.com");
    expect(await eraseLead(db, " Gone@Example.com ")).toBe(1);
    expect((await db.select().from(demoLeads)).map((l) => l.email)).toEqual(["keep@example.com"]);
  });

  it("cleanup deletes consented leads 12 months after last_seen_at, and never keeps a row without consent", async () => {
    const input = { version: "v1", locale: "en", name: null };
    await recordConsent(db, { email: "old@example.com", source: "google", consent: input });
    await recordConsent(db, { email: "new@example.com", source: "google", consent: input });
    await db.update(demoLeads).set({ lastSeenAt: new Date(Date.now() - 400 * 864e5) }).where(eq(demoLeads.email, "old@example.com"));
    await db.insert(demoLeads).values({ email: "stray@example.com", source: "google", contactConsent: false });
    const result = await cleanupExpiredSandboxes(db);
    expect(result.leads).toBe(2);
    expect((await db.select().from(demoLeads)).map((l) => l.email)).toEqual(["new@example.com"]);
  });

  it("a consented lead who signs in again keeps their 12 months running", async () => {
    const email = freshEmail();
    const { cookie } = await signIn(email);
    await consent(cookie, { version: "v1", locale: "en" });
    await db.update(demoLeads).set({ lastSeenAt: new Date(Date.now() - 300 * 864e5) });
    await signIn(email);
    const [lead] = await db.select().from(demoLeads);
    expect(Date.now() - lead!.lastSeenAt.getTime()).toBeLessThan(60_000);
  });
});

describe("F11, F12 and F13", () => {
  it("pins allowedOrigins for a sandbox: client writes are ignored", async () => {
    const { cookie, account } = await signIn(freshEmail());
    const venueId = await sandboxVenue(account.email);
    const res = await app.request(
      `/v1/venues/${venueId}/online-booking`,
      json(cookie, { method: "PUT", body: JSON.stringify({ allowedOrigins: ["https://evil.example"] }) }),
    );
    expect(res.status).toBe(200);
    const read = await app.request(`/v1/venues/${venueId}/online-booking`, json(cookie));
    expect(((await read.json()) as { allowedOrigins: string[] }).allowedOrigins).toEqual([]);
  });

  it("sets the demo host as the only allowed origin when the demo URL is https", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://demo.opencovers.dev");
    const v = await makeUser();
    const { venueId } = await provisionSandbox(db, v.id);
    const [row] = await db.execute<{ allowed_origins: string[] }>(sql`SELECT allowed_origins FROM venue_online_booking WHERE venue_id = ${venueId}`).then((r) => r.rows);
    expect(row!.allowed_origins).toEqual(["https://demo.opencovers.dev"]);
  });

  it("stores the magic link token hashed, still single use, and never logs the link", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const email = freshEmail();
    const { token } = await signIn(email);
    const stored = await db.execute<{ identifier: string }>(sql`SELECT identifier FROM verification`);
    expect(stored.rows.some((r) => r.identifier.includes(token))).toBe(false);
    // Opening it again fails.
    const again = await demoAuth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
    expect(again.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);

    // Without mail configured and without a capture, nothing is printed.
    const quiet = createAuth(demoSettings({ DEMO_MODE: "1" }));
    await quiet.api.signInMagicLink({ body: { email: freshEmail() }, headers: signInHeaders() });
    expect(log).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/https?:\/\//);
    log.mockRestore();
    warn.mockRestore();
  });
});
