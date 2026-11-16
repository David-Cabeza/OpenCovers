import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RULES,
  createRateLimiter,
  describeRateLimit,
  rateLimitConfigFromEnv,
  type RateLimitOptions,
} from "../src/lib/rate-limit";

type Env = Record<string, string | undefined>;

function build(env: Env = {}, options: RateLimitOptions = {}) {
  const limiter = createRateLimiter(rateLimitConfigFromEnv({ RATE_LIMIT: "on", ...env }), options);
  const app = new Hono();
  app.use("*", limiter.middleware);
  app.all("*", (c) => c.json({ ok: true }));
  return { app, limiter };
}

interface Call {
  ip?: string;
  socket?: string;
  headers?: Record<string, string>;
}

function call(app: Hono, method: string, path: string, opts: Call = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return app.request(path, { method, headers }, {
    incoming: { socket: { remoteAddress: opts.socket ?? "10.0.0.1" } },
  });
}

async function statuses(n: number, fn: (i: number) => Promise<Response>) {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push((await fn(i)).status);
  return out;
}

const SIGN_IN = "/api/auth/sign-in/email";
const SIGN_UP = "/api/auth/sign-up/email";
const REDEEM = "/v1/invitations/redeem";
const TRUST = { TRUST_PROXY: "true" };

