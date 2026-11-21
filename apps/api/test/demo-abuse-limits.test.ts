// ADR-0022, decision 8 (b) to (f): one sandbox and one lead per person however the address is spelled, the caps, the
// disposable list, and mail that leaves only to the sandbox owner. No test here depends on the date or the hour: caps
// are counted from rows, and bookings are placed 30 days ahead of whenever the test runs.
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-abuse-limits";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  process.env.WIDGET_ADDRESS = "book.example.com";
  process.env.RESEND_API_KEY = "re_operator";
  process.env.RESEND_FROM_EMAIL = "operator@opencovers.test";
  return { sent: [] as { key: string; from: string; to: string; text: string }[] };
});

// Every email the engine sends goes through here, so the test sees exactly who it would reach.
vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (key: string, from: string, to: string, _subject: string, text: string) => {
    mail.sent.push({ key, from, to, text });
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { demoSandboxes, selfServiceLinks, user, venueMemberships, webhookEndpoints } from "../src/db/schema";
import { cleanupExpiredSandboxes } from "../src/demo/cleanup";
import { isDisposableEmail } from "../src/demo/disposable";
import { mayEmail } from "../src/demo/limits";
import { CHALLENGE_HEADER, SOLUTION_HEADER, magicLinkChallenges } from "../src/demo/magic-link-challenge";
import { normalizeEmail } from "../src/demo/normalize";
import { provisionSandbox } from "../src/demo/provision";
import { demoSettings } from "../src/demo/settings";
import { DEMO_TEMPLATE } from "../src/demo/template";
import { createAuth } from "../src/lib/auth";
import { notifyReservation } from "../src/lib/notifications";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { createReservation } from "../src/lib/reservations";
import { addDays, localDateTime } from "../src/lib/time";
import { setConfig } from "../src/lib/venue";
import { runWebhookDeliveries } from "../src/lib/webhooks";

const links: { to: string; text: string }[] = [];
const demoAuth = createAuth(demoSettings({ DEMO_MODE: "1" }), {
  sendMail: async (to, _subject, text) => {
    links.push({ to, text });
  },
});
const challengeConfig = challengeConfigFromEnv();

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  links.length = 0;
  mail.sent.length = 0;
  vi.stubEnv("DEMO_MODE", "1");
  await db.execute(
    sql`TRUNCATE TABLE demo_sandbox, account, session, verification, "user", venue_memberships, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, self_service_links, grants, api_keys, services, tables, floor_items, webhook_endpoints, venue_online_booking, venues, invitations, guest_blocklist RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

let n = 0;
const freshEmail = () => `limits-${++n}-${Math.random().toString(36).slice(2, 8)}@example.com`;

function headersFor(email: string) {
  const { challenge } = magicLinkChallenges().issue(email);
  return new Headers({ [CHALLENGE_HEADER]: JSON.stringify(challenge), [SOLUTION_HEADER]: solve(challenge) });
}

const askLink = (email: string) => demoAuth.api.signInMagicLink({ body: { email }, headers: headersFor(email) });

/** Asks for a link and opens it, as a visitor does. */
async function signIn(email: string) {
  await askLink(email);
  const text = links.filter((m) => m.to === email).pop()!.text;
  const token = new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
  await demoAuth.api.magicLinkVerify({ query: { token }, headers: new Headers(), asResponse: true });
}

const count_ = async (table: typeof user | typeof demoSandboxes) =>
  (await db.select({ n: count() }).from(table))[0]!.n;

async function makeUser(email: string, verified = true) {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name: "V", email, emailVerified: verified, createdAt: new Date(), updatedAt: new Date() });
  return { id, email };
}

describe("one spelling of an address (decision 8b)", () => {
  it("folds Gmail spellings, Unicode, a trailing dot and IDN domains to one value", () => {
    const spellings = ["ana.garcia@gmail.com", "AnaGarcia+demo@gmail.com", "a.n.a.g.a.r.c.i.a@googlemail.com", " ana.garcia+x@GMAIL.com. "];
    expect(new Set(spellings.map(normalizeEmail))).toEqual(new Set(["anagarcia@gmail.com"]));
    expect(normalizeEmail("bob@bücher.de")).toBe(normalizeEmail("BOB@xn--bcher-kva.de"));
    expect(normalizeEmail("bob@example.com.")).toBe("bob@example.com");
    expect(normalizeEmail("bob@example..com")).toBeNull();
    expect(normalizeEmail("bob@localhost")).toBeNull();
  });
});

describe("one sandbox per person (decision 8b)", () => {
  it("gives variants of one Gmail address one sandbox and one account", async () => {
    await signIn("jane.doe@gmail.com");
    for (const variant of ["janedoe@gmail.com", "jane.doe+2@gmail.com", "JANEDOE@googlemail.com", "j.a.n.e.d.o.e+x@gmail.com"]) {
      await expect(askLink(variant)).rejects.toMatchObject({ body: { code: "DEMO_ADDRESS_IN_USE" } });
    }
    expect(await count_(demoSandboxes)).toBe(1);
    expect(await count_(user)).toBe(1);
  });

  it("makes one sandbox when sign-ins for two spellings run at once", async () => {
    const results = await Promise.allSettled([signIn("racer.one@gmail.com"), signIn("racerone+b@gmail.com")]);
    expect(results.length).toBe(2);
    expect(await count_(demoSandboxes)).toBe(1);
    // The loser leaves no account behind, so it cannot be farmed later.
    expect(await count_(user)).toBe(1);
  });

  it("holds when two accounts of one person already exist and are provisioned together", async () => {
    const a = await makeUser("twin@gmail.com");
    const b = await makeUser("t.w.i.n+2@googlemail.com");
    const settled = await Promise.allSettled([provisionSandbox(db, a.id), provisionSandbox(db, b.id)]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count_(demoSandboxes)).toBe(1);
  });
});

describe("caps (decision 8c)", () => {
  it("refuses a new visitor at the cap but still lets a returning one in, and frees a place on expiry", async () => {
    vi.stubEnv("DEMO_MAX_SANDBOXES", "1");
    const regular = freshEmail();
    await signIn(regular);
    // New visitor: the demo is full, and no account is made for them.
    await expect(askLink(freshEmail())).rejects.toMatchObject({ body: { code: "DEMO_FULL" } });
    expect(await count_(user)).toBe(1);
    // The returning visitor asks for a link, opens it and lands in the same sandbox.
    const [before] = await db.select().from(demoSandboxes);
    await signIn(regular);
    const after = await db.select().from(demoSandboxes);
    expect(after).toHaveLength(1);
    expect(after[0]!.venueId).toBe(before!.venueId);

    await db.update(demoSandboxes).set({ lastSignInAt: new Date(Date.now() - 30 * 864e5) });
    await cleanupExpiredSandboxes(db);
    await signIn(freshEmail());
    expect(await count_(demoSandboxes)).toBe(1);
  });

  it("applies the daily cap to new visitors only", async () => {
    vi.stubEnv("DEMO_MAX_NEW_PER_DAY", "1");
    const regular = freshEmail();
    await signIn(regular);
    await expect(askLink(freshEmail())).rejects.toMatchObject({ body: { code: "DEMO_FULL" } });
    await expect(signIn(regular)).resolves.toBeUndefined();
  });

  it("rejects a cap that is not a positive integer at startup", () => {
    expect(() => demoSettings({ DEMO_MODE: "1", DEMO_MAX_SANDBOXES: "0" })).toThrow(/DEMO_MAX_SANDBOXES/);
    expect(() => demoSettings({ DEMO_MODE: "1", DEMO_MAX_NEW_PER_DAY: "many" })).toThrow(/DEMO_MAX_NEW_PER_DAY/);
    // Off: the variables are not read.
    expect(() => demoSettings({ DEMO_MAX_SANDBOXES: "0" })).not.toThrow();
  });
});

describe("disposable domains (decision 8b)", () => {
  it("refuses listed domains, their subdomains, other spellings and a trailing dot", () => {
    for (const email of [
      "a@mailinator.com",
      "a@MAILINATOR.COM",
      "a@sub.mailinator.com",
      "a@deep.sub.yopmail.com",
      "a@mailinator.com.",
      "a@tempmail.com",
      "a@33mail.com",
    ]) {
      expect(isDisposableEmail(email), email).toBe(true);
    }
  });

  it("refuses much more than the old short list, and lets real providers and look-alikes through", () => {
    const sample = ["0-mail.com", "000-webmail.myhome-server.de"];
    for (const domain of sample) expect(isDisposableEmail(`a@${domain}`), domain).toBe(true);
    for (const email of ["a@gmail.com", "a@outlook.com", "a@icloud.com", "a@proton.me", "a@example.com", "a@notadisposable.example","a@mailinator.com.example.org"]) {
      expect(isDisposableEmail(email), email).toBe(false);
    }
  });

  it("is refused before a link is sent, with no challenge spent on the address", async () => {
    await expect(askLink("someone@x.mailinator.com")).rejects.toMatchObject({ body: { code: "DISPOSABLE_EMAIL" } });
    expect(links).toHaveLength(0);
    expect(await count_(user)).toBe(0);
  });
});

describe("mail leaves only to the sandbox owner (decision 8d)", () => {
  const ahead = (days: number) => addDays(localDateTime(new Date(), DEMO_TEMPLATE.venue.timezone).date, days);

  async function sandbox() {
    const owner = freshEmail();
    const account = await makeUser(owner);
    const { venueId, bookingKey } = await provisionSandbox(db, account.id);
    // A visitor can store their own sender and key. Neither is used (audit F12).
    await setConfig(db, venueId, { resendApiKey: "re_visitor", fromEmail: "visitor@evil.test" });
    return { owner, account, venueId, bookingKey: bookingKey! };
  }

  /** What the widget does: a public booking with the guest's contact. */
  async function widgetBooking(bookingKey: string, contact: string, time = "21:00") {
    const challenge = issueChallenge(challengeConfig, bookingKey, Date.now() - 10_000);
    const res = await app.request(`/v1/public/${bookingKey}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        date: ahead(30),
        time,
        partySize: 2,
        guest: { name: "Guest", contact },
        challenge,
        solution: solve(challenge),
      }),
    });
    expect(res.status).toBe(200);
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  it("sends a booking confirmation only to the owner's verified address, with the operator's sender", async () => {
    const { owner, bookingKey } = await sandbox();
    await widgetBooking(bookingKey, "stranger@example.org");
    await widgetBooking(bookingKey, owner, "22:00");
    await settle();
    // The stranger's confirmation is dropped. What remains is the owner's own confirmation and the booking notices,
    // which go to the owner's address.
    expect(mail.sent).toHaveLength(3);
    expect(new Set(mail.sent.map((m) => m.to))).toEqual(new Set([owner]));
    for (const m of mail.sent) expect(m).toMatchObject({ key: "", from: "" });
  });

  it("sends the booking notice only to the owner when the visitor points it at someone else", async () => {
    const { owner, venueId } = await sandbox();
    await setConfig(db, venueId, { noticeAddress: "boss@example.org" });
    const booked = await createReservation(db, venueId, { date: ahead(20), time: "21:00", partySize: 2, guestName: "G", guestContact: "g@example.org" }, "k1");
    if (!booked.ok) throw new Error("setup failed");
    await notifyReservation(db, venueId, booked.id, booked.version, "notice");
    expect(mail.sent).toEqual([]);
    await setConfig(db, venueId, { noticeAddress: owner });
    await notifyReservation(db, venueId, booked.id, booked.version, "notice");
    expect(mail.sent.map((m) => m.to)).toEqual([owner]);
  });

  it("answers the lost-link form the same, and mails the links only to the owner", async () => {
    const { owner, venueId, bookingKey } = await sandbox();
    for (const [i, contact] of ["stranger@example.org", owner].entries()) {
      await createReservation(db, venueId, { date: ahead(25), time: `2${i}:00`, partySize: 2, guestName: "G", guestContact: contact }, `lost-${i}`);
    }
    mail.sent.length = 0;
    for (const email of ["stranger@example.org", owner]) {
      const res = await app.request(`/v1/public/${bookingKey}/self-service/resend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(res.status).toBe(202);
    }
    await settle();
    expect(mail.sent.map((m) => m.to)).toEqual([owner]);
    expect((await db.select({ n: count() }).from(selfServiceLinks))[0]!.n).toBeGreaterThan(0);
  });

  it("does not reach another admin of the sandbox, who is not its owner", async () => {
    const { owner, venueId } = await sandbox();
    const guest = await makeUser(freshEmail());
    await db.insert(venueMemberships).values({ venueId, userId: guest.id, role: "admin" });
    expect(await mayEmail(db, venueId, owner)).toBe(true);
    expect(await mayEmail(db, venueId, ` ${owner.toUpperCase()} `)).toBe(true);
    expect(await mayEmail(db, venueId, guest.email)).toBe(false);
    expect(await mayEmail(db, venueId, `${owner},${guest.email}`)).toBe(false);
  });

  it("does not reach an owner whose address is not verified", async () => {
    const { owner, account, venueId } = await sandbox();
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, account.id));
    expect(await mayEmail(db, venueId, owner)).toBe(false);
  });

  it("posts no webhook from a sandbox, and switches off an endpoint that got there some other way", async () => {
    const { venueId } = await sandbox();
    await db.insert(webhookEndpoints).values({ id: "w1", venueId, url: "https://hooks.example.com/x", secret: "s", lastEventId: 0 });
    await createReservation(db, venueId, { date: ahead(10), time: "21:00", partySize: 2, guestName: "G", guestContact: "g@example.org" }, "wh1");
    const posted: unknown[] = [];
    await runWebhookDeliveries(db, {
      allowInsecure: true,
      resolveHost: async () => [{ address: "203.0.113.9", family: 4 }],
      fetch: async (request) => {
        posted.push(request);
        return { status: 200 };
      },
      now: () => new Date(Date.now() + 3_600_000),
    });
    expect(posted).toEqual([]);
    expect((await db.select().from(webhookEndpoints))[0]!.enabled).toBe(false);
  });
});

describe("demo off", () => {
  it("leaves a self-hosted instance alone: no sandbox rows, mail goes where the venue sends it", async () => {
    vi.stubEnv("DEMO_MODE", "0");
    vi.stubEnv("DEMO_MAX_SANDBOXES", "not a number");
    expect(demoSettings({}).enabled).toBe(false);
    expect(await count_(demoSandboxes)).toBe(0);
    // No sandbox row for the venue, so the owner-only rule does not apply.
    expect(await mayEmail(db, "any-real-venue", "anyone@example.org")).toBe(true);
  });
});
