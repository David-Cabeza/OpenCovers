import { readFileSync } from "node:fs";
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