describe("rateLimitConfigFromEnv", () => {
  it("is off by default outside production, so local development needs no setting", () => {
    expect(rateLimitConfigFromEnv({}).enabled).toBe(false);
    expect(rateLimitConfigFromEnv({ NODE_ENV: "development" }).enabled).toBe(false);
    expect(rateLimitConfigFromEnv({ NODE_ENV: "test" }).enabled).toBe(false);
  });

  it("is on by default when NODE_ENV is production, with safe defaults and no proxy trust", () => {
    const config = rateLimitConfigFromEnv({ NODE_ENV: "production" });
    expect(config.enabled).toBe(true);
    expect(config.trustProxy).toBe(false);
    expect(config.rules).toEqual(DEFAULT_RULES);
  });

  it("lets RATE_LIMIT win over NODE_ENV in both directions", () => {
    expect(rateLimitConfigFromEnv({ NODE_ENV: "production", RATE_LIMIT: "off" }).enabled).toBe(false);
    expect(rateLimitConfigFromEnv({ NODE_ENV: "development", RATE_LIMIT: "on" }).enabled).toBe(true);
    expect(rateLimitConfigFromEnv({ RATE_LIMIT: "on" }).enabled).toBe(true);
  });

  it("treats an empty RATE_LIMIT as unset", () => {
    expect(rateLimitConfigFromEnv({ NODE_ENV: "production", RATE_LIMIT: "" }).enabled).toBe(true);
    expect(rateLimitConfigFromEnv({ RATE_LIMIT: "" }).enabled).toBe(false);
  });

  it("states in one line whether limits are on or off and why", () => {
    const line = (env: Env) => describeRateLimit(rateLimitConfigFromEnv(env), env);
    expect(line({})).toMatch(/off.*NODE_ENV.*production/i);
    expect(line({ NODE_ENV: "production" })).toMatch(/on.*NODE_ENV=production/i);
    expect(line({ RATE_LIMIT: "off", NODE_ENV: "production" })).toMatch(/off.*RATE_LIMIT=off/);
    expect(line({ RATE_LIMIT: "on" })).toMatch(/on.*RATE_LIMIT=on/);
    expect(line({})).not.toContain("\n");
  });

  it("documents these defaults, so changing one is a deliberate act", () => {
    expect(DEFAULT_RULES).toEqual({
      auth: { max: 30, windowMs: 15 * 60_000 },
      signup: { max: 5, windowMs: 60 * 60_000 },
      invitation: { max: 10, windowMs: 15 * 60_000 },
    });
  });

  it("treats empty values as unset", () => {
    const config = rateLimitConfigFromEnv({
      NODE_ENV: "production",
      RATE_LIMIT: "",
      TRUST_PROXY: "",
      RATE_LIMIT_AUTH: "",
    });
    expect(config.enabled).toBe(true);
    expect(config.trustProxy).toBe(false);
    expect(config.rules.auth).toEqual(DEFAULT_RULES.auth);
  });

  it("switches off and on", () => {
    expect(rateLimitConfigFromEnv({ RATE_LIMIT: "off" }).enabled).toBe(false);
    expect(rateLimitConfigFromEnv({ RATE_LIMIT: "on" }).enabled).toBe(true);
  });

  it("reads a rule as max over a window in seconds, minutes or hours", () => {
    const config = rateLimitConfigFromEnv({
      RATE_LIMIT_AUTH: "3/10s",
      RATE_LIMIT_SIGNUP: "7/2h",
      RATE_LIMIT_INVITATION: "12/30m",
    });
    expect(config.rules.auth).toEqual({ max: 3, windowMs: 10_000 });
    expect(config.rules.signup).toEqual({ max: 7, windowMs: 7_200_000 });
    expect(config.rules.invitation).toEqual({ max: 12, windowMs: 1_800_000 });
  });

  it("reads TRUST_PROXY", () => {
    expect(rateLimitConfigFromEnv({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(rateLimitConfigFromEnv({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
  });

  it("rejects values it does not understand instead of falling back", () => {
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT: "OFF" })).toThrow(/RATE_LIMIT/);
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT: "false" })).toThrow(/RATE_LIMIT/);
    expect(() => rateLimitConfigFromEnv({ TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
    for (const bad of ["10", "0/1m", "-1/1m", "1.5/1m", "10/0m", "10/1d", "10/m", "x/1m", "10/1m/2"]) {
      expect(() => rateLimitConfigFromEnv({ RATE_LIMIT_AUTH: bad })).toThrow(/RATE_LIMIT_AUTH/);
    }
  });
});

describe("limits trigger and reset", () => {
  it("answers 429 with a Retry-After and the error shape once the limit is spent", async () => {
    let now = 1_000_000;
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "3/1m" }, { now: () => now });
    expect(await statuses(3, () => call(app, "POST", SIGN_IN, { ip: "203.0.113.1" }))).toEqual([200, 200, 200]);

    now += 20_000;
    const res = await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("40");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ code: "rate_limited", message: expect.any(String), retryable: true });
  });

  it("lets requests through again when the window has passed", async () => {
    let now = 5_000;
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "2/10s" }, { now: () => now });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(429);

    now += 9_999;
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(429);
    now += 1;
    expect(await statuses(3, () => call(app, "POST", SIGN_IN, { ip: "203.0.113.1" }))).toEqual([200, 200, 429]);
  });

  it("does not extend the window for a caller that keeps hitting the limit", async () => {
    let now = 0;
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/10s" }, { now: () => now });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    for (let i = 0; i < 9; i += 1) {
      now += 1_000;
      expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(429);
    }
    now += 1_000;
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(200);
  });

  it("reports the longest wait when two budgets are spent at once", async () => {
    let now = 0;
    const { app } = build(
      { ...TRUST, RATE_LIMIT_SIGNUP: "1/10s", RATE_LIMIT_INVITATION: "1/60s" },
      { now: () => now },
    );
    const headers = { "x-invitation-token": "abc.def" };
    await call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers });
    now = 1_000;
    const res = await call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("59");
  });

  it("rounds Retry-After up to a whole second, never below 1", async () => {
    let now = 0;
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/10s" }, { now: () => now });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    now = 9_900;
    const res = await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    expect(res.headers.get("retry-after")).toBe("1");
  });
});

