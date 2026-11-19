import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-form-challenge";
  process.env.PUBLIC_POW_DIFFICULTY = "4";
  // The operator's own sender. A sandbox always mails with it (audit F12).
  process.env.RESEND_API_KEY = "re_operator";
  process.env.RESEND_FROM_EMAIL = "operator@opencovers.test";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  demoLeads,
  demoSandboxes,
  guests,
  reservations,
  services,
  tables,
  user,
  venueMemberships,
  venues,
  webhookEndpoints,
} from "../src/db/schema";
import { createAuth, requireVerifiedGoogleEmail } from "../src/lib/auth";
import { cleanupExpiredSandboxes } from "../src/demo/cleanup";
import { isDisposableEmail } from "../src/demo/disposable";
import { consentedLeadsCsv, recordConsent } from "../src/demo/leads";
import { issueSignInChallenge } from "../src/demo/sign-in-challenge";
import { provisionSandbox } from "../src/demo/provision";
import { purgeVenue, VENUE_TABLES_IN_DELETE_ORDER } from "../src/demo/purge";
import { demoSettings } from "../src/demo/settings";
import { DEMO_TEMPLATE, dateInTz } from "../src/demo/template";
import { notifyReservation } from "../src/lib/notifications";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { createRateLimiter, DEFAULT_RULES, rateLimitConfigFromEnv, rulesFor } from "../src/lib/rate-limit";
import { createReservation } from "../src/lib/reservations";
import { setConfig } from "../src/lib/venue";

