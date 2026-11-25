import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";

// A width breakpoint cannot tell a tablet from a laptop, so control height follows the pointer too.
describe("touch targets", () => {
  it("declares the coarse variant as a pointer media query", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../index.css"), "utf8");
    expect(css).toContain("@custom-variant coarse (@media (pointer: coarse));");
  });

  it.each(["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const)("lifts the %s button to 44 px on a coarse pointer", (size) => {
    expect(buttonVariants({ size })).toMatch(/coarse:(h|size)-11/);
  });
});
