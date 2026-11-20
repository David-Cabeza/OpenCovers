import { describe, expect, it } from "vitest";
import { notFoundHtml } from "../src/lib/widget-page.js";

describe("the widget not-found page", () => {
  it("is styled, titled, tells the guest what to do, and reads Spanish plus English by default", () => {
    const html = notFoundHtml();
    expect(html).toContain("<style>");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<h1>Esta dirección de reservas no existe</h1>");
    expect(html).toMatch(/llámalo directamente/);
    expect(html).toContain('lang="en"');
  });

  it("follows ?lang= first and Accept-Language second, for every widget locale", () => {
    expect(notFoundHtml("fr")).toContain('<html lang="fr">');
    expect(notFoundHtml("zz", "de-DE,de;q=0.9")).toContain('<html lang="de">');
    expect(notFoundHtml(undefined, "pt-PT")).toContain('<html lang="pt">');
    expect(notFoundHtml("en")).not.toContain('class="en"');
  });

  it("never reflects the input", () => {
    expect(notFoundHtml("<script>", "<script>")).not.toContain("<script>");
  });
});
