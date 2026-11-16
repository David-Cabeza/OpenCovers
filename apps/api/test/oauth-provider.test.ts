import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MCP_REMOTE = "on";
});

import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { betterAuthSchema, oauthAccessToken, oauthRefreshToken } from "../src/db/schema";
import { auth, oauthProviderOptions } from "../src/lib/auth";
import { MCP_SCOPES } from "../src/lib/mcp-remote";

const ORIGIN = "http://localhost:3000";
const ISSUER = `${ORIGIN}/api/auth`;
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://agent.example.com/callback";

type Handler = (request: Request) => Promise<Response>;
const appHandler: Handler = async (request) => app.fetch(request);

// The same provider settings with `offline_access` added, the scope the plugin
// requires before it issues a refresh token. Used only to observe refresh behavior.
const withOfflineAccess = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: ORIGIN,
  database: drizzleAdapter(db, { provider: "pg", schema: betterAuthSchema }),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: false },
  plugins: [
    oauthProvider({
      ...oauthProviderOptions(RESOURCE),
      scopes: [...MCP_SCOPES, "offline_access"],
    }),
  ],
});
const offlineHandler: Handler = (request) => withOfflineAccess.handler(request);

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE oauth_access_token, oauth_refresh_token, oauth_consent, oauth_client_resource, oauth_client, account, session, verification, "user" RESTART IDENTITY CASCADE`,
  );
});

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function sha256Base64url(value: string): string {
  return base64url(createHash("sha256").update(value).digest());
}

function pkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: sha256Base64url(verifier) };
}

let n = 0;
async function staffCookie(): Promise<string> {
  n += 1;
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `oauth-${n}-${Date.now()}@example.com`, password: "password123" },
    asResponse: true,
  });
  if (!res.ok) throw new Error(`sign-up refused: ${await res.text()}`);
  return res.headers.get("set-cookie")!;
}

async function registerClient(cookie: string): Promise<string> {
  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: {
      client_name: "Test agent",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  return client.client_id;
}

interface AuthorizeInput {
  clientId: string;
  scope: string;
  challenge?: string;
  method?: string;
  resource?: string;
}

function authorizeUrl(input: AuthorizeInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: REDIRECT,
    scope: input.scope,
    state: "state-1",
    resource: input.resource ?? RESOURCE,
  });
  if (input.challenge !== undefined) params.set("code_challenge", input.challenge);
  if (input.method !== undefined) params.set("code_challenge_method", input.method);
  return `${ORIGIN}/api/auth/oauth2/authorize?${params}`;
}

async function authorize(handler: Handler, cookie: string, input: AuthorizeInput): Promise<Response> {
  return handler(new Request(authorizeUrl(input), { headers: { cookie }, redirect: "manual" }));
}

async function approve(handler: Handler, cookie: string, consentLocation: string): Promise<URL> {
  const oauthQuery = new URL(consentLocation, ORIGIN).search.slice(1);
  const res = await handler(
    new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    }),
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`consent refused: ${JSON.stringify(body)}`);
  return new URL(body.url);
}

async function token(handler: Handler, form: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function codeFor(handler: Handler, cookie: string, clientId: string, scope: string, challenge: string) {
  const res = await authorize(handler, cookie, { clientId, scope, challenge, method: "S256" });
  expect(res.status).toBe(302);
  const location = res.headers.get("location")!;
  const redirect = location.startsWith(REDIRECT) ? new URL(location) : await approve(handler, cookie, location);
  return redirect;
}

async function grantTokens(handler: Handler, cookie: string, clientId: string, scope: string) {
  const { verifier, challenge } = pkce();
  const redirect = await codeFor(handler, cookie, clientId, scope, challenge);
  return token(handler, {
    grant_type: "authorization_code",
    code: redirect.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
    client_id: clientId,
    resource: RESOURCE,
  });
}

async function accessRow(raw: string) {
  const rows = await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.token, sha256Base64url(raw)));
  return rows[0];
}

async function refreshRow(raw: string) {
  const rows = await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.token, sha256Base64url(raw)));
  return rows[0];
}

describe("authorization server metadata", () => {
  it("advertises S256 only, iss in the response, client metadata documents, no registration, two scopes", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
    expect(meta.client_id_metadata_document_supported).toBe(true);
    expect(meta.registration_endpoint).toBeUndefined();
    expect(meta.scopes_supported).toEqual([...MCP_SCOPES]);
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });

  it("keeps client and consent management off the HTTP surface", async () => {
    const cookie = await staffCookie();
    for (const path of ["/oauth2/register", "/oauth2/create-client", "/oauth2/get-clients", "/oauth2/get-consents"]) {
      const res = await app.request(`/api/auth${path}`, {
        method: path === "/oauth2/get-clients" || path === "/oauth2/get-consents" ? "GET" : "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: path.startsWith("/oauth2/get") ? undefined : JSON.stringify({ redirect_uris: [REDIRECT] }),
      });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("ADR-0014 must verify", () => {
  it("(a) issues opaque access tokens and stores only their SHA-256 hash", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { status, body } = await grantTokens(appHandler, cookie, clientId, "opencovers:read");
    expect(status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(15 * 60);
    expect(body.access_token.split(".")).toHaveLength(1);

    const row = await accessRow(body.access_token);
    expect(row).toBeDefined();
    expect(row.token).not.toBe(body.access_token);
    expect(row.resources).toEqual([RESOURCE]);
    expect(row.scopes).toEqual(["opencovers:read"]);
    const stored = await db.select({ token: oauthAccessToken.token }).from(oauthAccessToken);
    expect(stored.map((r) => r.token)).not.toContain(body.access_token);
  });

  it("(a) with only the two ADR scopes, the plugin issues no refresh token", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { status, body } = await grantTokens(appHandler, cookie, clientId, "opencovers:read opencovers:write");
    expect(status).toBe(200);
    expect(body.refresh_token).toBeUndefined();
  });

  it("(b) a reused rotated refresh token revokes every token the client holds for that person", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const first = await grantTokens(offlineHandler, cookie, clientId, "opencovers:read offline_access");
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).toEqual(expect.any(String));
    expect((await refreshRow(first.body.refresh_token)).expiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600_000,
    );

    const rotated = await token(offlineHandler, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);

    const secondGrant = await grantTokens(offlineHandler, cookie, clientId, "opencovers:read offline_access");
    expect(secondGrant.status).toBe(200);

    const reuse = await token(offlineHandler, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("invalid_grant");

    const afterReuse = await token(offlineHandler, {
      grant_type: "refresh_token",
      refresh_token: rotated.body.refresh_token,
      client_id: clientId,
    });
    expect(afterReuse.body.error).toBe("invalid_grant");
    expect(await accessRow(first.body.access_token)).toBeUndefined();
    expect(await accessRow(rotated.body.access_token)).toBeUndefined();
    expect(await accessRow(secondGrant.body.access_token)).toBeUndefined();
    expect(await refreshRow(secondGrant.body.refresh_token)).toBeUndefined();
  });

  it("(b) a refresh resets the refresh token to 30 days from now, with no cap from the first consent", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const first = await grantTokens(offlineHandler, cookie, clientId, "opencovers:read offline_access");
    await db
      .update(oauthRefreshToken)
      .set({ createdAt: new Date(Date.now() - 89 * 24 * 3600_000) })
      .where(eq(oauthRefreshToken.token, sha256Base64url(first.body.refresh_token)));
    const rotated = await token(offlineHandler, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });
    expect(rotated.status).toBe(200);
    const row = await refreshRow(rotated.body.refresh_token);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
  });

  it("(c) auth.api.getSession never accepts an OAuth access token", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { body } = await grantTokens(appHandler, cookie, clientId, "opencovers:write");
    expect(await accessRow(body.access_token)).toBeDefined();

    const asBearer = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${body.access_token}` }) });
    expect(asBearer).toBeNull();
    const asCookie = await auth.api.getSession({
      headers: new Headers({ cookie: `better-auth.session_token=${body.access_token}` }),
    });
    expect(asCookie).toBeNull();
    const v1 = await app.request("/v1/venues", { headers: { authorization: `Bearer ${body.access_token}` } });
    expect(v1.status).toBe(401);
  });

  it("(d) the authorization response carries iss equal to the issuer", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { challenge } = pkce();
    const redirect = await codeFor(appHandler, cookie, clientId, "opencovers:read", challenge);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get("code")).toEqual(expect.any(String));
    expect(redirect.searchParams.get("state")).toBe("state-1");
    expect(redirect.searchParams.get("iss")).toBe(ISSUER);
  });

  it("(e) refuses PKCE plain and a missing code challenge", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { verifier } = pkce();
    for (const input of [
      { clientId, scope: "opencovers:read", challenge: verifier, method: "plain" },
      { clientId, scope: "opencovers:read" },
    ]) {
      const res = await authorize(appHandler, cookie, input);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin + location.pathname).toBe(REDIRECT);
      expect(location.searchParams.get("error")).toBe("invalid_request");
      expect(location.searchParams.get("code")).toBeNull();
    }
  });

  it.each(["opencovers:admin", "openid", "offline_access", "opencovers:read profile"])(
    "(f) refuses scope %s with invalid_scope",
    async (scope) => {
      const cookie = await staffCookie();
      const clientId = await registerClient(cookie);
      const { challenge } = pkce();
      const res = await authorize(appHandler, cookie, { clientId, scope, challenge, method: "S256" });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin + location.pathname).toBe(REDIRECT);
      expect(location.searchParams.get("error")).toBe("invalid_scope");
    },
  );
});

