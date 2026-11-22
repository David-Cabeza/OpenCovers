import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithApp } from "@/test/mock-api";
import { LanguageSelect } from "./language-select";

describe("LanguageSelect", () => {
  it("names the button starting with its visible code, so voice control finds it", () => {
    renderWithApp(<LanguageSelect />);
    const button = screen.getByRole("button", { name: /Language/ });
    const visible = button.textContent?.trim().toLowerCase() ?? "";
    expect(visible).not.toBe("");
    expect(button.getAttribute("aria-label")?.toLowerCase().startsWith(visible)).toBe(true);
  });
});
