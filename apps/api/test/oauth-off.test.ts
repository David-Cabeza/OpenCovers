import { describe, expect, it } from "vitest";
import app from "../src/app";
import { mcpRemoteEnabled } from "../src/lib/mcp-remote";

const SECRET = "s".repeat(32);
const READY = { MCP_REMOTE: "on", BETTER_AUTH_URL: "https://book.example.com", BETTER_AUTH_SECRET: SECRET };

describe("remote MCP switch", () => {
  it("is off unless MCP_REMOTE is on, and refuses any other value", () => {
    expect(mcpRemoteEnabled({})).toBe(false);
    expect(mcpRemoteEnabled({ MCP_REMOTE: "" })).toBe(false);
    expect(mcpRemoteEnabled({ MCP_REMOTE: "off" })).toBe(false);
    expect(mcpRemoteEnabled(READY)).toBe(true);
    expect(() => mcpRemoteEnabled({ ...READY, MCP_REMOTE: "true" })).toThrow(/MCP_REMOTE/);
  });

  it("checks nothing else while off, so an instance that never turns it on starts as before", () => {
    expect(mcpRemoteEnabled({ DEMO_MODE: "1", BETTER_AUTH_URL: "http://example.com", NODE_ENV: "production" })).toBe(false);
  });

  it.each([
    ["an http public URL", { BETTER_AUTH_URL: "http://book.example.com" }, /https/],
    ["http on localhost in production", { BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "production" }, /https/],
    ["no public URL in production", { BETTER_AUTH_URL: undefined, NODE_ENV: "production" }, /https/],
    ["no secret", { BETTER_AUTH_SECRET: undefined }, /BETTER_AUTH_SECRET/],
    ["the public development secret", { BETTER_AUTH_SECRET: "dev-secret-change-me" }, /BETTER_AUTH_SECRET/],
    ["demo mode", { DEMO_MODE: "1" }, /DEMO_MODE/],
  ])("refuses to start when on with %s", (_case, change, message) => {
    expect(() => mcpRemoteEnabled({ ...READY, ...change })).toThrow(message);
  });

  it("allows plain http on a loopback host outside production, for local development", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", undefined]) {
      expect(mcpRemoteEnabled({ ...READY, BETTER_AUTH_URL: url, NODE_ENV: "development" }), url).toBe(true);
    }
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
