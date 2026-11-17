import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { isIP } from "node:net";
import { ERRORS, errorBody } from "./errors";

export const RULE_NAMES = [
  "auth",
  "signup",
  "invitation",
  "venue_creation",
  "public_read",
  "public_booking",
  "public_venue",
  "self_service",
] as const;
export type RuleName = (typeof RULE_NAMES)[number];

export interface Rule {
  max: number;
  windowMs: number;
}

export type Rules = Record<RuleName, Rule>;

export const DEFAULT_RULES: Rules = {
  auth: { max: 30, windowMs: 15 * 60_000 },
  signup: { max: 5, windowMs: 60 * 60_000 },
  invitation: { max: 10, windowMs: 15 * 60_000 },
  venue_creation: { max: 10, windowMs: 60 * 60_000 },
  public_read: { max: 300, windowMs: 15 * 60_000 },
  public_booking: { max: 10, windowMs: 60 * 60_000 },
  public_venue: { max: 100, windowMs: 60 * 60_000 },
  self_service: { max: 60, windowMs: 15 * 60_000 },
};

export interface RateLimitConfig {
  enabled: boolean;
  trustProxy: boolean;
  rules: Rules;
}

export interface RateLimitOptions {
  now?: () => number;
  maxKeys?: number;
  warn?: (message: string) => void;
}

const RULE_ENV: Record<RuleName, string> = {
  auth: "RATE_LIMIT_AUTH",
  signup: "RATE_LIMIT_SIGNUP",
  invitation: "RATE_LIMIT_INVITATION",
  venue_creation: "RATE_LIMIT_VENUE_CREATION",
  public_read: "RATE_LIMIT_PUBLIC_READ",
  public_booking: "RATE_LIMIT_PUBLIC_BOOKING",
  public_venue: "RATE_LIMIT_PUBLIC_VENUE",
  self_service: "RATE_LIMIT_PUBLIC_SELF_SERVICE",
};

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

export const INVITATION_HEADER = "x-invitation-token";
const DEFAULT_MAX_KEYS = 10_000;
const SWEEP_EVERY_MS = 1_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Env = Record<string, string | undefined>;