describe("keys", () => {
  it("keeps one client address from spending another's budget", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "2/1m" });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(429);
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.2" })).status).toBe(200);
  });

  it("keeps the rules separate for the same address", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/1m", RATE_LIMIT_SIGNUP: "1/1m" });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    expect((await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" })).status).toBe(429);
    expect((await call(app, "POST", SIGN_UP, { ip: "203.0.113.1" })).status).toBe(200);
  });

  it("uses the last X-Forwarded-For entry, so a client cannot pick its own key", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "2/1m" });
    const out = await statuses(4, (i) =>
      call(app, "POST", SIGN_IN, { ip: `10.9.9.${i}, 203.0.113.9` }),
    );
    expect(out).toEqual([200, 200, 429, 429]);
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    const warn = vi.fn();
    const { app } = build({ RATE_LIMIT_AUTH: "2/1m" }, { warn });
    const out = await statuses(4, (i) =>
      call(app, "POST", SIGN_IN, { ip: `198.51.100.${i}`, socket: "172.18.0.5" }),
    );
    expect(out).toEqual([200, 200, 429, 429]);
    expect((await call(app, "POST", SIGN_IN, { socket: "172.18.0.6" })).status).toBe(200);
  });

  it("warns once when a forwarded header arrives and the proxy is not trusted", async () => {
    const warn = vi.fn();
    const { app } = build({}, { warn });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.1" });
    await call(app, "POST", SIGN_IN, { ip: "203.0.113.2" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TRUST_PROXY/);
  });

  it("falls back to the socket address when a trusted proxy sends no usable header", async () => {
    const warn = vi.fn();
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/1m" }, { warn });
    expect((await call(app, "POST", SIGN_IN, { socket: "172.18.0.5" })).status).toBe(200);
    expect((await call(app, "POST", SIGN_IN, { socket: "172.18.0.5", ip: "not-an-ip" })).status).toBe(429);
    expect((await call(app, "POST", SIGN_IN, { socket: "172.18.0.6" })).status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TRUST_PROXY/);
  });

  it("groups an IPv6 client by its /64 and reads an IPv4-mapped address as IPv4", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "2/1m" });
    const out = await statuses(4, (i) =>
      call(app, "POST", SIGN_IN, { ip: `2001:db8:1:2:${i}::${i + 1}` }),
    );
    expect(out).toEqual([200, 200, 429, 429]);
    expect((await call(app, "POST", SIGN_IN, { ip: "2001:db8:1:3::1" })).status).toBe(200);

    const { app: mapped } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/1m" });
    await call(mapped, "POST", SIGN_IN, { ip: "203.0.113.7" });
    expect((await call(mapped, "POST", SIGN_IN, { ip: "::ffff:203.0.113.7" })).status).toBe(429);
  });

  it("bounds its memory, dropping the oldest keys first", async () => {
    const { app, limiter } = build({ ...TRUST }, { maxKeys: 10 });
    for (let i = 0; i < 50; i += 1) {
      await call(app, "POST", SIGN_IN, { ip: `203.0.113.${i}` });
    }
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  it("drops expired keys before it drops live ones", async () => {
    let now = 0;
    const { app, limiter } = build({ ...TRUST, RATE_LIMIT_AUTH: "5/10s" }, { maxKeys: 10, now: () => now });
    for (let i = 0; i < 10; i += 1) await call(app, "POST", SIGN_IN, { ip: `203.0.113.${i}` });
    now = 11_000;
    for (let i = 100; i < 105; i += 1) await call(app, "POST", SIGN_IN, { ip: `203.0.113.${i}` });
    expect(limiter.size()).toBe(5);
  });
});

