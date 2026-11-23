import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { account, user } from "../src/db/schema";
import { createAuth } from "../src/lib/auth";
import { demoSettings } from "../src/demo/settings";

const ORIGIN = "http://localhost:3000";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const google = createAuth(
  demoSettings({ DEMO_MODE: "1", GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" }),
);

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** The ID token Google's token endpoint returns. The code flow decodes it without a signature check. */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "google-sub-1",
    email: "ana@gmail.com",
    email_verified: true,
    name: "Ana García",
    picture: "https://lh3.googleusercontent.com/a/ana",
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  return `${base64url({ alg: "RS256", kid: "test" })}.${base64url(payload)}.signature`;
}

let tokenResponse: Record<string, unknown> = {};

/** Google answers the code exchange with the tokens of `tokenResponse`. Any other request answers `{}`. */
function stubGoogle() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(GOOGLE_TOKEN_ENDPOINT)) {
      return new Response(JSON.stringify(tokenResponse), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
}

function googleTokens(n: number, claims: Record<string, unknown> = {}) {
  tokenResponse = {
    access_token: `ya29.access-${n}`,
    refresh_token: `1//refresh-${n}`,
    id_token: idToken(claims),
    expires_in: 3599,
    scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    token_type: "Bearer",
  };
}

/** The whole browser round trip: start the sign-in, then come back to the callback with Google's code. */
async function signInWithGoogle(): Promise<Response> {
  const start = await google.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", callbackURL: `${ORIGIN}/` }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return google.handler(
    new Request(`${ORIGIN}/api/auth/callback/google?code=auth-code&state=${state}`, { headers: { cookie } }),
  );
}

function signedIn(res: Response): boolean {
  return res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token=") && !c.includes("Max-Age=0"));
}

async function googleAccounts() {
  return db.select().from(account).where(eq(account.providerId, "google"));
}

function expectNoStoredTokens(row: typeof account.$inferSelect) {
  expect({
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    scope: row.scope,
  }).toEqual({
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
  });
}

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  vi.stubEnv("DEMO_MODE", "1");
  stubGoogle();
  await db.execute(
    sql`TRUNCATE TABLE demo_sandbox, account, session, verification, "user", venue_memberships, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, self_service_links, grants, api_keys, services, tables, floor_items, webhook_endpoints, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google sign-in keeps the identity and drops Google's tokens", () => {
  it("creates the account with the identity and no token", async () => {
    googleTokens(1);
    const res = await signInWithGoogle();

    expect(res.status).toBe(302);
    expect(signedIn(res)).toBe(true);
    const [person] = await db.select().from(user);
    expect(person).toMatchObject({
      email: "ana@gmail.com",
      emailVerified: true,
      name: "Ana García",
      image: "https://lh3.googleusercontent.com/a/ana",
    });
    const rows = await googleAccounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "google-sub-1", userId: person!.id });
    expectNoStoredTokens(rows[0]!);
  });

  it("stores no token when the same person signs in again, and clears one an older row held", async () => {
    googleTokens(1);
    expect(signedIn(await signInWithGoogle())).toBe(true);
    // A row written before tokens were dropped.
    await db.update(account).set({
      accessToken: "ya29.old",
      refreshToken: "1//old",
      idToken: "old-id-token",
      accessTokenExpiresAt: new Date(),
      scope: "openid,email,profile",
    }).where(eq(account.providerId, "google"));
    // Google sends no refresh token on a later consent.
    googleTokens(2);
    delete tokenResponse.refresh_token;
    const again = await signInWithGoogle();

    expect(signedIn(again)).toBe(true);
    const rows = await googleAccounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accountId).toBe("google-sub-1");
    expectNoStoredTokens(rows[0]!);
  });

  it("stores no token when Google is linked to an account that signed in by magic link", async () => {
    const [existing] = await db
      .insert(user)
      .values({ id: "magic-user", name: "", email: "ana@gmail.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    googleTokens(1);
    const res = await signInWithGoogle();

    expect(signedIn(res)).toBe(true);
    const rows = await googleAccounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "google-sub-1", userId: existing!.id });
    expectNoStoredTokens(rows[0]!);
  });

  it("still refuses a Google address that is not verified", async () => {
    googleTokens(1, { email_verified: false });
    const res = await signInWithGoogle();

    expect(signedIn(res)).toBe(false);
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await googleAccounts()).toHaveLength(0);
  });
});
