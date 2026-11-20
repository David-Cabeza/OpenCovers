import { describe, expect, it } from "vitest";
import { injectLegal } from "./legal.mjs";

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
