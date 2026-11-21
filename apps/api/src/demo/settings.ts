// Hosted demo settings (ADR-0022). Off unless DEMO_MODE=1, so a self-hosted instance never sees any of it.

type Env = Record<string, string | undefined>;

/** Days a sandbox lives after its owner's last sign-in. */
export const SANDBOX_TTL_DAYS = 14;

/**
 * What one sandbox may hold and how many sandboxes the demo hosts. Lower than a real venue's limits, so one visitor
 * cannot fill the demo database. Every number can be overridden with the variable named in `LIMIT_ENV`.
 */
export const DEFAULT_SANDBOX_LIMITS = {
  reservations: 150,
  guests: 100,
  waitlist: 60,
  tables: 40,
  services: 8,
  floorItems: 40,
  invitations: 20,
  apiKeys: 10,
  blocklist: 50,
  /** Live sandboxes the whole demo hosts. */
  maxSandboxes: 500,
  /** Sandboxes created in the last 24 hours. */
  maxNewPerDay: 100,
  /** Sandboxes built at the same time. Must stay clearly below the database pool (`DATABASE_POOL_MAX`). */
  provisionConcurrency: 3,
  /** Sign-ins waiting for a build slot. Beyond it the demo answers "busy" instead of queueing forever. */
  provisionQueue: 50,
} as const;

export type SandboxLimits = { -readonly [K in keyof typeof DEFAULT_SANDBOX_LIMITS]: number };

const LIMIT_ENV: Record<keyof SandboxLimits, string> = {
  reservations: "DEMO_MAX_RESERVATIONS",
  guests: "DEMO_MAX_GUESTS",
  waitlist: "DEMO_MAX_WAITLIST",
  tables: "DEMO_MAX_TABLES",
  services: "DEMO_MAX_SERVICES",
  floorItems: "DEMO_MAX_FLOOR_ITEMS",
  invitations: "DEMO_MAX_INVITATIONS",
  apiKeys: "DEMO_MAX_API_KEYS",
  blocklist: "DEMO_MAX_BLOCKLIST",
  maxSandboxes: "DEMO_MAX_SANDBOXES",
  maxNewPerDay: "DEMO_MAX_NEW_PER_DAY",
  provisionConcurrency: "DEMO_PROVISION_CONCURRENCY",
  provisionQueue: "DEMO_PROVISION_QUEUE",
};

export function sandboxLimits(env: Env = process.env): SandboxLimits {
  const out = { ...DEFAULT_SANDBOX_LIMITS } as SandboxLimits;
  for (const key of Object.keys(LIMIT_ENV) as (keyof SandboxLimits)[]) {
    const name = LIMIT_ENV[key];
    const value = setting(env, name);
    if (value === undefined) continue;
    if (!/^[1-9][0-9]{0,5}$/.test(value)) throw new Error(`${name} must be a positive integer. Got "${value}".`);
    out[key] = Number(value);
  }
  const pool = poolSettings(env).max;
  if (out.provisionConcurrency > Math.max(1, pool - 3)) {
    throw new Error(
      `DEMO_PROVISION_CONCURRENCY (${out.provisionConcurrency}) must leave at least 3 connections of the pool (DATABASE_POOL_MAX=${pool}) free for everything else.`,
    );
  }
  return out;
}

/** The reservation and guest caps. */
export function sandboxCaps(env: Env = process.env): { reservations: number; guests: number } {
  const { reservations, guests } = sandboxLimits(env);
  return { reservations, guests };
}

/** The database pool. A request that cannot get a connection within the timeout fails instead of hanging. */
export function poolSettings(env: Env = process.env): { max: number; connectionTimeoutMillis: number } {
  const read = (name: string, fallback: number, min: number) => {
    const value = setting(env, name);
    if (value === undefined) return fallback;
    if (!/^[0-9]{1,6}$/.test(value) || Number(value) < min) {
      throw new Error(`${name} must be an integer of at least ${min}. Got "${value}".`);
    }
    return Number(value);
  };
  return {
    max: read("DATABASE_POOL_MAX", 10, 4),
    connectionTimeoutMillis: read("DATABASE_CONNECTION_TIMEOUT_MS", 10_000, 1),
  };
}

export interface DemoSettings {
  enabled: boolean;
  /** Present only when both Google variables are set. */
  google: { clientId: string; clientSecret: string } | null;
  /** Without Resend the magic link is not delivered, and it is never logged under DEMO_MODE=1. */
  mailConfigured: boolean;
}

function setting(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function demoSettings(env: Env = process.env): DemoSettings {
  const flag = setting(env, "DEMO_MODE");
  if (flag !== undefined && flag !== "0" && flag !== "1") {
    throw new Error(`DEMO_MODE must be 1 or 0. Got "${flag}".`);
  }
  const mailConfigured = Boolean(setting(env, "RESEND_API_KEY") && setting(env, "RESEND_FROM_EMAIL"));
  if (flag !== "1") return { enabled: false, google: null, mailConfigured };

  const clientId = setting(env, "GOOGLE_CLIENT_ID");
  const clientSecret = setting(env, "GOOGLE_CLIENT_SECRET");
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.");
  }
  if (env.NODE_ENV === "production" && !mailConfigured) {
    throw new Error("DEMO_MODE=1 in production needs RESEND_API_KEY and RESEND_FROM_EMAIL to send magic links.");
  }
  sandboxLimits(env);
  return {
    enabled: true,
    google: clientId !== undefined && clientSecret !== undefined ? { clientId, clientSecret } : null,
    mailConfigured,
  };
}

/** Whether this process runs the hosted demo. Read from the environment each time, like `signupMode`. */
export function demoMode(env: Env = process.env): boolean {
  return demoSettings(env).enabled;
}

export function describeDemo(settings: DemoSettings): string {
  if (!settings.enabled) return "demo mode off";
  const google = settings.google ? "on" : "off";
  const mail = settings.mailConfigured ? "Resend" : "not configured, links are not delivered";
  return `demo mode on (magic link mail: ${mail}, Google sign-in: ${google})`;
}
