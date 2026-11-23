import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("package version", () => {
  it("is the same in package.json, server.json (both fields) and VERSION", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const server = JSON.parse(read("server.json")) as {
      version: string;
      packages: { version: string }[];
    };
    const constant = /const VERSION = "([^"]+)"/.exec(read("src/index.ts"))?.[1];

    expect(constant).toBeDefined();
    expect(server.packages).toHaveLength(1);
    expect(new Set([pkg.version, server.version, server.packages[0]!.version, constant])).toEqual(
      new Set([pkg.version]),
    );
  });
});
