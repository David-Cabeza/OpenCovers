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
  "public_days",
  "magic_link",
  "magic_link_day",
  "magic_link_ip",
  "demo_challenge",
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
  public_days: { max: 60, windowMs: 15 * 60_000 },
  // Demo mode only (ADR-0022, decision 8a): a magic link is limited to 1 per address per minute, 5 per address per
  // day and 10 per IP per hour, on top of `auth`. `demo_challenge` caps how often one IP asks for a challenge.
  magic_link: { max: 1, windowMs: 60_000 },
  magic_link_day: { max: 5, windowMs: 24 * 3_600_000 },
  magic_link_ip: { max: 10, windowMs: 3_600_000 },
  demo_challenge: { max: 60, windowMs: 3_600_000 },
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
  public_days: "RATE_LIMIT_PUBLIC_DAYS",
  magic_link: "RATE_LIMIT_MAGIC_LINK",
  magic_link_day: "RATE_LIMIT_MAGIC_LINK_DAY",
  magic_link_ip: "RATE_LIMIT_MAGIC_LINK_IP",
  demo_challenge: "RATE_LIMIT_DEMO_CHALLENGE",
};

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

export const INVITATION_HEADER = "x-invitation-token";
const DEFAULT_MAX_KEYS = 10_000;
// A rule whose charge is returned when the route answers one of these statuses: the request never reached a
// booking, so a malformed body or an unknown key costs the address budget and not the venue's.
const REFUNDED_ON: Partial<Record<RuleName, ReadonlySet<number>>> = {
  public_venue: new Set([400, 404]),
  // A magic link refused for its challenge, a disposable address or a bad body sent nothing, so it must not spend the
  // address's budget: anyone could otherwise lock a victim out of their own sign-in by posting without a challenge.
  magic_link: new Set([400, 404]),
  magic_link_day: new Set([400, 404]),
  magic_link_ip: new Set([400, 404]),
};
const MAGIC_LINK_RULES: RuleName[] = ["auth", "magic_link", "magic_link_day", "magic_link_ip"];
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
  if (read) return rest.length === 2 && rest[1] === "days" ? ["public_read", "public_days"] : ["public_read"];
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
    return path === "/api/auth/sign-in/magic-link" ? MAGIC_LINK_RULES : ["auth"];
  }
  if (path === "/api/demo/magic-link-challenge") return ["demo_challenge"];
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
  // A /48, not a /64: one site commonly holds a /48, which is 65,536 /64s, enough to fill a rule's table.
  return `${groups.slice(0, 3).map((group) => group.toString(16)).join(":")}::/48`;
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/** The address a magic link is asked for, lower case, or null when the body is missing, large or not JSON. */
async function magicLinkAddress(c: Context): Promise<string | null> {
  const length = Number(c.req.header("content-length") ?? Number.NaN);
  if (!(length > 0 && length <= 4096)) return null;
  try {
    const body = (await c.req.raw.clone().json()) as { email?: unknown };
    return typeof body.email === "string" && body.email.length <= 254 ? body.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

interface Counter {
  count: number;
  expiresAt: number;
}

/** Counters of one rule by subject. A rule has one window, so insertion order is expiry order. */
type Table = Map<string, Counter>;

interface Charge {
  name: RuleName;
  table: Table;
  subject: string;
  counter: Counter;
}

export function createRateLimiter(config: RateLimitConfig, options: RateLimitOptions = {}) {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const tables = Object.fromEntries(RULE_NAMES.map((name) => [name, new Map()])) as Record<RuleName, Table>;
  const warned = new Set<string>();

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

  function dropExpired(table: Table, at: number) {
    for (const [subject, counter] of table) {
      if (at < counter.expiresAt) return;
      table.delete(subject);
    }
  }

  // A full table refuses new subjects until its oldest window ends. Dropping a live counter instead would let a
  // flood of new addresses reset a spent budget.
  function consume(names: RuleName[], subjectOf: (name: RuleName) => string, at: number) {
    const live = names.map((name) => {
      const table = tables[name];
      dropExpired(table, at);
      const subject = subjectOf(name);
      const counter = table.get(subject);
      return { name, table, subject, counter: counter && at < counter.expiresAt ? counter : undefined };
    });
    let waitMs = 0;
    for (const { name, table, counter } of live) {
      if (counter) {
        if (counter.count >= config.rules[name].max) waitMs = Math.max(waitMs, counter.expiresAt - at);
      } else if (table.size >= maxKeys) {
        warnOnce(`Rate limit rule ${name} tracks ${maxKeys} clients, its most. New clients are refused until a window ends.`);
        const oldest = table.values().next().value as Counter;
        waitMs = Math.max(waitMs, oldest.expiresAt - at);
      }
    }
    if (waitMs > 0) return { retryAfter: Math.max(1, Math.ceil(waitMs / 1000)), charges: [] };
    const charges: Charge[] = live.map(({ name, table, subject, counter }) => {
      if (counter) {
        counter.count += 1;
        return { name, table, subject, counter };
      }
      const fresh = { count: 1, expiresAt: at + config.rules[name].windowMs };
      table.delete(subject);
      table.set(subject, fresh);
      return { name, table, subject, counter: fresh };
    });
    return { retryAfter: 0, charges };
  }

  function refund({ table, subject, counter }: Charge) {
    if (table.get(subject) !== counter) return;
    counter.count -= 1;
    if (counter.count === 0) table.delete(subject);
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (!config.enabled) return next();
    const names = rulesFor(c.req.method, c.req.path, Boolean(c.req.header(INVITATION_HEADER)?.trim()));
    if (names.length === 0) return next();
    const client = clientOf(c);
    const address = names.includes("magic_link") ? await magicLinkAddress(c) : null;
    const subjectOf = (name: RuleName) => {
      if (name === "public_venue") return `venue:${bookingKeyOf(c.req.path)}`;
      if ((name === "magic_link" || name === "magic_link_day") && address !== null) return `mail:${address}`;
      return client;
    };
    const { retryAfter, charges } = consume(names, subjectOf, now());
    if (retryAfter === 0) {
      await next();
      for (const charge of charges) {
        if (REFUNDED_ON[charge.name]?.has(c.res.status)) refund(charge);
      }
      return;
    }
    return c.json(
      { ...errorBody("rate_limited"), message: "Too many requests. Try again later." },
      ERRORS.rate_limited.status,
      { "Retry-After": String(retryAfter) },
    );
  };

  return { middleware, size: () => RULE_NAMES.reduce((sum, name) => sum + tables[name].size, 0) };
}
