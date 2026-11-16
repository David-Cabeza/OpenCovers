import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrateDb } from "../src/db/migrate";
import { ERRORS, errorBody } from "../src/lib/errors";

const { default: app } = await import("../src/app");

const contractDir = path.resolve(import.meta.dirname, "../../../docs/contract");
const registry = Object.keys(ERRORS).sort();
const read = (file: string) => readFileSync(path.join(contractDir, file), "utf8");

beforeAll(async () => {
  await migrateDb();
});

describe("error retry hint", () => {
  it("returns retryable false on a 4xx the caller must change something to fix", async () => {
    const res = await app.request("/v1/venues/some-venue/config");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "unauthorized", retryable: false });
  });

  it("returns retryable false on a bad key, matching the registry", async () => {
    const res = await app.request("/v1/venues/some-venue/config", { headers: { apikey: "not-a-key" } });
    const body = await res.json();
    expect(res.status).toBe(ERRORS[body.code as keyof typeof ERRORS].status);
    expect(body.retryable).toBe(ERRORS[body.code as keyof typeof ERRORS].retryable);
  });

  it("returns retryable true for a 5xx that the same request can outlive", () => {
    expect(ERRORS.transient.status).toBe(500);
    expect(errorBody("transient")).toEqual({ code: "transient", message: "transient", retryable: true });
  });

  it("keeps the 429 from the rate limiter in step with the registry", () => {
    expect(ERRORS.rate_limited).toEqual({ status: 429, retryable: true });
  });
});

describe("error vocabulary drift", () => {
  it("lists every registry code in errors.md and nothing else", () => {
    const documented = [...read("errors.md").matchAll(/^- `([a-z_]+)`:/gm)].map((m) => m[1]).sort();
    expect(documented).toEqual(registry);
  });

  it("marks each code retryable or not in errors.md as the registry does", () => {
    const lines = read("errors.md").split("\n");
    for (const [code, { retryable }] of Object.entries(ERRORS)) {
      const line = lines.find((l) => l.startsWith(`- \`${code}\`:`)) ?? "";
      expect(line, code).toContain(retryable ? "Retryable." : "Not retryable.");
    }
  });

  it("matches the OpenAPI ErrorCode enum", () => {
    const yaml = read("openapi.yaml");
    const block = yaml.slice(yaml.indexOf("    ErrorCode:"));
    const codes = [...block.slice(block.indexOf("enum:")).matchAll(/^ {8}- ([a-z_]+)$/gm)].map((m) => m[1]).sort();
    expect(codes).toEqual(registry);
  });

  it("requires retryable in the OpenAPI Error schema", () => {
    const yaml = read("openapi.yaml");
    const start = yaml.indexOf("    Error:\n      type: object");
    expect(yaml.slice(start, yaml.indexOf("    ErrorCode:"))).toContain("required: [code, message, retryable]");
  });
});
