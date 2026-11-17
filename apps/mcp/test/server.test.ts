import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

const KEYED_WRITES: [string, Record<string, unknown>][] = [
  ["reservation.create", { venueId: "v", date: "2026-11-12", time: "21:00", partySize: 2 }],
  ["reservation.walk_in", { venueId: "v", partySize: 2 }],
  ["reservation.modify", { venueId: "v", id: "r", partySize: 3 }],
  ["reservation.cancel", { venueId: "v", id: "r" }],
  ["reservation.status", { venueId: "v", id: "r", status: "seated" }],
  ["waitlist.add", { venueId: "v", partySize: 2 }],
  ["waitlist.seat", { venueId: "v", id: "w" }],
  ["waitlist.cancel", { venueId: "v", id: "w" }],
];

const pkgDir = path.resolve(import.meta.dirname, "..");

let client: Client;
let api: Server;
const sent: { path: string; key: string | undefined }[] = [];
const bodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  api = createHttpServer((req, res) => {
    const key = req.headers["idempotency-key"];
    sent.push({ path: req.url ?? "", key: typeof key === "string" ? key : undefined });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(raw ? JSON.parse(raw) : {});
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const { port } = api.address() as AddressInfo;
  const transport = new StdioClientTransport({
    command: "node_modules/.bin/tsx",
    args: ["src/index.ts"],
    cwd: pkgDir,
    env: { ...process.env, OPENCOVERS_API_KEY: "test-key", OPENCOVERS_BASE_URL: `http://127.0.0.1:${port}` },
    stderr: "pipe",
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  api.close();
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

  it("marks only what removes or overwrites as destructive, and every tool idempotent for the same key", async () => {
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
    expect(notIdempotent).toEqual([]);
  });

  it("offers an idempotencyKey on every keyed write and tells the caller to resend it on retry", async () => {
    const { tools } = await client.listTools();
    const keyed = tools
      .filter((t) => (t.inputSchema as { properties: Record<string, unknown> }).properties.idempotencyKey)
      .map((t) => t.name)
      .sort();
    expect(keyed).toEqual([...KEYED_WRITES.map(([name]) => name)].sort());
    for (const name of keyed) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.description, name).toContain("Pass the same idempotencyKey when you retry");
      expect(tool?.inputSchema.required ?? [], name).not.toContain("idempotencyKey");
    }
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

  it("sets the booking policy in venue.setConfig", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "venue.setConfig")?.inputSchema as {
      properties: Record<string, unknown>;
    };
    const shape = (name: string) => JSON.stringify(schema.properties[name]);
    expect(shape("maxAdvanceDays")).toContain('"maximum":1000');
    expect(shape("maxActivePerGuestPerDay")).toContain('"maximum":100');
    expect(shape("blockedDates")).toContain('"maxItems":366');
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

describe("guest fields", () => {
  const lastGuest = () => (bodies.at(-1) as { guest: Record<string, unknown> }).guest;
  const BOOKING = { venueId: "v", date: "2026-11-12", time: "21:00", partySize: 2 };

  it("keeps the flat guestName and guestContact working on create, walk-in and waitlist.add", async () => {
    for (const [name, base] of [
      ["reservation.create", BOOKING],
      ["reservation.walk_in", { venueId: "v", partySize: 2 }],
      ["waitlist.add", { venueId: "v", partySize: 2 }],
    ] as const) {
      const res = await client.callTool({ name, arguments: { ...base, guestName: "Ana", guestContact: "ana@example.com" } });
      expect(res.isError, name).toBeFalsy();
      expect(lastGuest(), name).toMatchObject({ name: "Ana", contact: "ana@example.com" });
    }
  });

  it("maps a guest object to the same booking guest on create, walk-in and waitlist.add", async () => {
    for (const [name, base] of [
      ["reservation.create", BOOKING],
      ["reservation.walk_in", { venueId: "v", partySize: 2 }],
      ["waitlist.add", { venueId: "v", partySize: 2 }],
    ] as const) {
      const res = await client.callTool({ name, arguments: { ...base, guest: { name: "Ana", contact: "ana@example.com" } } });
      expect(res.isError, name).toBeFalsy();
      expect(lastGuest(), name).toMatchObject({ name: "Ana", contact: "ana@example.com" });
    }
  });

  it("maps guest.consent on create and modify", async () => {
    await client.callTool({ name: "reservation.create", arguments: { ...BOOKING, guest: { name: "Ana", consent: "granted" } } });
    expect(lastGuest()).toMatchObject({ name: "Ana", consent: "granted" });
    await client.callTool({ name: "reservation.modify", arguments: { venueId: "v", id: "r", guest: { consent: "denied" } } });
    expect(lastGuest()).toEqual({ consent: "denied" });
  });

  it("fails loudly on an unknown argument and creates nothing", async () => {
    const before = sent.length;
    for (const [name, base] of [
      ["reservation.create", BOOKING],
      ["reservation.walk_in", { venueId: "v", partySize: 2 }],
      ["reservation.modify", { venueId: "v", id: "r" }],
      ["waitlist.add", { venueId: "v", partySize: 2 }],
    ] as const) {
      const res = await client.callTool({ name, arguments: { ...base, guestEmail: "ana@example.com" } }).catch((e) => e);
      const text = JSON.stringify(res);
      expect(res instanceof Error || (res as { isError?: boolean }).isError, name).toBeTruthy();
      expect(text, name).toContain("guestEmail");
    }
    const res = await client.callTool({ name: "reservation.create", arguments: { ...BOOKING, guest: { name: "Ana", phone: "1" } } }).catch((e) => e);
    expect(JSON.stringify(res)).toContain("phone");
    expect(sent.length).toBe(before);
  });

  it("fails when guest and the flat fields disagree, and accepts them when they agree", async () => {
    const before = sent.length;
    const bad = await client.callTool({ name: "reservation.create", arguments: { ...BOOKING, guestName: "Bo", guest: { name: "Ana" } } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad)).toContain("guest.name and guestName disagree");
    expect(sent.length).toBe(before);
    const good = await client.callTool({ name: "reservation.create", arguments: { ...BOOKING, guestName: "Ana", guest: { name: "Ana" } } });
    expect(good.isError).toBeFalsy();
  });

  it("lists guest as an object next to the flat fields, with idempotencyKey still optional", async () => {
    const { tools } = await client.listTools();
    for (const name of ["reservation.create", "reservation.walk_in", "waitlist.add"]) {
      const schema = tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, { type?: string }>; required?: string[] };
      expect(schema.properties.guest.type, name).toBe("object");
      expect(schema.properties.guestName, name).toBeDefined();
      expect(schema.required ?? [], name).not.toContain("idempotencyKey");
    }
  });
});

describe("idempotency key on the wire", () => {
  async function keysSent(name: string, args: Record<string, unknown>) {
    sent.length = 0;
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
    }
    return sent.map((r) => r.key);
  }

  it("sends the caller's key unchanged on a retry, for every keyed write", async () => {
    for (const [name, args] of KEYED_WRITES) {
      expect(await keysSent(name, { ...args, idempotencyKey: `retry-${name}` }), name).toEqual([
        `retry-${name}`,
        `retry-${name}`,
      ]);
    }
  });

  it("sends a fresh key per call when the caller omits it", async () => {
    for (const [name, args] of KEYED_WRITES) {
      const [first, second] = await keysSent(name, args);
      expect(first, name).toMatch(/^[0-9a-f-]{36}$/);
      expect(second, name).toMatch(/^[0-9a-f-]{36}$/);
      expect(first, name).not.toBe(second);
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