describe("what is limited", () => {
  it("limits every state-changing call under /api/auth, with sign-up on its own budget", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "2/1m", RATE_LIMIT_SIGNUP: "1/1m" });
    const paths = [SIGN_IN, "/api/auth/sign-out", "/api/auth/change-password"];
    for (const [i, path] of paths.entries()) {
      const out = await statuses(3, () => call(app, "POST", path, { ip: `203.0.113.${100 + i}` }));
      expect(out, path).toEqual([200, 200, 429]);
    }
    expect(await statuses(2, () => call(app, "POST", SIGN_UP, { ip: "203.0.113.200" }))).toEqual([200, 429]);
  });

  it("matches sign-up and redeem however the path is written", async () => {
    const { app } = build({
      ...TRUST,
      RATE_LIMIT_SIGNUP: "1/1m",
      RATE_LIMIT_INVITATION: "1/1m",
      RATE_LIMIT_AUTH: "100/1m",
    });
    expect((await call(app, "POST", SIGN_UP, { ip: "203.0.113.1" })).status).toBe(200);
    for (const variant of [`${SIGN_UP}/`, "/api/auth//sign-up/email", "/api/auth/sign-up/email//"]) {
      expect((await call(app, "POST", variant, { ip: "203.0.113.1" })).status, variant).toBe(429);
    }
    expect((await call(app, "POST", REDEEM, { ip: "203.0.113.2" })).status).toBe(200);
    for (const variant of [`${REDEEM}/`, "/v1//invitations/redeem", "/v1/invitations/%72edeem"]) {
      expect((await call(app, "POST", variant, { ip: "203.0.113.2" })).status, variant).toBe(429);
    }
  });

  it("limits an unknown state-changing path under /api/auth rather than letting it through", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/1m", RATE_LIMIT_SIGNUP: "100/1m" });
    expect((await call(app, "DELETE", "/api/auth/some/new/endpoint", { ip: "203.0.113.1" })).status).toBe(200);
    expect((await call(app, "PUT", "/api/auth/another", { ip: "203.0.113.1" })).status).toBe(429);
    expect((await call(app, "POST", "/api/auth", { ip: "203.0.113.1" })).status).toBe(429);
  });

  it("limits invitation redemption, also with a trailing slash", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_INVITATION: "2/1m" });
    expect(await statuses(2, () => call(app, "POST", REDEEM, { ip: "203.0.113.1" }))).toEqual([200, 200]);
    expect((await call(app, "POST", REDEEM, { ip: "203.0.113.1" })).status).toBe(429);
    expect((await call(app, "POST", `${REDEEM}/`, { ip: "203.0.113.1" })).status).toBe(429);
  });

  it("counts a sign-up that carries an invitation token on the invitation budget too", async () => {
    const { app } = build({
      ...TRUST,
      RATE_LIMIT_INVITATION: "2/1m",
      RATE_LIMIT_SIGNUP: "100/1m",
    });
    const headers = { "x-invitation-token": "abc.def" };
    expect(await statuses(2, () => call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers }))).toEqual([200, 200]);
    expect((await call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers })).status).toBe(429);
    expect((await call(app, "POST", SIGN_UP, { ip: "203.0.113.1" })).status).toBe(200);
    expect((await call(app, "POST", REDEEM, { ip: "203.0.113.1" })).status).toBe(429);
  });

  it("does not spend the sign-up budget on a request the invitation budget refused", async () => {
    const { app } = build({
      ...TRUST,
      RATE_LIMIT_INVITATION: "1/1m",
      RATE_LIMIT_SIGNUP: "2/1m",
    });
    const headers = { "x-invitation-token": "abc.def" };
    await call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers });
    for (let i = 0; i < 5; i += 1) await call(app, "POST", SIGN_UP, { ip: "203.0.113.1", headers });
    expect((await call(app, "POST", SIGN_UP, { ip: "203.0.113.1" })).status).toBe(200);
  });

  it("answers the same way whatever the request body holds", async () => {
    const { app } = build({ ...TRUST, RATE_LIMIT_AUTH: "1/1m" });
    const send = (body: unknown) =>
      app.request(
        SIGN_IN,
        {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.1", "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
      );
    await send({ email: "exists@example.com", password: "right" });
    const known = await send({ email: "exists@example.com", password: "wrong" });
    const unknown = await send({ email: "nobody@example.com", password: "wrong" });
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(await known.text()).toBe(await unknown.text());
    expect(known.headers.get("retry-after")).toBe(unknown.headers.get("retry-after"));
  });

  it("never limits reads, health, preflights or the other routes", async () => {
    const { app } = build({
      ...TRUST,
      RATE_LIMIT_AUTH: "1/1m",
      RATE_LIMIT_SIGNUP: "1/1m",
      RATE_LIMIT_INVITATION: "1/1m",
    });
    const probes: Array<[string, string]> = [
      ["GET", "/health"],
      ["GET", "/api/auth/get-session"],
      ["HEAD", "/api/auth/get-session"],
      ["OPTIONS", SIGN_IN],
      ["GET", REDEEM],
      ["GET", "/v1/venues"],
      ["GET", "/v1/venues/v1/availability?date=2026-01-01&partySize=2"],
      ["POST", "/v1/venues"],
      ["POST", "/v1/venues/v1/reservations"],
      ["DELETE", "/v1/venues/v1/webhooks/w1"],
    ];
    for (const [method, path] of probes) {
      const out = await statuses(40, () => call(app, method, path, { ip: "203.0.113.1" }));
      expect(new Set(out), `${method} ${path}`).not.toContain(429);
    }
  });

  it("does nothing when switched off", async () => {
    const { app, limiter } = build({ ...TRUST, RATE_LIMIT: "off", RATE_LIMIT_AUTH: "1/1m" });
    const out = await statuses(20, () => call(app, "POST", SIGN_IN, { ip: "203.0.113.1" }));
    expect(new Set(out)).toEqual(new Set([200]));
    expect(limiter.size()).toBe(0);
  });
});
