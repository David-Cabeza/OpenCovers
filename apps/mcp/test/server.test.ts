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

  it("accepts the closed consent set on create, walk-in and modify", async () => {
    const { tools } = await client.listTools();
    for (const name of ["reservation.create", "reservation.walk_in", "reservation.modify"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, { enum?: string[] }>;
      };
      expect(schema.properties.consent.enum).toEqual(["unknown", "granted", "denied"]);
    }
  });

  it("sets the overbooking ceiling from 0 to 1000 in venue.setConfig", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "venue.setConfig")?.inputSchema as {
      properties: Record<string, { minimum?: number; maximum?: number }>;
    };
    expect(schema.properties.overbookingCeiling).toMatchObject({ minimum: 0, maximum: 1000 });
  });

  it("accepts the closed reconfirmation set on create and modify but not on walk-in", async () => {
    const { tools } = await client.listTools();
    for (const name of ["reservation.create", "reservation.modify"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, { enum?: string[] }>;
      };
      expect(schema.properties.reconfirmation.enum).toEqual(["none", "requested", "confirmed", "declined", "no_answer"]);
    }
    const walkIn = tools.find((t) => t.name === "reservation.walk_in")?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(walkIn.properties.reconfirmation).toBeUndefined();
  });

  it("accepts a bounded booking note on create, walk-in and modify", async () => {
    const { tools } = await client.listTools();
    for (const name of ["reservation.create", "reservation.walk_in", "reservation.modify"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, { type?: string; maxLength?: number; description?: string }>;
      };
      const commentary = schema.properties.commentary;
      expect(commentary.type).toBe("string");
      expect(commentary.maxLength).toBe(500);
      expect(commentary.description).toContain("Never put allergies");
    }
  });

  it("tells the caller that seating needs a table", async () => {
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === "reservation.status")?.description ?? "";
    expect(description).toContain("table_required");
    expect(description).toContain("reservation.modify");
  });

  it("accepts a rating from 1 to 5 on create, walk-in and modify", async () => {
    const { tools } = await client.listTools();
    for (const name of ["reservation.create", "reservation.walk_in", "reservation.modify"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, { minimum?: number; maximum?: number; type?: unknown; anyOf?: unknown }>;
      };
      const rating = schema.properties.rating;
      expect(rating).toBeDefined();
      expect(JSON.stringify(rating)).toContain('"minimum":1');
      expect(JSON.stringify(rating)).toContain('"maximum":5');
    }
  });
});
