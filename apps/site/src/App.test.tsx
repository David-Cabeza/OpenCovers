import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("public site", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 }))),
    );
  });

  it("presents the product with a way to start and a link to the repository", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Tu libro de reservas es tuyo" }),
    ).toBeInTheDocument();
    const start = screen.getByRole("link", { name: "Empieza ahora" });
    expect(start).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/David-Cabeza/OpenCovers"),
    );
  });

  it("renders the roadmap, the FAQ and the closing call to action", () => {
    const { container } = render(<App />);

    expect(screen.getByRole("heading", { name: "Hoja de ruta" })).toBeInTheDocument();
    for (const id of ["features", "motor", "hoja-de-ruta", "faq", "empezar"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
  });
});

describe("custom domain", () => {
  it("keeps CNAME pointing at opencovers.dev", () => {
    const cname = readFileSync(resolve(process.cwd(), "public/CNAME"), "utf8");
    expect(cname.trim()).toBe("opencovers.dev");
  });
});

describe("discoverability", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

  it("ships an English page with canonical and hreflang alternates", () => {
    const html = read("public/en/index.html");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<link rel="canonical" href="https://opencovers.dev/en/" />');
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"/);
    for (const page of [html, read("index.html")]) {
      expect(page).toContain('hreflang="es" href="https://opencovers.dev/"');
      expect(page).toContain('hreflang="en" href="https://opencovers.dev/en/"');
      expect(page).toContain('hreflang="x-default" href="https://opencovers.dev/"');
    }
  });

  it("lists the English page in the sitemap and lets robots crawl everything", () => {
    expect(read("public/sitemap.xml")).toContain("<loc>https://opencovers.dev/en/</loc>");
    expect(read("public/robots.txt")).toMatch(/^Allow: \/$/m);
  });

  it("publishes an llms.txt whose links are absolute https URLs or existing paths", () => {
    const text = read("public/llms.txt");
    expect(text.startsWith("# OpenCovers\n")).toBe(true);
    expect(text).toMatch(/^> .+/m);
    const urls = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(5);
    expect(urls).toContain("https://opencovers.dev/en/");
    for (const url of urls) {
      if (url.startsWith("https://")) continue;
      expect(url.startsWith("/"), url).toBe(true);
      expect(existsSync(resolve(process.cwd(), "public", url.slice(1))), url).toBe(true);
    }
  });

  it("points every repository doc link at a file that exists", () => {
    const base = "https://github.com/David-Cabeza/OpenCovers/";
    const text = read("public/llms.txt") + read("public/en/index.html");
    const links = [...text.matchAll(/https:\/\/github\.com\/David-Cabeza\/OpenCovers\/(?:blob|tree)\/main\/([^)"\s]+)/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, path] of links) {
      expect(existsSync(resolve(process.cwd(), "../..", path)), base + path).toBe(true);
    }
  });
});
