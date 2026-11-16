import { describe, expect, it } from "vitest";
import app from "../src/app";
import { mcpRemoteEnabled } from "../src/lib/mcp-remote";

describe("remote MCP switch", () => {
  it("is off unless MCP_REMOTE is on, and refuses any other value", () => {
    expect(mcpRemoteEnabled(undefined)).toBe(false);
    expect(mcpRemoteEnabled("")).toBe(false);
    expect(mcpRemoteEnabled("off")).toBe(false);
    expect(mcpRemoteEnabled("on")).toBe(true);
    expect(() => mcpRemoteEnabled("true")).toThrow(/MCP_REMOTE/);
  });

  it.each([
    ["GET", "/.well-known/oauth-authorization-server/api/auth"],
    ["GET", "/api/auth/.well-known/oauth-authorization-server"],
    ["GET", "/api/auth/oauth2/authorize?response_type=code&client_id=x"],
    ["POST", "/api/auth/oauth2/token"],
    ["POST", "/api/auth/oauth2/consent"],
    ["POST", "/api/auth/oauth2/revoke"],
  ])("answers %s %s with 404 while off", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(404);
  });
});
