import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { injectLegal, stripComments } from "./legal.mjs";

const page = "<p>NIF {{LEGAL_TAX_ID}}</p><p>{{LEGAL_ADDRESS}}</p><p>{{LEGAL_ADDRESS}}</p>";

describe("injectLegal", () => {
  it("replaces every occurrence of each token", () => {
    const r = injectLegal(page, { LEGAL_TAX_ID: "X1", LEGAL_ADDRESS: "Calle A 1" });
    expect(r.html).toBe("<p>NIF X1</p><p>Calle A 1</p><p>Calle A 1</p>");
    expect(r.missing).toEqual([]);
  });

  it("escapes HTML in a value", () => {
    const r = injectLegal("{{LEGAL_ADDRESS}}", { LEGAL_ADDRESS: '<b>"A" & B</b>' });
    expect(r.html).toBe("&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;");
  });

  it("reports a token with no value, or a blank one, and leaves it in place", () => {
    const r = injectLegal(page, { LEGAL_TAX_ID: "  " });
    expect(r.missing).toEqual(["{{LEGAL_TAX_ID}}", "{{LEGAL_ADDRESS}}"]);
    expect(r.html).toBe(page);
  });

  it("leaves a page without tokens untouched", () => {
    expect(injectLegal("<p>hi</p>", {})).toEqual({ html: "<p>hi</p>", missing: [] });
  });

  it("does not re-expand a token that a value contains", () => {
    const r = injectLegal("{{LEGAL_TAX_ID}}{{LEGAL_ADDRESS}}", { LEGAL_TAX_ID: "{{LEGAL_ADDRESS}}", LEGAL_ADDRESS: "A" });
    expect(r.html).toBe("{{LEGAL_ADDRESS}}A");
  });
});

describe("stripComments", () => {
  it("removes single and multi-line comments and keeps the rest", () => {
    expect(stripComments("<p>a</p><!-- x -->\n<!--\n  Pendiente: contrato\n-->\n<p>b</p>")).toBe("<p>a</p>\n\n<p>b</p>");
  });
});

describe("security.txt", () => {
  it("has a contact and an expiry more than 30 days away", async () => {
    const txt = await readFile(path.resolve(import.meta.dirname, "../public/.well-known/security.txt"), "utf8");
    expect(txt).toMatch(/^Contact: https:\/\//m);
    const expires = txt.match(/^Expires: (.+)$/m)?.[1];
    expect(expires).toBeDefined();
    expect(new Date(expires).getTime()).toBeGreaterThan(Date.now() + 30 * 24 * 3600 * 1000);
  });
});
