// Remote MCP transport switch and the OAuth values ADR-0014 fixes.

export const MCP_SCOPES = ["opencovers:read", "opencovers:write"] as const;
/** Asks the token endpoint for a refresh token. Grants no API access and is not advertised (ADR-0014, Scopes). */
export const OFFLINE_ACCESS = "offline_access";

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_S = 10 * 60;

/** The fallback in `auth.ts`. Public, so it never signs or encrypts anything of a remote client. */
export const DEV_AUTH_SECRET = "dev-secret-change-me";

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether the API is an OAuth authorization server. Off unless MCP_REMOTE=on. With it on, the API refuses to start
 * unless it can be one safely: an HTTPS public URL (plain HTTP only on a loopback host outside production), a real
 * BETTER_AUTH_SECRET, and no demo mode.
 */
export function mcpRemoteEnabled(env: Env = process.env): boolean {
  const value = env.MCP_REMOTE;
  if (value === undefined || value === "" || value === "off") return false;
  if (value !== "on") throw new Error(`MCP_REMOTE must be on or off. Got "${value}".`);

  const base = new URL(env.BETTER_AUTH_URL || "http://localhost:3000");
  const localHttp = base.protocol === "http:" && LOOPBACK_HOSTS.has(base.hostname) && env.NODE_ENV !== "production";
  if (base.protocol !== "https:" && !localHttp) {
    throw new Error(`MCP_REMOTE=on needs BETTER_AUTH_URL to be the public https URL. Got "${base.origin}".`);
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
    throw new Error("MCP_REMOTE=on needs BETTER_AUTH_SECRET. Generate one with openssl rand -base64 32.");
  }
  if (env.DEMO_MODE === "1") {
    throw new Error("MCP_REMOTE=on is refused with DEMO_MODE=1: the hosted demo does not authorize agents.");
  }
  return true;
}

export function mcpResourceUri(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/mcp`;
}
