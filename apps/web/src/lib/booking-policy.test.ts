import { describe, expect, it } from "vitest";
import { formatBlockedDates, parseForm, toForm, type BookingPolicyForm } from "./booking-policy";

const EMPTY: BookingPolicyForm = { maxAdvanceDays: "", maxActivePerGuestPerDay: "", blockedDates: "" };

function ok(form: Partial<BookingPolicyForm>) {
  const result = parseForm({ ...EMPTY, ...form });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.policy;
}

function errors(form: Partial<BookingPolicyForm>) {
  const result = parseForm({ ...EMPTY, ...form });
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("parseForm", () => {
  it("turns empty fields into null and an empty list", () => {
    expect(ok({})).toEqual({ maxAdvanceDays: null, maxActivePerGuestPerDay: null, blockedDates: [] });
  });

  it("accepts the limits and rejects values outside them", () => {
    expect(ok({ maxAdvanceDays: "0" }).maxAdvanceDays).toBe(0);
    expect(ok({ maxAdvanceDays: "1000" }).maxAdvanceDays).toBe(1000);
    expect(ok({ maxActivePerGuestPerDay: "1" }).maxActivePerGuestPerDay).toBe(1);
    expect(ok({ maxActivePerGuestPerDay: "100" }).maxActivePerGuestPerDay).toBe(100);
    for (const v of ["1001", "-1", "2.5", "abc"]) {
      expect(errors({ maxAdvanceDays: v }).maxAdvanceDays).toBeDefined();
    }
    for (const v of ["0", "101", "1.5"]) {
      expect(errors({ maxActivePerGuestPerDay: v }).maxActivePerGuestPerDay).toBeDefined();
    }
  });

  it("parses days and ranges, sorted and merged", () => {
    const policy = ok({
      blockedDates: "2026-12-26\n2026-12-24..2026-12-25\n2026-12-25\n2027-01-05 to 2027-01-06, 2026-12-01",
    });
    expect(policy.blockedDates).toEqual([
      { from: "2026-12-01", to: "2026-12-01" },
      { from: "2026-12-24", to: "2026-12-26" },
      { from: "2027-01-05", to: "2027-01-06" },
    ]);
  });

  it("rejects impossible dates, reversed ranges and junk", () => {
    for (const v of ["2026-02-30", "2026-13-01", "25/12/2026", "2026-12-25..2026-12-24", "a..b..c"]) {
      expect(errors({ blockedDates: v }).blockedDates).toBeDefined();
    }
  });

  it("rejects more than 366 entries", () => {
    const days = Array.from({ length: 367 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10),
    ).join("\n");
    expect(errors({ blockedDates: days }).blockedDates).toMatch(/366/);
  });
});

describe("toForm", () => {
  it("shows null as empty and the list merged and sorted", () => {
    const form = toForm({
      maxAdvanceDays: null,
      maxActivePerGuestPerDay: 2,
      blockedDates: [
        { from: "2026-12-25", to: "2026-12-26" },
        { from: "2026-12-24", to: "2026-12-24" },
      ],
    });
    expect(form).toEqual({
      maxAdvanceDays: "",
      maxActivePerGuestPerDay: "2",
      blockedDates: "2026-12-24..2026-12-26",
    });
  });

  it("round-trips through parseForm", () => {
    const policy = {
      maxAdvanceDays: 90,
      maxActivePerGuestPerDay: 3,
      blockedDates: [
        { from: "2026-12-24", to: "2026-12-26" },
        { from: "2027-03-01", to: "2027-03-01" },
      ],
    };
    expect(ok(toForm(policy))).toEqual(policy);
    expect(formatBlockedDates([])).toBe("");
  });
});
