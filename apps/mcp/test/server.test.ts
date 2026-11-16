import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ApiError, request } from "../src/client.js";
import { fail } from "../src/fail.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

  it("sets all three hints explicitly on every tool", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint"] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name} ${hint}`).toBe("boolean");
      }
    }
  });

  it("marks every read tool read-only and every other tool as a write", async () => {
    const { tools } = await client.listTools();
    const reads = [
      "reservation.availability",
      "reservation.agenda",
      "reservation.list",
      "reservation.search",
      "reservation.get",
      "reservation.events",
      "waitlist.list",
      "venue.getConfig",
    ];
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(reads.includes(tool.name));
    }
  });

  it("marks only what removes or overwrites as destructive, and waitlist.add as not idempotent", async () => {
    const { tools } = await client.listTools();
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual([
      "reservation.cancel",
      "reservation.erasure",
      "reservation.modify",
      "venue.setConfig",
      "waitlist.cancel",
    ]);
    const notIdempotent = tools.filter((t) => !t.annotations?.idempotentHint).map((t) => t.name);
    expect(notIdempotent).toEqual(["waitlist.add"]);
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

describe("tool error text", () => {
  it("keeps the prefix and appends the retry hint", () => {
    expect(fail(new ApiError("slot_taken", 409, false)).content[0].text).toBe(
      "API error 409: slot_taken (not retryable)",
    );
    expect(fail(new ApiError("transient", 500, true)).content[0].text).toBe("API error 500: transient (retryable)");
  });

  it("omits the suffix when the server sent no retryable field", () => {
    expect(fail(new ApiError("slot_taken", 409)).content[0].text).toBe("API error 409: slot_taken");
  });

  it("reads retryable from the HTTP error body and leaves it unknown when absent", async () => {
    const reply = (body: unknown, status: number) =>
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));
    reply({ code: "rate_limited", message: "x", retryable: true }, 429);
    await expect(request("/x")).rejects.toMatchObject({ code: "rate_limited", status: 429, retryable: true });
    reply({ code: "slot_taken", message: "x" }, 409);
    await expect(request("/x")).rejects.toMatchObject({ code: "slot_taken", retryable: undefined });
    vi.unstubAllGlobals();
  });
});
