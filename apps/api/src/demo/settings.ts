// Hosted demo settings (ADR-0022). Off unless DEMO_MODE=1, so a self-hosted instance never sees any of it.

type Env = Record<string, string | undefined>;

/** Days a sandbox lives after its owner's last sign-in. */
export const SANDBOX_TTL_DAYS = 14;

/** Lower caps than a real venue's, so one visitor cannot fill the demo database. Overridable for a bigger demo. */
export const DEFAULT_SANDBOX_CAPS = { reservations: 150, guests: 100 } as const;

export function sandboxCaps(env: Env = process.env): { reservations: number; guests: number } {
  const read = (name: string, fallback: number) => {
    const value = setting(env, name);
    if (value === undefined) return fallback;
    if (!/^[1-9][0-9]{0,5}$/.test(value)) throw new Error(`${name} must be a positive integer. Got "${value}".`);
    return Number(value);
  };
  return {
    reservations: read("DEMO_MAX_RESERVATIONS", DEFAULT_SANDBOX_CAPS.reservations),
    guests: read("DEMO_MAX_GUESTS", DEFAULT_SANDBOX_CAPS.guests),
  };
}

/** The header a sign-in form sends when the contact checkbox is ticked: the version of the consent text shown. */
export const CONSENT_HEADER = "x-demo-consent";
/** The header with the form's language. Without it the request's Accept-Language decides. */
export const LOCALE_HEADER = "x-demo-locale";

export interface DemoSettings {
  enabled: boolean;
  /** Present only when both Google variables are set. */
  google: { clientId: string; clientSecret: string } | null;
  /** Without Resend the magic link is printed to the API log instead (local trials only). */
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
  const mail = settings.mailConfigured ? "Resend" : "log only";
  return `demo mode on (magic link mail: ${mail}, Google sign-in: ${google})`;
}
