import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { demoSandboxes, user, venueOnlineBooking } from "../src/db/schema";
import { createAuth } from "../src/lib/auth";
import { CHALLENGE_HEADER, magicLinkChallenges, SOLUTION_HEADER } from "../src/demo/magic-link-challenge";
import { solve } from "../src/lib/public-challenge";
import { demoSettings, SANDBOX_TTL_DAYS } from "../src/demo/settings";

// The link token is stored hashed (audit F13), so the test reads it from the mail it would have sent.
const sent: { to: string; text: string }[] = [];
const demoAuth = createAuth(demoSettings({ DEMO_MODE: "1" }), {
  sendMail: async (to, _subject, text) => void sent.push({ to, text }),
});

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE demo_lead, demo_sandbox, account, session, verification, "user", venue_memberships, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, self_service_links, grants, api_keys, services, tables, floor_items, webhook_endpoints, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

let n = 0;
const freshEmail = () => `status-${++n}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function signIn(email: string): Promise<string> {
  // A magic link needs a solved challenge for the address (ADR-0022, decision 8a).
  const { challenge } = magicLinkChallenges().issue(email);
  const headers = new Headers({ [CHALLENGE_HEADER]: JSON.stringify(challenge), [SOLUTION_HEADER]: solve(challenge) });
  await demoAuth.api.signInMagicLink({ body: { email }, headers });
  const mail = sent.filter((m) => m.to === email).pop()!;
  const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
  const res = await demoAuth.api.magicLinkVerify({
    query: { token },
    headers: new Headers(),
    asResponse: true,
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const status = (cookie?: string) => app.request("/api/demo/status", { headers: cookie ? { cookie } : {} });

describe("GET /api/demo/status", () => {
  it("says the demo is off, and nothing else, on a normal instance", async () => {
    const res = await status();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, googleEnabled: false });
  });

  it("says the demo is on, and whether Google is set up, to a signed-out visitor", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(await (await status()).json()).toEqual({ enabled: true, googleEnabled: false });
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(await (await status()).json()).toEqual({ enabled: true, googleEnabled: true });
  });

  it("gives a signed-in visitor their own sandbox, its booking key and the day it expires", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const email = freshEmail();
    const cookie = await signIn(email);
    const [sandbox] = await db
      .select({ venueId: demoSandboxes.venueId, lastSignInAt: demoSandboxes.lastSignInAt })
      .from(demoSandboxes)
      .innerJoin(user, eq(user.id, demoSandboxes.userId))
      .where(eq(user.email, email));
    const [online] = await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, sandbox!.venueId));

    const body = await (await status(cookie)).json();
    expect(body).toEqual({
      enabled: true,
      googleEnabled: false,
      venueId: sandbox!.venueId,
      bookingKey: online!.bookingKey,
      expiresAt: new Date(sandbox!.lastSignInAt.getTime() + SANDBOX_TTL_DAYS * 86_400_000).toISOString(),
    });
    expect(body.bookingKey).toMatch(/^pk_/);
  });

  it("never shows one visitor another's sandbox, and no personal data", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const aliceEmail = freshEmail();
    const alice = await signIn(aliceEmail);
    const bob = await signIn(freshEmail());
    const a = await (await status(alice)).json();
    const b = await (await status(bob)).json();
    expect(a.venueId).not.toBe(b.venueId);
    expect(a.bookingKey).not.toBe(b.bookingKey);
    expect(JSON.stringify([a, b])).not.toContain(aliceEmail);
    expect(Object.keys(a).sort()).toEqual(["bookingKey", "enabled", "expiresAt", "googleEnabled", "venueId"]);
  });

  it("treats a cookie that no longer matches a session as signed out", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const res = await status("better-auth.session_token=nope.nope");
    expect(await res.json()).toEqual({ enabled: true, googleEnabled: false });
  });
});