describe("plugin defaults that ADR-0014 overrides in part 2", () => {
  it("skips the consent screen when an earlier consent covers the scopes", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    await grantTokens(appHandler, cookie, clientId, "opencovers:read");
    const { challenge } = pkce();
    const again = await authorize(appHandler, cookie, { clientId, scope: "opencovers:read", challenge, method: "S256" });
    expect(new URL(again.headers.get("location")!).searchParams.get("code")).toEqual(expect.any(String));
  });

  it("accepts an authorization request without resource and issues a token with no audience", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { verifier, challenge } = pkce();
    const url = new URL(authorizeUrl({ clientId, scope: "opencovers:read", challenge, method: "S256" }));
    url.searchParams.delete("resource");
    const res = await appHandler(new Request(url, { headers: { cookie } }));
    const redirect = await approve(appHandler, cookie, res.headers.get("location")!);
    const { body } = await token(appHandler, {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: clientId,
    });
    expect((await accessRow(body.access_token)).resources).toBeNull();
  });

  it("refuses a resource other than the MCP endpoint with invalid_target", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { challenge } = pkce();
    const res = await authorize(appHandler, cookie, {
      clientId,
      scope: "opencovers:read",
      challenge,
      method: "S256",
      resource: "https://other.example.com/mcp",
    });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });
});
