import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// "The contract comes before the implementation" (CLAUDE.md), enforced for routes:
// every method + path the Hono app serves under /v1 must be in docs/contract/openapi.yaml
// or in UNDOCUMENTED below. The list can only shrink: an entry that is now documented
// or no longer served fails the test, so remove it in the same change.

const { default: app } = await import("../src/app");

const METHODS = ["get", "put", "post", "delete", "patch"] as const;
// Hono writes `:id`, OpenAPI `{id}`, and the two name the same parameter differently
// (`:id` vs `{reservationId}`), so a parameter compares as `{}`.
const key = (method: string, p: string) =>
  `${method.toUpperCase()} ${p.replace(/:[A-Za-z0-9_]+|\{[^}]+\}/g, "{}")}`;

// Routes the contract owes. Each one is documented by T04 and then deleted from here.
const UNDOCUMENTED = [
  // to document in T04
  "GET /v1/venues/{venueId}/floor",
  "GET /v1/venues/{venueId}/tables",
  "POST /v1/venues/{venueId}/tables",
  "PATCH /v1/venues/{venueId}/tables/{tableId}",
  "DELETE /v1/venues/{venueId}/tables/{tableId}",
  "GET /v1/venues/{venueId}/floor-items",
  "POST /v1/venues/{venueId}/floor-items",
  "PATCH /v1/venues/{venueId}/floor-items/{itemId}",
  "DELETE /v1/venues/{venueId}/floor-items/{itemId}",
  "GET /v1/venues/{venueId}/keys",
  "POST /v1/venues/{venueId}/keys",
  "DELETE /v1/venues/{venueId}/keys",
  "GET /v1/auth/keys",
  "POST /v1/auth/keys",
  "DELETE /v1/auth/keys",
  "DELETE /v1/venues/{venueId}/services/{name}",
];

// Not method + path routes of the API surface: ALL is middleware (auth, CORS, limits),
// OPTIONS answers CORS preflight. Neither is a contract operation.
const isOperation = (method: string) => METHODS.includes(method.toLowerCase() as never);

// Outside /v1 (health, /api/* Better Auth and demo, /w/* and /r* widget pages and assets,
// /favicon.ico): not part of the /v1 contract. The few that are documented there are
// listed in openapi.yaml under their own `servers`, and are not checked here.
const inScope = (p: string) => p.startsWith("/v1/");

function contractOperations(): Set<string> {
  const file = path.resolve(import.meta.dirname, "../../../docs/contract/openapi.yaml");
  // No YAML parser is a dependency of the API package, so read the `paths:` block:
  // a path is a 2-space-indented key, a method a 4-space-indented key under it.
  const ops = new Set<string>();
  let inPaths = false;
  let current: string | null = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\S/.test(line)) inPaths = line.startsWith("paths:");
    if (!inPaths) continue;
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      current = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|put|post|delete|patch):\s*$/.exec(line);
    if (methodMatch && current) ops.add(key(methodMatch[1], `/v1${current}`));
  }
  return ops;
}

function servedOperations(): Set<string> {
  const served = new Set<string>();
  for (const r of app.routes) {
    if (isOperation(r.method) && inScope(r.path)) served.add(key(r.method, r.path));
  }
  return served;
}

describe("contract route coverage", () => {
  const documented = contractOperations();
  const served = servedOperations();
  const excluded = new Set(UNDOCUMENTED.map((r) => key(r.split(" ")[0], r.split(" ")[1])));

  it("reads a plausible number of routes on both sides", () => {
    expect(documented.size).toBeGreaterThan(50);
    expect(served.size).toBeGreaterThan(50);
  });

  it("has no /v1 route that is in neither openapi.yaml nor the exclusion list", () => {
    const missing = [...served].filter((r) => !documented.has(r) && !excluded.has(r)).sort();
    expect(missing, "document these in docs/contract/openapi.yaml (contract first)").toEqual([]);
  });

  it("lists nothing in the exclusion list that is now documented or no longer served", () => {
    const stale = [...excluded]
      .filter((r) => documented.has(r) || !served.has(r))
      .sort();
    expect(stale, "remove these from UNDOCUMENTED").toEqual([]);
  });

  it("has no duplicate in the exclusion list", () => {
    expect(excluded.size).toBe(UNDOCUMENTED.length);
  });
});
