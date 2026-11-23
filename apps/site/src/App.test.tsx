import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { siteFileExists } from "./test-site";
import { counters } from "./roadmap";

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
    expect(
      screen.getByText("Motor de reservas open source para restaurantes, con API y servidor MCP."),
    ).toHaveClass("lead");
    const start = screen.getByRole("link", { name: "Empieza ahora" });
    expect(start).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/David-Cabeza/OpenCovers"),
    );
  });

  it("renders the eight Brigada tracks with label filters and never links a single issue", () => {
    const { container } = render(<App />);
    const section = container.querySelector("#brigada")!;
    const repo = "https://github.com/David-Cabeza/OpenCovers";
    const cards = [...section.querySelectorAll("ul.tracks > li")];
    expect(cards.map((li) => li.querySelector(".n")?.textContent)).toEqual(
      ["Motor", "Sala digital", "Idiomas", "Pruebas", "Guías", "Sala", "Agentes", "Legal"],
    );
    const labels = ["track:backend", "track:front", "track:i18n", "track:qa", "track:docs", "track:floor", "agent-ok"];
    labels.forEach((label, i) => {
      const href = cards[i].querySelector("a")!.getAttribute("href")!;
      expect(href.startsWith(`${repo}/issues?q=`)).toBe(true);
      const q = decodeURIComponent(href.split("?q=")[1]);
      expect(q).toContain("label:brigada");
      expect(q).toContain(label);
    });
    // Legal has no public task list and no mailbox meant for it: plain text, no link.
    expect(cards[7].querySelector("a")).toBeNull();
    const hrefs = [...section.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => /\/issues\/\d+/.test(h))).toBe(false);
    expect(hrefs.some((h) => h.startsWith("mailto:"))).toBe(false);
  });

  it("states the real status in the Brigada section and heads it accessibly", () => {
    const { container } = render(<App />);
    const section = container.querySelector("#brigada")!;
    expect(section.getAttribute("aria-labelledby")).toBe("brigada-t");
    expect(screen.getByRole("heading", { level: 2, name: "La Brigada" })).toBeInTheDocument();
    const text = section.textContent ?? "";
    expect(text).toContain("pre-alfa");
    expect(text).toContain("Lo mantiene una persona");
    expect(text).toContain("agentes de IA");
    expect(text).toContain("Objetivo: primera respuesta de una persona en 48 horas");
    for (const cmd of ["docker compose up -d", "pnpm install", "pnpm db:migrate", "pnpm dev", "pnpm test"]) {
      expect(text).toContain(cmd);
    }
    for (const rank of ["Comensal", "Cocinero", "Jefe de partida", "Segundo de cocina"]) expect(text).toContain(rank);
  });

  it("points every README anchor at a heading the README has", () => {
    const { container } = render(<App />);
    const readme = readFileSync(resolve(process.cwd(), "../../README.md"), "utf8");
    const slugs = [...readme.matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
      m[1].toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-"),
    );
    const anchors = [...container.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("https://github.com/David-Cabeza/OpenCovers#"));
    expect(anchors.length).toBeGreaterThan(0);
    for (const href of anchors) {
      expect(slugs, href).toContain(href.split("#")[1]);
    }
  });

  it("links only to site pages that exist", () => {
    const { container } = render(<App />);
    const paths = [...container.querySelectorAll("a, img, source")]
      .map((el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "")
      .filter((p) => p.startsWith("/") && p !== "/"); // "/" is the page itself (the brand link)
    expect(paths).toEqual(expect.arrayContaining(["/privacidad.html", "/condiciones.html", "/en/", "/hoja-de-ruta/"]));
    for (const p of paths) expect(siteFileExists(p), p).toBe(true);
  });

  it("renders the FAQ, the closing call to action and a roadmap summary that links to the page", () => {
    const { container } = render(<App />);

    expect(screen.getByRole("heading", { name: "Hoja de ruta 2027" })).toBeInTheDocument();
    for (const id of ["features", "motor", "hoja-de-ruta", "faq", "empezar"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    const roadmap = container.querySelector("#hoja-de-ruta")!;
    expect(roadmap.querySelectorAll("a[href='/hoja-de-ruta/']")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Ver la hoja de ruta 2027" })).toHaveAttribute("href", "/hoja-de-ruta/");
  });

  it("keeps the three counters, with their floor and notes, and none of the commitment table on the home", () => {
    const { container } = render(<App />);
    expect(container.querySelector("table.commit")).toBeNull();
    expect(container.querySelector("#locales-fundadores")).toBeNull();
    const counts = [...container.querySelectorAll("#hoja-de-ruta .counters li")];
    expect(counts.map((li) => li.querySelector(".v")?.textContent)).toEqual(["0", "0", "0"]);
    for (const [i, c] of counters.entries()) {
      expect(counts[i].textContent).toContain(`objetivo ${c.goal} · suelo ${c.floor}`);
      if (c.note) expect(counts[i].textContent).toContain(c.note);
    }
  });
});

describe("hosted demo link", () => {
  const live = "https://demo.opencovers.dev";

  async function renderWith(url: string) {
    vi.resetModules();
    vi.doMock("../demo.json", () => ({ default: { url } }));
    const { default: Fresh } = await import("./App");
    return render(<Fresh />);
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 }))));
  });

  it("ships off or pointing at the live demo, nothing else", () => {
    const file = JSON.parse(readFileSync(resolve(process.cwd(), "demo.json"), "utf8"));
    expect(["", live]).toContain(file.url);
  });

  it("shows no demo button while the switch is empty", async () => {
    await renderWith("");
    expect(screen.queryByRole("link", { name: "Probar la demo" })).toBeNull();
    expect(screen.getByRole("link", { name: "Empieza ahora" })).toBeInTheDocument();
  });

  it("explains the demo in the hero only when the switch is set", async () => {
    const line = /^La demo te da un restaurante de prueba con datos inventados/;
    const off = await renderWith("");
    expect(screen.queryByText(line)).toBeNull();
    off.unmount();
    await renderWith(live);
    expect(screen.getByText(line)).toHaveTextContent("con Google y se borra a los 14 días sin uso");
  });

  it("shows the Spanish button with the demo URL when the switch is set", async () => {
    await renderWith(live);
    const links = screen.getAllByRole("link", { name: "Probar la demo" });
    // One in the header and one in the hero.
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", live);
  });

  it("keeps a marker in the English page for the build to fill", () => {
    const html = readFileSync(resolve(process.cwd(), "public/en/index.html"), "utf8");
    expect(html).toContain("<!--demo-link-->");
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

describe("demo video", () => {
  it("does not load or start on its own", () => {
    render(<App />);
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("preload", "none");
    expect(screen.getByRole("button", { name: "Reproducir vídeo" })).toBeInTheDocument();
  });
});

describe("GitHub star count", () => {
  const stubStars = (n: number) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: n }))));

  it("makes one request for both buttons and stores nothing in the browser", async () => {
    stubStars(80);
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /GitHub, 80/ }).length).toBe(2));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("hides the count and the number in the aria-label below 50 stars", async () => {
    stubStars(2);
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    const buttons = screen.getAllByRole("link", { name: "GitHub" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.querySelector(".stars")).toBeNull();
    expect(screen.queryByRole("link", { name: /estrellas/ })).toBeNull();
  });

  it("shows the count and a matching aria-label from 50 stars", async () => {
    stubStars(50);
    render(<App />);
    const buttons = await screen.findAllByRole("link", { name: "GitHub, 50 estrellas" });
    for (const b of buttons) expect(b.querySelector(".stars")).toHaveTextContent("50");
  });
});
