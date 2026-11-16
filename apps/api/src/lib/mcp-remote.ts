// Remote MCP transport switch and the OAuth values ADR-0014 fixes.

export const MCP_SCOPES = ["opencovers:read", "opencovers:write"] as const;

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_S = 10 * 60;

export function mcpRemoteEnabled(
  value: string | undefined = process.env.MCP_REMOTE,
): boolean {
  if (value === undefined || value === "" || value === "off") return false;
  if (value === "on") return true;
  throw new Error(`MCP_REMOTE must be on or off. Got "${value}".`);
}

export function mcpResourceUri(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/mcp`;
}
