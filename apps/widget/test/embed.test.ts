import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

// public/embed.js runs on the venue's page. It is run here against a small fake of the few DOM calls it makes.

const source = readFileSync(path.resolve(import.meta.dirname, "../public/embed.js"), "utf8");
const WIDGET = "https://book.example.com";
const KEY = "pk_7Hc2AbCdEfGhIjKlMnOpQr";

interface FakeFrame {
  src: string;
  title: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  contentWindow: object | null;
  setAttribute(name: string, value: string): void;
}

let page: {
  inserted: { node: FakeFrame; before: unknown }[];
  listeners: ((event: unknown) => void)[];
  warnings: string[];
};

beforeEach(() => {
  page = { inserted: [], listeners: [], warnings: [] };
});

function scriptTag(attributes: Record<string, string>, src = `${WIDGET}/w/embed.js`) {
  const attrs = { ...attributes };
  const next = { name: "next sibling" };
  return {
    src,
    next,
    attrs,
    nextSibling: next,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name: string) => name in attrs,
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
    parentNode: {
      insertBefore: (node: FakeFrame, before: unknown) => page.inserted.push({ node, before }),
    },
  };
}

function run(script: ReturnType<typeof scriptTag> | null, pageLang?: string) {
  const document = {
    currentScript: script,
    documentElement: pageLang === undefined ? {} : { lang: pageLang },
    createElement: (tag: string): FakeFrame => {
      expect(tag).toBe("iframe");
      return {
        src: "",
        title: "",
        attributes: {},
        style: {},
        contentWindow: { name: "widget window" },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
  };
  const window = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      expect(type).toBe("message");
      page.listeners.push(listener);
    },
  };
  const console = { warn: (text: string) => page.warnings.push(text) };
  runInNewContext(source, { document, window, console, URL });
}

const post = (event: { origin: string; source: unknown; data: unknown }) => {
  for (const listener of page.listeners) listener(event);
};