const DEMO_ENV = { DEMO_MODE: "1" };
const sent: { to: string; text: string }[] = [];
const demoAuth = createAuth(demoSettings(DEMO_ENV), {
  sendMail: async (to, _subject, text) => {
    sent.push({ to, text });
  },
});
const challengeConfig = challengeConfigFromEnv();

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  sent.length = 0;
  vi.stubEnv("DEMO_MODE", "1");
  // No test mails anyone: a stray send would otherwise reach the network.
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  await db.execute(
    sql`TRUNCATE TABLE demo_lead, demo_sandbox, account, session, verification, "user", venue_memberships, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, self_service_links, grants, api_keys, services, tables, floor_items, webhook_endpoints, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let n = 0;
const freshEmail = () => `visitor-${++n}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** The headers a sign-in form sends: a challenge old enough to pass the minimum fill time, and its solution. */
function signInHeaders(extra: Record<string, string> = {}) {
  const challenge = issueSignInChallenge(Date.now() - 10_000);
  return new Headers({
    "x-demo-challenge": JSON.stringify(challenge),
    "x-demo-solution": solve(challenge),
    ...extra,
  });
}

/** Signs in with a magic link the way a visitor does: ask for it, then open it. Returns the account and its cookie. */
async function signInWithMagicLink(email: string, headers: Record<string, string> = {}) {
  await demoAuth.api.signInMagicLink({ body: { email }, headers: signInHeaders(headers) });
  const mail = sent.filter((m) => m.to === email).pop()!;
  const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
  const res = await demoAuth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const [account] = await db.select().from(user).where(eq(user.email, email));
  return { account: account!, cookie };
}

async function sandboxOf(email: string) {
  const [row] = await db
    .select({ venueId: demoSandboxes.venueId, userId: demoSandboxes.userId })
    .from(demoSandboxes)
    .innerJoin(user, eq(user.id, demoSandboxes.userId))
    .where(eq(user.email, email));
  return row;
}

const json = (cookie: string, init: RequestInit = {}) => ({
  ...init,
  headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json", ...(init.headers ?? {}) },
});

describe("demo settings", () => {
  it("is off by default and accepts 0 and 1", () => {
    expect(demoSettings({}).enabled).toBe(false);
    expect(demoSettings({ DEMO_MODE: "" }).enabled).toBe(false);
    expect(demoSettings({ DEMO_MODE: "0" }).enabled).toBe(false);
    expect(demoSettings({ DEMO_MODE: "1" }).enabled).toBe(true);
  });

  it("stops at startup on a value that is not 1 or 0, instead of falling back to off", () => {
    expect(() => demoSettings({ DEMO_MODE: "true" })).toThrow(/DEMO_MODE must be 1 or 0/);
  });

  it("enables Google only when both variables are set", () => {
    expect(demoSettings({ DEMO_MODE: "1" }).google).toBeNull();
    expect(demoSettings({ DEMO_MODE: "1", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }).google).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    expect(() => demoSettings({ DEMO_MODE: "1", GOOGLE_CLIENT_ID: "a" })).toThrow(/set together/);
  });

  it("needs Resend in production", () => {
    expect(() => demoSettings({ DEMO_MODE: "1", NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    expect(
      demoSettings({ DEMO_MODE: "1", NODE_ENV: "production", RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "a@b.c" }).enabled,
    ).toBe(true);
  });
});

describe("sandbox provisioning", () => {
  it("builds every piece of the demo restaurant, and the diner side works", async () => {
    const email = freshEmail();
    const { account, cookie } = await signInWithMagicLink(email);
    const sandbox = await sandboxOf(email);
    expect(sandbox).toBeDefined();
    const venueId = sandbox!.venueId;

    // The visitor is a real admin of a real venue.
    const [membership] = await db.select().from(venueMemberships).where(eq(venueMemberships.userId, account.id));
    expect(membership).toMatchObject({ venueId, role: "admin" });
    const [venue] = await db.select().from(venues).where(eq(venues.id, venueId));
    expect(venue).toMatchObject({ name: DEMO_TEMPLATE.venue.name, publicProfileEnabled: true, noticeAddress: email });

    expect((await db.select().from(services).where(eq(services.venueId, venueId))).length).toBe(DEMO_TEMPLATE.services.length);
    expect((await db.select().from(tables).where(eq(tables.venueId, venueId))).length).toBe(DEMO_TEMPLATE.tables.length);

    // Every screen has data: agenda for tomorrow, floor plan, waitlist, team.
    const tomorrow = dateInTz(DEMO_TEMPLATE.venue.timezone, 1);
    const agenda = await app.request(`/v1/venues/${venueId}/agenda?date=${tomorrow}`, json(cookie));
    expect(agenda.status).toBe(200);
    expect(((await agenda.json()) as { reservations: unknown[] }).reservations.length).toBeGreaterThan(0);
    const floor = await app.request(`/v1/venues/${venueId}/floor-items`, json(cookie));
    expect(((await floor.json()) as { items: unknown[] }).items.length).toBe(DEMO_TEMPLATE.floorItems.length);
    const waitlist = await app.request(`/v1/venues/${venueId}/waitlist`, json(cookie));
    expect(((await waitlist.json()) as { entries: unknown[] }).entries.length).toBe(DEMO_TEMPLATE.waitlist.length);
    const invitations = await app.request(`/v1/venues/${venueId}/invitations`, json(cookie));
    expect(((await invitations.json()) as { invitations: unknown[] }).invitations.length).toBe(1);

    // Every invented guest is on example.com.
    const rows = await db.select({ contact: reservations.guestContact }).from(reservations).where(eq(reservations.venueId, venueId));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.contact === "" || r.contact.endsWith("@example.com"))).toBe(true);

    // Online booking is on and its key opens the widget.
    const settings = await app.request(`/v1/venues/${venueId}/online-booking`, json(cookie));
    const { bookingKey, enabled } = (await settings.json()) as { bookingKey: string; enabled: boolean };
    expect(enabled).toBe(true);
    expect(bookingKey).toBeTruthy();
    const widget = await app.request(`/v1/public/${bookingKey}`);
    expect(widget.status).toBe(200);

    // The visitor books as a diner. The booking shows up on the restaurant side with its origin.
    const challenge = issueChallenge(challengeConfig, bookingKey, Date.now() - 10_000);
    const book = await app.request(`/v1/public/${bookingKey}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        date: dateInTz(DEMO_TEMPLATE.venue.timezone, 2),
        time: "21:15",
        partySize: 2,
        guest: { name: "Visitante", contact: email },
        challenge,
        solution: solve(challenge),
      }),
    });
    expect(book.status).toBe(200);
    const feed = await app.request(`/v1/venues/${venueId}/events`, json(cookie));
    const { events } = (await feed.json()) as { events: { type: string; reservationId: string }[] };
    const booked = (await db.select().from(reservations).where(and(eq(reservations.venueId, venueId), eq(reservations.bookedVia, "widget"))))[0];
    expect(booked).toBeDefined();
    expect(events.some((e) => e.reservationId === booked!.id)).toBe(true);
    const detail = await app.request(`/v1/venues/${venueId}/reservations/${booked!.id}`, json(cookie));
    expect(((await detail.json()) as { bookedVia: string }).bookedVia).toBe("widget");
  });

  it("is a no-op the second time: one sandbox per account", async () => {
    const email = freshEmail();
    const { account } = await signInWithMagicLink(email);
    const first = await sandboxOf(email);
    const before = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, first!.venueId));

    const again = await provisionSandbox(db, account.id);
    expect(again.created).toBe(false);
    expect(again.venueId).toBe(first!.venueId);
    expect(again.bookingKey).toBeTruthy();

    // A second sign-in goes through the same path.
    await signInWithMagicLink(email);
    expect((await db.select().from(demoSandboxes)).length).toBe(1);
    expect((await db.select().from(venues)).length).toBe(1);
    const after = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, first!.venueId));
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("builds one sandbox when two provisions race", async () => {
    const email = freshEmail();
    const { account } = await signInWithMagicLink(email);
    await purgeVenue(db, (await sandboxOf(email))!.venueId);
    const [a, b] = await Promise.all([provisionSandbox(db, account.id), provisionSandbox(db, account.id)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect((await db.select().from(venues)).length).toBe(1);
  });

  it("gives two visitors separate venues", async () => {
    const a = await signInWithMagicLink(freshEmail());
    const b = await signInWithMagicLink(freshEmail());
    const [sa, sb] = [await sandboxOf(a.account.email), await sandboxOf(b.account.email)];
    expect(sa!.venueId).not.toBe(sb!.venueId);
    const other = await app.request(`/v1/venues/${sb!.venueId}/agenda?date=${dateInTz("Europe/Madrid", 1)}`, json(a.cookie));
    expect(other.status).toBe(404);
  });

  it("refuses a second venue to a demo visitor", async () => {
    const { cookie } = await signInWithMagicLink(freshEmail());
    const res = await app.request("/v1/venues", json(cookie, { method: "POST", body: JSON.stringify({ name: "Otro" }) }));
    expect(res.status).toBe(403);
  });
});

describe("sign-in", () => {
  it("refuses password sign-up in demo mode, and the magic-link route is absent when it is off", async () => {
    await expect(
      demoAuth.api.signUpEmail({ body: { name: "X", email: freshEmail(), password: "password123" } }),
    ).rejects.toThrow();
    expect((await db.select().from(user)).length).toBe(0);

    vi.stubEnv("DEMO_MODE", "");
    const off = await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email: freshEmail() }),
    });
    expect(off.status).toBe(404);
  });

  it("refuses a disposable address before sending anything", async () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@sub.Mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    await expect(
      demoAuth.api.signInMagicLink({ body: { email: "ghost@mailinator.com" }, headers: signInHeaders() }),
    ).rejects.toMatchObject({ body: { code: "DISPOSABLE_EMAIL" } });
    expect(sent).toEqual([]);
    expect((await db.select().from(user)).length).toBe(0);
  });

  it("limits a magic link to one per address per minute, per address", async () => {
    const config = { ...rateLimitConfigFromEnv({ RATE_LIMIT: "on" }), rules: DEFAULT_RULES };
    const limited = new Hono();
    limited.use("*", createRateLimiter(config).middleware);
    limited.post("/api/auth/sign-in/magic-link", (c) => c.json({ ok: true }));
    const ask = (email: string, ip = "198.51.100.1") => {
      const body = JSON.stringify({ email });
      return limited.request("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(body.length), "x-forwarded-for": ip },
        body,
      });
    };
    expect(rulesFor("POST", "/api/auth/sign-in/magic-link", false)).toEqual(["auth", "magic_link", "magic_link_day", "magic_link_ip"]);
    expect((await ask("a@example.com")).status).toBe(200);
    expect((await ask(" A@Example.com ")).status).toBe(429);
    expect((await ask("b@example.com")).status).toBe(200);
  });

  it("requires a verified Google email", () => {
    expect(() => requireVerifiedGoogleEmail({ email_verified: false })).toThrow(/verified/);
    expect(() => requireVerifiedGoogleEmail({})).toThrow();
    expect(requireVerifiedGoogleEmail({ email_verified: true })).toEqual({});
  });

  it("starts Google sign-in without any claim cookie or consent header handling", async () => {
    const google = createAuth(
      demoSettings({ ...DEMO_ENV, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    );
    const res = await google.handler(
      new Request("http://localhost:3000/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-demo-consent": "v1", "x-demo-locale": "es" },
        body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:3000/" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("oc_demo_claim="))).toBe(false);
  });
});

describe("leads", () => {
  it("a sign-in alone creates no lead", async () => {
    await signInWithMagicLink(freshEmail(), { "x-demo-consent": "v1" });
    expect((await db.select().from(demoLeads)).length).toBe(0);
  });

  it("exports only consented, not withdrawn leads as CSV, and no route returns leads", async () => {
    const consent = { version: "v1", locale: "es", name: null };
    await recordConsent(db, { email: "yes@example.com", source: "magic-link", consent });
    await recordConsent(db, { email: "gone@example.com", source: "magic-link", consent });
    await db.update(demoLeads).set({ withdrawnAt: new Date() }).where(eq(demoLeads.email, "gone@example.com"));
    const csv = await consentedLeadsCsv(db);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("email,name,source,locale,created_at,last_seen_at,consent_text_version");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^yes@example\.com,/);
    expect(app.routes.some((r) => /lead/i.test(r.path) && r.method === "GET")).toBe(false);
  });

  it("neutralizes spreadsheet formulas in the export", async () => {
    await db.insert(demoLeads).values({
      email: "f@example.com",
      name: '=HYPERLINK("x")',
      source: "google",
      contactConsent: true,
      consentTextVersion: "v1",
    });
    expect(await consentedLeadsCsv(db)).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("abuse limits", () => {
  it("stops a sandbox at its cap, and a replayed request still replays", async () => {
    const { account } = await signInWithMagicLink(freshEmail());
    const { venueId } = (await sandboxOf(account.email))!;
    const [{ n: existing }] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId));
    vi.stubEnv("DEMO_MAX_RESERVATIONS", String(existing! + 1));
    const input = (time: string) => ({
      date: dateInTz(DEMO_TEMPLATE.venue.timezone, 5),
      time,
      partySize: 2,
      guestName: "Cap",
      guestContact: "cap@example.com",
    });
    const first = await createReservation(db, venueId, input("21:00"), "cap-key-1");
    expect(first.ok).toBe(true);
    const second = await createReservation(db, venueId, input("21:30"), "cap-key-2");
    expect(second).toEqual({ ok: false, code: "guest_booking_limit" });
    const replay = await createReservation(db, venueId, input("21:00"), "cap-key-1");
    expect(replay.ok).toBe(true);
  });

  it("does not cap a venue that is not a sandbox", async () => {
    vi.stubEnv("DEMO_MAX_RESERVATIONS", "1");
    await db.insert(venues).values({ id: "real", name: "Real", timezone: "Europe/Madrid" });
    await db.insert(services).values({ venueId: "real", name: "dinner", openStart: "20:00", openEnd: "23:30" });
    await db.insert(tables).values([{ id: "t1", venueId: "real", name: "T1", seats: 4 }, { id: "t2", venueId: "real", name: "T2", seats: 4 }]);
    const date = dateInTz("Europe/Madrid", 3);
    for (const [i, time] of ["20:00", "20:30"].entries()) {
      const r = await createReservation(db, "real", { date, time, partySize: 2, guestName: "A", guestContact: `a${i}@example.com` }, `real-${i}`);
      expect(r).toMatchObject({ ok: true });
    }
  });

  it("refuses webhooks on a sandbox", async () => {
    const { cookie, account } = await signInWithMagicLink(freshEmail());
    const { venueId } = (await sandboxOf(account.email))!;
    const res = await app.request(
      `/v1/venues/${venueId}/webhooks`,
      json(cookie, { method: "POST", body: JSON.stringify({ url: "https://hooks.example.com/x" }) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("webhook_url_rejected");
    expect((await db.select().from(webhookEndpoints)).length).toBe(0);
  });

  it("emails only the owner's verified address", async () => {
    const owner = freshEmail();
    const { account } = await signInWithMagicLink(owner);
    const { venueId } = (await sandboxOf(owner))!;
    await setConfig(db, venueId, { resendApiKey: "re_test", fromEmail: "demo@opencovers.test" });
    const fetched: { to: string[]; from: string }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      fetched.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    });

    const date = dateInTz(DEMO_TEMPLATE.venue.timezone, 6);
    const stranger = await createReservation(db, venueId, { date, time: "21:00", partySize: 2, guestName: "S", guestContact: "stranger@example.com" }, "mail-1");
    const own = await createReservation(db, venueId, { date, time: "21:30", partySize: 2, guestName: "O", guestContact: owner }, "mail-2");
    if (!stranger.ok || !own.ok) throw new Error("setup failed");
    await notifyReservation(db, venueId, stranger.id, stranger.version, "confirmation");
    expect(fetched).toEqual([]);
    await notifyReservation(db, venueId, own.id, own.version, "confirmation");
    expect(fetched.map((f) => f.to)).toEqual([[owner]]);
    // The visitor's own sender and key were ignored: mail goes out with the operator's (audit F12).
    expect(fetched[0]!.from).toBe("operator@opencovers.test");
    void account;
  });
});

describe("lifecycle", () => {
  it("deletes expired sandboxes and their accounts, keeps live ones and every lead", async () => {
    const old = await signInWithMagicLink(freshEmail());
    await recordConsent(db, { email: old.account.email, source: "magic-link", consent: { version: "v1", locale: "en", name: null } });
    const fresh = await signInWithMagicLink(freshEmail());
    const oldBox = (await sandboxOf(old.account.email))!;
    const freshBox = (await sandboxOf(fresh.account.email))!;
    // A key and a grant on the old sandbox, to prove they go too.
    await db.execute(sql`INSERT INTO api_keys (hash, principal, role) VALUES ('k1', 'agent', 'write')`);
    await db.execute(sql`INSERT INTO grants (key_hash, venue_id) VALUES ('k1', ${oldBox.venueId})`);

    await db
      .update(demoSandboxes)
      .set({ lastSignInAt: new Date(Date.now() - 15 * 864e5) })
      .where(eq(demoSandboxes.userId, old.account.id));
    const justInside = await signInWithMagicLink(freshEmail());
    await db
      .update(demoSandboxes)
      .set({ lastSignInAt: new Date(Date.now() - 13 * 864e5) })
      .where(eq(demoSandboxes.userId, justInside.account.id));

    const result = await cleanupExpiredSandboxes(db);
    expect(result).toMatchObject({ sandboxes: 1, accounts: 1, orphanAccounts: 0, leads: 0 });

    expect(await sandboxOf(old.account.email)).toBeUndefined();
    expect((await db.select().from(user).where(eq(user.id, old.account.id))).length).toBe(0);
    expect((await db.select().from(venues).where(eq(venues.id, oldBox.venueId))).length).toBe(0);
    for (const table of [reservations, guests, services, tables]) {
      expect((await db.select({ n: count() }).from(table).where(eq(table.venueId, oldBox.venueId)))[0]!.n).toBe(0);
    }
    expect((await db.execute(sql`SELECT 1 FROM api_keys WHERE hash = 'k1'`)).rows.length).toBe(0);

    // The others are untouched.
    expect(await sandboxOf(fresh.account.email)).toBeDefined();
    expect(await sandboxOf(justInside.account.email)).toBeDefined();
    expect((await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, freshBox.venueId)))[0]!.n).toBeGreaterThan(0);

    // The consented lead stays after its account went: it is the one thing that outlives it (12 months).
    const leads = await db.select().from(demoLeads);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.email).toBe(old.account.email);

    // Signing in again after deletion builds a fresh sandbox.
    await signInWithMagicLink(old.account.email);
    expect(await sandboxOf(old.account.email)).toBeDefined();
  });

  it("deletes from every table that holds a venue_id", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT c.table_name FROM information_schema.columns c
      WHERE c.column_name = 'venue_id' AND c.table_schema = 'public'
        AND c.table_name <> 'venues'
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage k USING (constraint_name, table_name)
          JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
          WHERE tc.table_name = c.table_name AND k.column_name = 'venue_id'
            AND tc.constraint_type = 'FOREIGN KEY' AND rc.delete_rule = 'CASCADE')
    `);
    // grants is cleaned with its keys, and demo_sandbox and self_service_links cascade (the latter is listed anyway
    // because it also points at reservations).
    const present = rows.rows.map((r) => r.table_name).filter((t) => t !== "grants");
    for (const table of present) expect(VENUE_TABLES_IN_DELETE_ORDER as readonly string[]).toContain(table);
  });
});
