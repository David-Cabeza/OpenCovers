import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyTheme, applyThemeToDocument, FONT_STACKS, isFramed, logoSrc, setsColors, themeVars } from "../src/theme";
import { Logo, VenueHeader } from "../src/ui";

const css = readFileSync(path.resolve(import.meta.dirname, "../src/styles.css"), "utf8");

function applied(theme: unknown): Record<string, string> {
  const set: Record<string, string> = {};
  applyTheme(theme, { setProperty: (name: string, value: string | null) => void (set[name] = value ?? "") });
  return set;
}

describe("theme tokens", () => {
  it("maps every valid key to its CSS custom property", () => {
    expect(
      applied({
        colors: {
          primary: "#AA0000",
          onPrimary: "#ffffff",
          background: "#fafafa",
          surface: "#eeeeee",
          text: "#111111",
          muted: "#555555",
          border: "#cccccc",
        },
        radius: 0,
        font: "serif",
        logoUrl: "https://example.com/l.png",
      }),
    ).toEqual({
      "--oc-primary": "#aa0000",
      "--oc-on-primary": "#ffffff",
      "--oc-background": "#fafafa",
      "--oc-surface": "#eeeeee",
      "--oc-text": "#111111",
      "--oc-muted": "#555555",
      "--oc-border": "#cccccc",
      "--oc-radius": "0px",
      "--oc-font": FONT_STACKS.serif,
    });
  });

  it("sets nothing for an absent key, so the stylesheet default stays", () => {
    expect(applied({})).toEqual({});
    expect(applied(undefined)).toEqual({});
    expect(applied({ radius: 24 })).toEqual({ "--oc-radius": "24px" });
  });

  it("drops every value that fails the rules, and never passes a venue string through", () => {
    const hostile = {
      colors: {
        primary: "red; background:url(https://evil.example/x)",
        background: "#ffffff;}body{display:none",
        text: "var(--oc-primary)",
        muted: "#12345",
        border: 0x123456,
        __proto__: "#000000",
        accent: "#000000",
      },
      radius: "8px; position:fixed",
      font: "serif; } body { background: red",
      css: "body{}",
      logoUrl: "javascript:alert(1)",
    };
    expect(applied(hostile)).toEqual({});
    expect(applied({ radius: 25 })).toEqual({});
    expect(applied({ radius: 1.5 })).toEqual({});
    expect(applied({ font: "toString" })).toEqual({});
    expect(applied({ colors: ["#000000"] })).toEqual({});
    expect(applied("dark")).toEqual({});
    for (const [, value] of themeVars({ colors: { text: "#000000" }, radius: 4, font: "rounded" })) {
      expect(value).not.toMatch(/[;{}<>]|url\(/);
    }
  });

  it("keeps the system font equal to the stylesheet default", () => {
    expect(css).toContain(`--oc-font: ${FONT_STACKS.system};`);
  });
});

describe("logo", () => {
  it("accepts https only, with a host and no credentials", () => {
    expect(logoSrc({ logoUrl: "https://cdn.example.com/logo.png?v=2" })).toBe("https://cdn.example.com/logo.png?v=2");
    for (const logoUrl of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "http://example.com/l.png",
      "//example.com/l.png",
      "https://user:pw@example.com/l.png",
      " https://example.com/l.png",
      "https://example.com/l.png\n",
      `https://example.com/${"a".repeat(2048)}`,
      "not a url",
      42,
    ]) {
      expect(logoSrc({ logoUrl }), String(logoUrl)).toBeNull();
    }
  });

  it("renders an img with alt text and no referrer, escaped by React", () => {
    const html = renderToStaticMarkup(
      createElement(Logo, { theme: { logoUrl: 'https://example.com/l.png?a="><script>' }, venue: 'Casa "Alba"' }),
    );
    const img = html.slice(html.indexOf("<img "));
    expect(img).toContain('src="https://example.com/l.png?a=%22%3E%3Cscript%3E"');
    expect(img).toContain('referrerPolicy="no-referrer"');
    expect(img).toContain('alt="Casa &quot;Alba&quot;"');
    expect(html).not.toContain("<script>");
  });

  it("renders nothing without a valid logo", () => {
    expect(renderToStaticMarkup(createElement(Logo, { theme: { logoUrl: "javascript:alert(1)" }, venue: "Casa" }))).toBe("");
    expect(renderToStaticMarkup(createElement(Logo, { theme: {}, venue: "Casa" }))).toBe("");
  });

  it("gives the logo an empty alt when the venue name is text beside it", () => {
    const venue = { name: "Casa Alba", phone: null, theme: { logoUrl: "https://example.com/l.png" } };
    const html = renderToStaticMarkup(createElement(VenueHeader, { venue }));
    expect(html).toContain('alt=""');
    expect(html).toContain("Casa Alba</p>");
    expect(html).not.toContain('alt="Casa Alba"');
  });

  it("keeps the venue name as alt when no name is rendered next to the logo", () => {
    const html = renderToStaticMarkup(createElement(Logo, { theme: { logoUrl: "https://example.com/l.png" }, venue: "Casa Alba" }));
    expect(html).toContain('alt="Casa Alba"');
  });
});

describe("dark mode", () => {
  const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));

  it("has dark defaults only for the widget's own pages", () => {
    expect(darkBlock).toContain(':root[data-scheme="system"]');
    for (const name of ["primary", "on-primary", "background", "surface", "text", "muted", "border", "danger"]) {
      expect(darkBlock, name).toContain(`--oc-${name}:`);
    }
    expect(darkBlock).toContain("color-scheme: dark");
  });

  it("counts a theme as setting colors only when it sets a valid color", () => {
    expect(setsColors(undefined)).toBe(false);
    expect(setsColors({})).toBe(false);
    expect(setsColors({ radius: 4, font: "serif", logoUrl: "https://example.com/l.png" })).toBe(false);
    expect(setsColors({ colors: {} })).toBe(false);
    expect(setsColors({ colors: { primary: "not a color" } })).toBe(false);
    expect(setsColors({ colors: { primary: "#aa0000" } })).toBe(true);
    expect(setsColors({ colors: { background: "#ffffff" } })).toBe(true);
  });

  it("tells a framed page from a top-level one", () => {
    const top = {} as Window;
    expect(isFramed({ self: top, top })).toBe(false);
    expect(isFramed({ self: {} as Window, top })).toBe(true);
  });

  function docFor(scheme: string | undefined) {
    const set: Record<string, string> = {};
    const dataset: DOMStringMap = scheme ? { scheme } : {};
    const documentElement = {
      style: { setProperty: (n: string, v: string | null) => void (set[n] = v ?? "") },
      dataset,
    } as unknown as HTMLElement;
    return { doc: { documentElement } as Pick<Document, "documentElement">, set, dataset };
  }

  it("keeps following the system when the theme sets no color", () => {
    const { doc, set, dataset } = docFor("system");
    applyThemeToDocument({ radius: 4 }, doc);
    expect(set).toEqual({ "--oc-radius": "4px" });
    expect(dataset.scheme).toBe("system");
  });

  it("stops following the system when the theme sets a color", () => {
    const { doc, set, dataset } = docFor("system");
    applyThemeToDocument({ colors: { primary: "#aa0000" } }, doc);
    expect(set).toEqual({ "--oc-primary": "#aa0000" });
    expect(dataset.scheme).toBeUndefined();
  });
});