describe("embed.js", () => {
  it("puts one iframe for the key right after its own tag, on the script's origin", () => {
    const script = scriptTag({ "data-key": KEY });
    run(script);
    expect(page.inserted).toHaveLength(1);
    const { node, before } = page.inserted[0];
    expect(before).toBe(script.next);
    expect(node.src).toBe(`${WIDGET}/w/${KEY}`);
    expect(node.title).toBe("Book a table");
    expect(node.attributes).toEqual({ loading: "lazy" });
    expect(node.style).toEqual({ display: "block", width: "100%", height: "640px", border: "0" });
  });

  it("asks the widget to follow the visitor's light or dark setting only for data-scheme=auto", () => {
    run(scriptTag({ "data-key": KEY, "data-scheme": "auto" }));
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}?scheme=auto`);
    for (const value of ["dark", "AUTO", "auto&x=1", '"><img>', ""]) {
      page.inserted.length = 0;
      run(scriptTag({ "data-key": KEY, "data-scheme": value }));
      expect(page.inserted[0].node.src, value).toBe(`${WIDGET}/w/${KEY}`);
    }
  });

  it("passes the host page's language when it is a supported code", () => {
    for (const [lang, code] of [["en", "en"], ["en-GB", "en"], ["ES_es", "es"], ["pt-BR", "pt"], ["CA", "ca"]]) {
      page.inserted.length = 0;
      run(scriptTag({ "data-key": KEY }), lang);
      expect(page.inserted[0].node.src, lang).toBe(`${WIDGET}/w/${KEY}?lang=${code}`);
    }
  });

  it("adds no lang for an unsupported, empty or missing page language", () => {
    for (const lang of ["ja", "", "zh-Hans", "eng", "e", "-en", undefined]) {
      page.inserted.length = 0;
      run(scriptTag({ "data-key": KEY }), lang);
      expect(page.inserted[0].node.src, String(lang)).toBe(`${WIDGET}/w/${KEY}`);
    }
  });

  it("lets data-lang beat the page language, and falls back to the page when it is invalid", () => {
    run(scriptTag({ "data-key": KEY, "data-lang": "fr" }), "en");
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}?lang=fr`);
    page.inserted.length = 0;
    run(scriptTag({ "data-key": KEY, "data-lang": "klingon" }), "en-GB");
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}?lang=en`);
    page.inserted.length = 0;
    run(scriptTag({ "data-key": KEY, "data-lang": "xx" }), "ja");
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}`);
  });

  it("never lets hostile language text reach the URL", () => {
    const hostile = ['en"><script>', "en&x=1", "en/../x", `${"a".repeat(5000)}`, "de?x=1#y"];
    for (const value of hostile) {
      page.inserted.length = 0;
      run(scriptTag({ "data-key": KEY, "data-lang": value }), value);
      const src = page.inserted[0].node.src;
      expect(src, value.slice(0, 20)).toMatch(/^https:\/\/book\.example\.com\/w\/pk_[A-Za-z0-9_-]+(\?lang=[a-z]{2})?$/);
    }
    page.inserted.length = 0;
    run(scriptTag({ "data-key": KEY }), "en&x=1");
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}`);
  });

  it("sends both scheme and lang when both apply", () => {
    run(scriptTag({ "data-key": KEY, "data-scheme": "auto" }), "en-US");
    expect(page.inserted[0].node.src).toBe(`${WIDGET}/w/${KEY}?scheme=auto&lang=en`);
  });

  it("takes the title from data-title", () => {
    run(scriptTag({ "data-key": KEY, "data-title": "Book a table" }));
    expect(page.inserted[0].node.title).toBe("Book a table");
  });

  it("adds nothing for a missing or malformed data-key", () => {
    for (const key of [undefined, "", "sk_7Hc2AbCdEfGhIjKlMnOpQr", `${KEY}/../x`, `${KEY}?a=b`, "pk_short", `"><img>`]) {
      run(scriptTag(key === undefined ? {} : { "data-key": key }));
    }
    expect(page.inserted).toHaveLength(0);
    expect(page.listeners).toHaveLength(0);
    expect(page.warnings).toHaveLength(7);
  });

  it("does nothing without a current script, or when the same tag runs again", () => {
    run(null);
    const script = scriptTag({ "data-key": KEY });
    run(script);
    run(script);
    expect(page.inserted).toHaveLength(1);
  });

  it("sets the height from a message of the widget's origin, from its own iframe, of the exact shape", () => {
    run(scriptTag({ "data-key": KEY }));
    const frame = page.inserted[0].node;
    const from = (data: unknown, origin = WIDGET, source: unknown = frame.contentWindow) => post({ origin, source, data });

    from({ type: "opencovers:height", height: 812.4 });
    expect(frame.style.height).toBe("813px");

    from({ type: "opencovers:height", height: 300 }, "https://evil.example");
    from({ type: "opencovers:height", height: 300 }, "http://book.example.com");
    from({ type: "opencovers:height", height: 300 }, WIDGET, { name: "another window" });
    from({ type: "opencovers:height", height: 300 }, WIDGET, null);
    from({ type: "opencovers:height", height: 300, guest: "x" });
    from({ type: "opencovers:size", height: 300 });
    from({ type: "opencovers:height", height: "300" });
    from({ type: "opencovers:height" });
    from({ height: 300 });
    from(["opencovers:height", 300]);
    from("opencovers:height:300");
    from(300);
    from(null);
    from({ type: "opencovers:height", height: Number.NaN });
    from({ type: "opencovers:height", height: Number.POSITIVE_INFINITY });
    from({ type: "opencovers:height", height: -5 });
    expect(frame.style.height).toBe("813px");
  });

  it("clamps a height to 100 to 6000 pixels", () => {
    run(scriptTag({ "data-key": KEY }));
    const frame = page.inserted[0].node;
    post({ origin: WIDGET, source: frame.contentWindow, data: { type: "opencovers:height", height: 1e12 } });
    expect(frame.style.height).toBe("6000px");
    post({ origin: WIDGET, source: frame.contentWindow, data: { type: "opencovers:height", height: 0 } });
    expect(frame.style.height).toBe("100px");
  });

  it("ignores messages once its iframe has left the page", () => {
    run(scriptTag({ "data-key": KEY }));
    const frame = page.inserted[0].node;
    frame.contentWindow = null;
    post({ origin: WIDGET, source: null, data: { type: "opencovers:height", height: 900 } });
    expect(frame.style.height).toBe("640px");
  });

  it("keeps two widgets on one page apart", () => {
    const other = "pk_ZZZZZZZZZZZZZZZZZZZZZZ";
    run(scriptTag({ "data-key": KEY }));
    run(scriptTag({ "data-key": other }));
    const [a, b] = page.inserted.map((entry) => entry.node);
    expect([a.src, b.src]).toEqual([`${WIDGET}/w/${KEY}`, `${WIDGET}/w/${other}`]);

    post({ origin: WIDGET, source: b.contentWindow, data: { type: "opencovers:height", height: 1200 } });
    expect([a.style.height, b.style.height]).toEqual(["640px", "1200px"]);
  });
});
