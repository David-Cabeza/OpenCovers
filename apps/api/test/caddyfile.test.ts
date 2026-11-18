import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The production Caddyfile's framing rules (ADR-0017 section 1, C41). scripts/check-caddy-widget.sh runs the same
// file in Caddy and reads the headers; this reads the file, so CI catches an edit that weakens it.

const caddyfile = readFileSync(path.resolve(import.meta.dirname, "../../web/Caddyfile"), "utf8");

/** Top-level site blocks by address, comments removed. */
function siteBlocks(source: string): Map<string, string> {
  const placeholders: string[] = [];
  const text = source
    .replace(/^\s*#.*$/gm, "")
    .replace(/\{\$[^{}]*\}/g, (env) => `\u0000${placeholders.push(env) - 1}\u0000`);
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => placeholders[Number(i)]);
  const blocks = new Map<string, string>();
  let depth = 0;
  let start = 0;
  let address = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") {
      if (depth === 0) {
        address = restore(text.slice(start, i).trim());
        start = i + 1;
      }
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.set(address, restore(text.slice(start, i)));
        start = i + 1;
      }
    }
  }
  return blocks;
}

/** The body of `handle <matcher> { ... }` inside a block. */
function handle(block: string, matcher: string): string | null {
  const at = block.indexOf(`handle ${matcher} {`);
  if (at < 0) return null;
  const end = block.indexOf("\n\t}", at);
  return block.slice(at, end);
}

const blocks = siteBlocks(caddyfile);
const staff = blocks.get("{$SITE_ADDRESS:http://localhost}")!;
const widget = blocks.get("{$WIDGET_ADDRESS:http://widget.invalid}")!;

describe("production Caddyfile", () => {
  it("has the staff site and the widget site, and nothing else", () => {
    expect([...blocks.keys()]).toEqual(["{$SITE_ADDRESS:http://localhost}", "{$WIDGET_ADDRESS:http://widget.invalid}"]);
  });

  it("keeps DENY and frame-ancestors 'none' on every staff path, and never proxies /w/* there", () => {
    const headers = staff.slice(staff.indexOf("header {"), staff.indexOf("}", staff.indexOf("header {")));
    expect(headers).toContain('X-Frame-Options "DENY"');
    expect(headers).toMatch(/Content-Security-Policy "[^"]*frame-ancestors 'none'[^"]*"/);
    expect(staff.match(/^\s*header\b/gm)).toHaveLength(2);
    expect(staff).toMatch(/header @https Strict-Transport-Security/);
    expect(handle(staff, "/w/*")).toMatch(/respond 404/);
    expect(handle(staff, "/w/*")).not.toContain("reverse_proxy");
    expect(staff.indexOf("handle /w/*")).toBeLessThan(staff.indexOf("handle /v1/*"));
  });

  it("sends no X-Frame-Options and no frame-ancestors of its own on the widget page", () => {
    expect(widget).not.toContain("X-Frame-Options");
    expect(handle(widget, "/w/*")).toMatch(/^handle \/w\/\* \{\s*reverse_proxy \{\$API_UPSTREAM:api:3000\}\s*$/);
    const siteHeaders = widget.slice(widget.indexOf("header {"), widget.indexOf("}", widget.indexOf("header {")));
    expect(siteHeaders).not.toContain("Content-Security-Policy");
  });

  it("proxies /v1/public/* with frame-ancestors 'none', and serves nothing else", () => {
    const pub = handle(widget, "/v1/public/*")!;
    expect(pub).toMatch(/header Content-Security-Policy "[^"]*frame-ancestors 'none'"/);
    expect(pub).toContain("reverse_proxy {$API_UPSTREAM:api:3000}");
    expect(widget).not.toMatch(/handle \/(api|v1)\/\* /);
    expect(widget).not.toContain("file_server");
    expect(widget).toMatch(/handle \{\s*respond 404\s*\}/);
  });

  it("caps request bodies in both site blocks above the API's own limits", () => {
    const maxSize = (block: string) => /^\trequest_body \{\s*max_size (\S+)\s*\}/m.exec(block)?.[1];
    expect(maxSize(staff)).toBe("1MiB");
    expect(maxSize(widget)).toBe("64KiB");
  });

  it("proxies /favicon.ico on the widget site only, and the staff site never names it", () => {
    expect(handle(widget, "/favicon.ico")).toMatch(/^handle \/favicon\.ico \{\s*reverse_proxy \{\$API_UPSTREAM:api:3000\}\s*$/);
    expect(staff).not.toContain("favicon");
    expect(widget).toMatch(/handle \{\s*respond 404\s*\}/);
  });

  it("proxies the self-service page /r on the widget site only, with the API's headers", () => {
    expect(handle(widget, "/r")).toMatch(/^handle \/r \{\s*reverse_proxy \{\$API_UPSTREAM:api:3000\}\s*$/);
    expect(handle(staff, "/r")).toMatch(/^handle \/r \{\s*respond 404\s*$/);
    expect(staff.indexOf("handle /r {")).toBeLessThan(staff.indexOf("handle {"));
  });
});
