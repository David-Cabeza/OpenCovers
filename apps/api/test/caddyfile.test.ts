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
    // The global header block, the HSTS line, the Content-Type of the three 404 pages (/w/*, /r and the guest API),
    // the demo's X-Robots-Tag and the Content-Type of its robots.txt.
    expect(staff.match(/^\s*header\b/gm)).toHaveLength(7);
    expect(staff).toMatch(/header @https Strict-Transport-Security/);
    expect(handle(staff, "/w/*")).toMatch(/respond ".*" 404/);
    expect(handle(staff, "/w/*")).not.toContain("reverse_proxy");
    expect(staff.indexOf("handle /w/*")).toBeLessThan(staff.indexOf("handle /v1/*"));
  });

  it("answers /v1/public/* with the /w/* 404 on the staff site when WIDGET_ADDRESS is set, and only then", () => {
    expect(staff).toMatch(/@guest_api_off \{\s*expression `"\{\$WIDGET_ADDRESS:\}" != ""`\s*path \/v1\/public\/\*\s*\}/);
    const off = handle(staff, "@guest_api_off")!;
    expect(off).not.toContain("reverse_proxy");
    expect(off.match(/respond ".*" 404/)![0]).toBe(handle(staff, "/w/*")!.match(/respond ".*" 404/)![0]);
    // Before the /v1/* rule that forwards it, which stays for keyed routes and for a single-host install.
    expect(staff.indexOf("handle @guest_api_off")).toBeLessThan(staff.indexOf("handle /v1/*"));
    expect(handle(staff, "/v1/*")).toContain("reverse_proxy {$API_UPSTREAM:api:3000}");
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
    expect(widget).toMatch(/handle \{[^}]*respond "<!doctype html>.*" 404\s*\}/);
  });

  it("caps request bodies in both site blocks above the API's own limits", () => {
    const maxSize = (block: string) => /^\trequest_body \{\s*max_size (\S+)\s*\}/m.exec(block)?.[1];
    expect(maxSize(staff)).toBe("1MiB");
    expect(maxSize(widget)).toBe("64KiB");
  });

  it("proxies /favicon.ico on the widget site only, and the staff site never names it", () => {
    expect(handle(widget, "/favicon.ico")).toMatch(/^handle \/favicon\.ico \{\s*reverse_proxy \{\$API_UPSTREAM:api:3000\}\s*$/);
    expect(staff).not.toContain("favicon");
    expect(widget).toMatch(/handle \{[^}]*respond "<!doctype html>.*" 404\s*\}/);
  });

  it("proxies the self-service page /r on the widget site only, with the API's headers", () => {
    expect(handle(widget, "/r")).toMatch(/^handle \/r \{\s*reverse_proxy \{\$API_UPSTREAM:api:3000\}\s*$/);
    expect(handle(staff, "/r")).toMatch(/^handle \/r \{[\s\S]*respond ".*" 404$/);
    expect(staff.indexOf("handle /r {")).toBeLessThan(staff.indexOf("handle {"));
  });

  it("keeps the hosts out of search engines only when NOINDEX=on, and changes nothing otherwise", () => {
    for (const block of [staff, widget]) {
      expect(block).toContain('@noindex expression `"{$NOINDEX:off}" == "on"`');
      expect(block).toContain('header @noindex X-Robots-Tag "noindex, nofollow"');
      // Nothing sets the header without the matcher.
      expect(block.match(/X-Robots-Tag/g)).toHaveLength(1);
      const robots = handle(block, "@noindex_robots")!;
      expect(robots).toContain("respond `User-agent: *\nDisallow: /\n` 200");
      expect(robots).not.toContain("reverse_proxy");
      expect(block).toMatch(/@noindex_robots \{\s*expression `"\{\$NOINDEX:off\}" == "on"`\s*path \/robots\.txt\s*\}/);
      // robots.txt is answered before the staff app's catch-all and the 404 fallback.
      expect(block.indexOf("handle @noindex_robots")).toBeLessThan(block.indexOf("handle /w/*"));
    }
  });

  it("is switched on by the demo compose file and by no other", () => {
    const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "../../../", file), "utf8");
    expect(read("compose.demo.yaml")).toMatch(/^\s*NOINDEX: "on"$/m);
    expect(read("compose.prod.yaml")).not.toContain("NOINDEX");
  });
});