function setting(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function choice<T extends string>(env: Env, name: string, allowed: readonly [T, T], fallback: T): T {
  const value = setting(env, name);
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${name} must be ${allowed[0]} or ${allowed[1]}. Got "${value}".`);
}

function parseRule(name: string, value: string): Rule {
  const match = /^([1-9]\d*)\/([1-9]\d*)([smh])$/.exec(value);
  if (!match) {
    throw new Error(`${name} must look like 30/15m (max requests, a slash, a window in s, m or h). Got "${value}".`);
  }
  const max = Number(match[1]);
  const windowMs = Number(match[2]) * UNIT_MS[match[3] as keyof typeof UNIT_MS];
  if (!Number.isSafeInteger(max) || !Number.isSafeInteger(windowMs)) {
    throw new Error(`${name} is too large. Got "${value}".`);
  }
  return { max, windowMs };
}

export function rateLimitConfigFromEnv(env: Env = process.env): RateLimitConfig {
  const rules = { ...DEFAULT_RULES };
  for (const name of RULE_NAMES) {
    const value = setting(env, RULE_ENV[name]);
    if (value !== undefined) rules[name] = parseRule(RULE_ENV[name], value);
  }
  const fallback = env.NODE_ENV === "production" ? "on" : "off";
  return {
    enabled: choice(env, "RATE_LIMIT", ["on", "off"], fallback) === "on",
    trustProxy: choice(env, "TRUST_PROXY", ["true", "false"], "false") === "true",
    rules,
  };
}

export function describeRateLimit(config: RateLimitConfig, env: Env = process.env): string {
  const state = config.enabled ? "on" : "off";
  const explicit = setting(env, "RATE_LIMIT");
  if (explicit !== undefined) return `rate limits ${state} (RATE_LIMIT=${explicit})`;
  if (config.enabled) return "rate limits on (default, NODE_ENV=production)";
  return "rate limits off (default, NODE_ENV is not production; set NODE_ENV=production or RATE_LIMIT=on to enable)";
}

function normalizePath(path: string): string {
  return path.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

// ADR-0017: the one prefix whose reads are limited, because public availability runs a table search for anyone.
function publicRules(method: string, path: string): RuleName[] {
  const read = method === "GET" || method === "HEAD";
  const rest = path.slice("/v1/public/".length).split("/");
  if (rest[0] === "self-service") return read ? ["public_read", "self_service"] : ["self_service"];
  if (read) return ["public_read"];
  const tail = rest.slice(1).join("/");
  return method === "POST" && (tail === "reservations" || tail === "self-service/resend")
    ? ["public_booking", "public_venue"]
    : [];
}

/** The booking key a `public_venue` budget is kept for. Every other rule is kept per client address. */
function bookingKeyOf(rawPath: string): string {
  return normalizePath(rawPath).slice("/v1/public/".length).split("/")[0] ?? "";
}

export function rulesFor(method: string, rawPath: string, hasInvitationToken: boolean): RuleName[] {
  const path = normalizePath(rawPath);
  if (path.startsWith("/v1/public/")) return publicRules(method.toUpperCase(), path);
  if (SAFE_METHODS.has(method.toUpperCase())) return [];
  if (path === "/v1/invitations/redeem") return ["invitation"];
  if (path === "/v1/venues" && method.toUpperCase() === "POST") return ["venue_creation"];
  if (path === "/api/auth" || path.startsWith("/api/auth/")) {
    if (path.startsWith("/api/auth/sign-up")) {
      return hasInvitationToken ? ["signup", "invitation"] : ["signup"];
    }
    return ["auth"];
  }
  return [];
}

function expandIPv6(address: string): number[] {
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(fill).fill("0"), ...right].map((group) => parseInt(group, 16));
}

function clientKey(address: string): string {
  const bare = address.split("%")[0] ?? address;
  const family = isIP(bare);
  if (family === 4) return bare;
  if (family !== 6) return bare.toLowerCase();
  const groups = expandIPv6(new URL(`http://[${bare}]`).hostname.slice(1, -1));
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [high, low] = [groups[6] ?? 0, groups[7] ?? 0];
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

interface Counter {
  count: number;
  expiresAt: number;
}

export function createRateLimiter(config: RateLimitConfig, options: RateLimitOptions = {}) {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const counters = new Map<string, Counter>();
  const warned = new Set<string>();
  let lastSweep = -Infinity;

  function warnOnce(message: string) {
    if (warned.has(message)) return;
    warned.add(message);
    warn(message);
  }

  function clientOf(c: Context): string {
    const forwarded = c.req.header("x-forwarded-for");
    if (config.trustProxy) {
      const last = forwarded?.split(",").pop()?.trim();
      if (last && isIP(last)) return clientKey(last);
      warnOnce(
        "TRUST_PROXY is on but a request carried no usable X-Forwarded-For. Rate limits use the socket address, which is the proxy. Check that the proxy sets the header.",
      );
    } else if (forwarded) {
      warnOnce(
        "A request carried X-Forwarded-For while TRUST_PROXY is off. Rate limits use the socket address. Set TRUST_PROXY=true if the API runs behind a reverse proxy.",
      );
    }
    return clientKey(socketAddress(c) ?? "unknown");
  }

  function sweep(at: number) {
    if (at - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = at;
    for (const [key, counter] of counters) {
      if (at >= counter.expiresAt) counters.delete(key);
    }
  }

  function start(key: string, rule: Rule, at: number) {
    counters.delete(key);
    if (counters.size >= maxKeys) {
      sweep(at);
      while (counters.size >= maxKeys) {
        const oldest = counters.keys().next().value;
        if (oldest === undefined) break;
        counters.delete(oldest);
      }
    }
    counters.set(key, { count: 1, expiresAt: at + rule.windowMs });
  }

  function consume(names: RuleName[], subjectOf: (name: RuleName) => string, at: number): number {
    const live = names.map((name) => {
      const key = `${name}|${subjectOf(name)}`;
      const counter = counters.get(key);
      return { key, rule: config.rules[name], counter: counter && at < counter.expiresAt ? counter : undefined };
    });
    let waitMs = 0;
    for (const { rule, counter } of live) {
      if (counter && counter.count >= rule.max) waitMs = Math.max(waitMs, counter.expiresAt - at);
    }
    if (waitMs > 0) return Math.max(1, Math.ceil(waitMs / 1000));
    for (const { key, rule, counter } of live) {
      if (counter) counter.count += 1;
      else start(key, rule, at);
    }
    return 0;
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (!config.enabled) return next();
    const names = rulesFor(c.req.method, c.req.path, Boolean(c.req.header(INVITATION_HEADER)?.trim()));
    if (names.length === 0) return next();
    const client = clientOf(c);
    const subjectOf = (name: RuleName) => (name === "public_venue" ? `venue:${bookingKeyOf(c.req.path)}` : client);
    const retryAfter = consume(names, subjectOf, now());
    if (retryAfter === 0) return next();
    return c.json(
      { ...errorBody("rate_limited"), message: "Too many requests. Try again later." },
      ERRORS.rate_limited.status,
      { "Retry-After": String(retryAfter) },
    );
  };

  return { middleware, size: () => counters.size };
}
