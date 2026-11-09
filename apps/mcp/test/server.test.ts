import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTRACT_TOOLS = [
  "reservation.availability",
  "reservation.agenda",
  "reservation.list",
  "reservation.search",
  "reservation.get",
  "reservation.create",
  "reservation.walk_in",
  "reservation.modify",
  "reservation.cancel",
  "reservation.status",
  "reservation.events",
  "reservation.erasure",
  "waitlist.list",
  "waitlist.add",
  "waitlist.seat",
  "waitlist.cancel",
  "venue.getConfig",
  "venue.setConfig",
];

const pkgDir = path.resolve(import.meta.dirname, "..");

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "node_modules/.bin/tsx",
    args: ["src/index.ts"],
    cwd: pkgDir,
    env: { ...process.env, OPENCOVERS_API_KEY: "test-key" },
    stderr: "pipe",
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
});

describe("opencovers MCP server", () => {
  it("exposes every tool in the contract", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...CONTRACT_TOOLS].sort());
  });

  it("marks reads as read-only and writes as non-destructive", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    const reads = ["reservation.availability", "reservation.agenda", "reservation.get", "venue.getConfig"];
    for (const name of reads) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }

    expect(byName.get("reservation.erasure")?.annotations?.destructiveHint).toBe(true);
  });
});
