import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { parseForm } from "./booking-policy";

describe("booking policy validation in Spanish", () => {
  beforeEach(() => useUiStore.setState({ locale: "es" }));
  afterEach(() => useUiStore.setState({ locale: "en" }));

  it("explains each problem in Spanish", () => {
    const result = parseForm({ maxAdvanceDays: "abc", maxActivePerGuestPerDay: "0", blockedDates: "2026-13-40" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.maxAdvanceDays).toBe(
      "Los días de antelación deben ser un número entero de 0 a 1000, o vacío para desactivar la regla.",
    );
    expect(result.errors.maxActivePerGuestPerDay).toContain("Las reservas por cliente y día");
    expect(result.errors.blockedDates).toContain("no es una fecha válida");
    expect(result.errors.blockedDates).not.toContain("is not");
  });
});
