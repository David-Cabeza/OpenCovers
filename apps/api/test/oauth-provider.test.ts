import { createHash, randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MCP_REMOTE = "on";
  process.env.BETTER_AUTH_SECRET = "oauth-provider-test-secret-0123456789";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { oauthAccessToken, oauthClient, oauthRefreshToken, user } from "../src/db/schema";
import { demoSettings } from "../src/demo/settings";
import { auth, createAuth, metadataFetcher } from "../src/lib/auth";
import { MCP_SCOPES } from "../src/lib/mcp-remote";

const ORIGIN = "http://localhost:3000";
const ISSUER = `${ORIGIN}/api/auth`;
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://agent.example.com/callback";

type Handler = (request: Request) => Promise<Response>;
const appHandler: Handler = async (request) => app.fetch(request);

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

/** Gives the cookie's account the first-user mark, which makes it the instance owner. */
async function makeOwner(cookie: string): Promise<void> {
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  await db.update(user).set({ firstSignup: false });
  await db.update(user).set({ firstSignup: true }).where(eq(user.id, session!.user.id));
}

function createClient(cookie: string, extra: Record<string, unknown> = {}) {
  return auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: {
      client_name: "Test agent",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...extra,
    },
  });
}

async function registerClient(cookie: string): Promise<string> {
  await makeOwner(cookie);
  return (await createClient(cookie)).client_id;
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

  it.each([
    ["POST", "/oauth2/register"],
    ["POST", "/oauth2/create-client"],
    ["GET", "/oauth2/get-client?client_id=x"],
    ["GET", "/oauth2/get-clients"],
    ["POST", "/oauth2/update-client"],
    ["POST", "/oauth2/client/rotate-secret"],
    ["POST", "/oauth2/delete-client"],
    ["GET", "/oauth2/get-consent?id=x"],
    ["GET", "/oauth2/get-consents"],
    ["POST", "/oauth2/update-consent"],
    ["POST", "/oauth2/delete-consent"],
  ])("keeps client and consent management off the HTTP surface: %s %s is 404 for an owner", async (method, path) => {
    const cookie = await staffCookie();
    await makeOwner(cookie);
    const res = await app.request(`/api/auth${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({ redirect_uris: [REDIRECT], client_id: "x", id: "x" }),
    });
    // The closed-path answer, not the plugin's own 404 for an unknown id.
    expect([res.status, await res.text()]).toEqual([404, "Not Found"]);
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

  it("(a) accepts offline_access and issues a refresh token that works", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { status, body } = await grantTokens(appHandler, cookie, clientId, "opencovers:read offline_access");
    expect(status).toBe(200);
    expect(body.refresh_token).toEqual(expect.any(String));
    expect((await accessRow(body.access_token)).scopes).toEqual(["opencovers:read", "offline_access"]);
    const refreshed = await token(appHandler, {
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toEqual(expect.any(String));
  });

  it("(b) a reused rotated refresh token revokes every token the client holds for that person", async () => {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const first = await grantTokens(appHandler, cookie, clientId, "opencovers:read offline_access");
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).toEqual(expect.any(String));
    expect((await refreshRow(first.body.refresh_token)).expiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600_000,
    );

    const rotated = await token(appHandler, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);

    const secondGrant = await grantTokens(appHandler, cookie, clientId, "opencovers:read offline_access");
    expect(secondGrant.status).toBe(200);

    const reuse = await token(appHandler, {
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("invalid_grant");

    const afterReuse = await token(appHandler, {
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
    const first = await grantTokens(appHandler, cookie, clientId, "opencovers:read offline_access");
    await db
      .update(oauthRefreshToken)
      .set({ createdAt: new Date(Date.now() - 89 * 24 * 3600_000) })
      .where(eq(oauthRefreshToken.token, sha256Base64url(first.body.refresh_token)));
    const rotated = await token(appHandler, {
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

  it.each(["opencovers:admin", "openid", "opencovers:read profile"])(
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

describe("authorization code lifetime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function exchangeAfter(ms: number) {
    const cookie = await staffCookie();
    const clientId = await registerClient(cookie);
    const { verifier, challenge } = pkce();
    const redirect = await codeFor(appHandler, cookie, clientId, "opencovers:read", challenge);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + ms);
    const result = await token(appHandler, {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: clientId,
      resource: RESOURCE,
    });
    vi.restoreAllMocks();
    return result;
  }

  it("redeems a code just under 10 minutes old and refuses one just over", async () => {
    expect((await exchangeAfter(9 * 60_000 + 50_000)).status).toBe(200);
    const late = await exchangeAfter(10 * 60_000 + 10_000);
    expect(late.status).toBe(400);
    expect(late.body.error).toBe("invalid_grant");
  });
});

describe("client registration (ADR-0014)", () => {
  async function clientRows() {
    return (await db.select({ id: oauthClient.id }).from(oauthClient)).length;
  }

  it("refuses a signed-in person who is not the instance owner", async () => {
    const cookie = await staffCookie();
    await expect(createClient(cookie)).rejects.toMatchObject({ statusCode: 401 });
    expect(await clientRows()).toBe(0);
  });

  it.each([{ skip_consent: true }, { require_pkce: false }])("refuses the owner a client with %o", async (extra) => {
    const cookie = await staffCookie();
    await makeOwner(cookie);
    await expect(createClient(cookie, extra)).rejects.toMatchObject({
      statusCode: 400,
      body: { error: "invalid_client_metadata" },
    });
    expect(await clientRows()).toBe(0);
  });

  it.each([
    ["oauth_client_require_pkce", sql`false`, sql`null`],
    ["oauth_client_no_skip_consent", sql`null`, sql`true`],
  ])("the database refuses a client row that breaks %s", async (constraint, requirePkce, skipConsent) => {
    const insert = db.execute(
      sql`INSERT INTO oauth_client (id, client_id, redirect_uris, require_pkce, skip_consent)
          VALUES ('c1', 'c1', ARRAY['https://agent.example.com/callback'], ${requirePkce}, ${skipConsent})`,
    );
    await expect(insert).rejects.toMatchObject({ cause: { constraint } });
    expect(await clientRows()).toBe(0);
  });
});

describe("client metadata documents", () => {
  const CIMD_REDIRECT = "https://agent.example.com/callback";

  /** An auth whose metadata fetches never leave the process: every URL serves a valid document. */
  function stubbedAuth() {
    const fetched: string[] = [];
    const instance = createAuth(demoSettings({}), {
      fetchMetadata: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        fetched.push(url);
        const document = { client_id: url, client_name: "Agent", redirect_uris: [CIMD_REDIRECT], token_endpoint_auth_method: "none" };
        return new Response(JSON.stringify(document), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    return { handler: (request: Request) => instance.handler(request), fetched };
  }

  function cimdAuthorize(clientId: string, cookie?: string) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CIMD_REDIRECT,
      scope: "opencovers:read",
      state: "s",
      resource: RESOURCE,
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
    });
    return new Request(`${ORIGIN}/api/auth/oauth2/authorize?${params}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
  }

  async function cimdRows() {
    return (await db.select({ id: oauthClient.id }).from(oauthClient).where(eq(oauthClient.clientDiscoveryId, "cimd")))
      .length;
  }

  it("sends 30 anonymous authorization requests to sign in, with no fetch and no client row", async () => {
    const { handler, fetched } = stubbedAuth();
    for (let i = 0; i < 30; i++) {
      const res = await handler(cimdAuthorize(`https://agent${i}.example/client.json`));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!, ORIGIN);
      expect(location.pathname).toBe("/");
      expect(location.searchParams.get("client_id")).toBe(`https://agent${i}.example/client.json`);
    }
    expect(fetched).toEqual([]);
    expect(await cimdRows()).toBe(0);
  });

  it("writes no client row for an anonymous token or revoke request that names a new document", async () => {
    const { handler, fetched } = stubbedAuth();
    for (const path of ["token", "revoke"]) {
      const res = await handler(
        new Request(`${ORIGIN}/api/auth/oauth2/${path}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: "x",
            code_verifier: "x".repeat(43),
            redirect_uri: CIMD_REDIRECT,
            client_id: "https://agent.example/client.json",
            token: "x",
          }),
        }),
      );
      expect(res.status, path).toBeGreaterThanOrEqual(400);
    }
    expect(fetched).toEqual([]);
    expect(await cimdRows()).toBe(0);
  });

  it("keeps the fetch budget for people: after 121 anonymous requests a signed-in one still reaches consent", async () => {
    const { handler, fetched } = stubbedAuth();
    for (let i = 0; i < 121; i++) await handler(cimdAuthorize(`https://flood${i}.example/c`));
    const cookie = await staffCookie();
    const res = await handler(cimdAuthorize("https://agent.example/client.json", cookie));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!, ORIGIN).pathname).toBe("/oauth/consent");
    expect(fetched).toEqual(["https://agent.example/client.json"]);
    expect(await cimdRows()).toBe(1);
  });

  it("the metadata transport refuses a name that resolves to loopback, before any connection", async () => {
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen({ port: 0, host: "::" }, resolve));
    const { port } = server.address() as { port: number };
    try {
      await expect(metadataFetcher(`https://localhost:${port}/client.json`)).rejects.toThrow();
      expect(sockets).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
