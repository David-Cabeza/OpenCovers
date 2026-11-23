import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoadmapPage from "./RoadmapPage";
import { commitments } from "./roadmap";
import { siteFileExists } from "./test-site";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("roadmap page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 }))),
    );
  });

  it("renders the whole roadmap with the nav marked as current", () => {
    const { container } = render(<RoadmapPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Hoja de ruta 2027" })).toBeInTheDocument();
    for (const id of ["hoja-de-ruta", "locales-fundadores"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    for (const name of ["La Prueba del Doble", "Primer Servicio", "Sin el Autor"]) {
      expect(screen.getByRole("heading", { name }), name).toBeInTheDocument();
    }
    const current = container.querySelectorAll("header a[aria-current='page']");
    expect(current.length).toBeGreaterThan(0);
    for (const a of current) expect(a).toHaveAttribute("href", "/hoja-de-ruta/");
    // Off the home, the other nav items point back to it.
    expect(container.querySelector("header a[href='/#features']")).not.toBeNull();
  });

  it("links only to site pages that exist", () => {
    const { container } = render(<RoadmapPage />);
    const paths = [...container.querySelectorAll("a, img, source")]
      .map((el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "")
      .filter((p) => p.startsWith("/") && p !== "/")
      .map((p) => p.split("#")[0])
      .filter(Boolean);
    expect(paths).toContain("/hoja-de-ruta/");
    for (const p of paths) expect(siteFileExists(p), p).toBe(true);
  });

  it("shows every 2027 commitment, the counters at zero and the rule that failures stay", () => {
    const { container } = render(<RoadmapPage />);
    const rows = [...container.querySelectorAll("table.commit tbody tr")];
    expect(rows.map((r) => r.id)).toEqual(commitments.map((c) => c.id.toLowerCase()));
    expect(commitments.map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `C${i + 1}`));
    for (const c of commitments) {
      const row = container.querySelector(`#${c.id.toLowerCase()}`)!;
      expect(row.textContent).toContain(c.title);
      expect(row.textContent).toContain(c.state);
      expect(row.textContent).toContain(c.ifMissed);
    }
    const counts = [...container.querySelectorAll(".counters li")].map((li) => li.querySelector(".v")?.textContent);
    expect(counts).toEqual(["0", "0", "0"]);
    expect(screen.getByText(/0 de 10/)).toBeInTheDocument();
    expect(screen.getByText(/Un compromiso fallado se queda en el cuadro/)).toBeInTheDocument();
    expect(container.querySelector("table.commit caption")).not.toBeNull();
    for (const th of container.querySelectorAll("table.commit thead th")) expect(th).toHaveAttribute("scope", "col");
  });

  it("marks a commitment as done only with proof, and never drops a commitment", () => {
    for (const c of commitments.filter((x) => x.state === "cumplido")) {
      expect(c.evidence.length, c.id).toBeGreaterThan(0);
      for (const e of c.evidence) expect(e.href, c.id).toMatch(/^https:\/\//);
    }
  });

  it("collects no personal data in the founding venues section", () => {
    const { container } = render(<RoadmapPage />);
    const section = container.querySelector("#locales-fundadores")!;
    expect(section.querySelector("form, input, textarea, a[href^='mailto:']")).toBeNull();
  });
});

describe("entry pages", () => {
  const entries = ["index.html", "hoja-de-ruta/index.html"];
  const csp = (html: string) => html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0];
  const inline = (html: string) => html.match(/<script>[^<]*<\/script>/)?.[0];

  it("carry the same CSP and the same inline script, so one hash covers both", () => {
    const [home, ...others] = entries.map(read);
    expect(csp(home)).toBeDefined();
    expect(inline(home)).toBeDefined();
    for (const html of others) {
      expect(csp(html)).toBe(csp(home));
      expect(inline(html)).toBe(inline(home));
    }
  });

  it("gives the roadmap page its own canonical URL and no language alternates", () => {
    const html = read("hoja-de-ruta/index.html");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<link rel="canonical" href="https://opencovers.dev/hoja-de-ruta/" />');
    expect(html).toContain('<meta property="og:url" content="https://opencovers.dev/hoja-de-ruta/" />');
    expect(html).not.toContain("hreflang");
    expect(html).toContain("<title>Hoja de ruta 2027 · OpenCovers</title>");
  });

  it("lists the roadmap page in the sitemap, the Vite inputs and the prerender list", () => {
    expect(read("public/sitemap.xml")).toContain("<loc>https://opencovers.dev/hoja-de-ruta/</loc>");
    expect(read("vite.config.ts")).toContain("hoja-de-ruta/index.html");
    expect(read("scripts/pages.mjs")).toContain("hoja-de-ruta/index.html");
  });
});
