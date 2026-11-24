import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrigadaPage from "./BrigadaPage";
import { firstTimes, ranks } from "./brigada";
import { siteFileExists } from "./test-site";

describe("brigada page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 }))));
  });

  it("renders the eight Brigada tracks with label filters and never links a single issue", () => {
    const { container } = render(<BrigadaPage />);
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
    const { container } = render(<BrigadaPage />);
    const section = container.querySelector("#brigada")!;
    expect(section.getAttribute("aria-labelledby")).toBe("brigada-t");
    expect(screen.getByRole("heading", { level: 1, name: "La Brigada" })).toBeInTheDocument();
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

  it("has one h1, the nav marked as current, the ranks and the first-times wall", () => {
    const { container } = render(<BrigadaPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    const current = container.querySelectorAll("header a[aria-current='page']");
    expect(current.length).toBeGreaterThan(0);
    for (const a of current) expect(a).toHaveAttribute("href", "/brigada/");
    expect(container.querySelectorAll("dl.ranks > div")).toHaveLength(ranks.length);
    expect(ranks).toHaveLength(4);
    expect(firstTimes).toHaveLength(7);
    expect(container.querySelector("header a[href='/#features']")).not.toBeNull();
  });

  it("links only to site pages that exist", () => {
    const { container } = render(<BrigadaPage />);
    const paths = [...container.querySelectorAll("a, img, source")]
      .map((el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "")
      .filter((p) => p.startsWith("/") && p !== "/")
      .map((p) => p.split("#")[0])
      .filter(Boolean);
    expect(paths).toContain("/brigada/");
    for (const p of paths) expect(siteFileExists(p), p).toBe(true);
  });

  it("has one h1 and never skips a heading level", () => {
    const { container } = render(<BrigadaPage />);
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((l, i) => {
      if (i > 0) expect(l, `heading ${i} jumps from h${levels[i - 1]} to h${l}`).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
  });
});
