import { describe, expect, it } from "vitest";
import type { PublicDay } from "../src/api";
import { dateAfterPartyChange, isSelectable, nextFreeDay, pageBounds, startFor, STRIP_DAYS, visibleDays } from "../src/strip";

const day = (date: string, status: PublicDay["status"]): PublicDay => ({
  date,
  status,
  firstTime: status === "available" ? "20:00" : null,
});

const days = [
  day("2026-11-19", "full"),
  day("2026-11-20", "available"),
  day("2026-11-21", "closed"),
  day("2026-11-22", "available"),
  day("2026-11-23", "outside_window"),
];

describe("the strip's days", () => {
  it("draws every status but outside_window", () => {
    expect(visibleDays(days).map((d) => d.status)).toEqual(["full", "available", "closed", "available"]);
  });

  it("lets a guest pick an available or a full day, not a closed one", () => {
    expect(days.map(isSelectable)).toEqual([true, true, false, true, false]);
  });

  it("finds the next free day after the selected one, else the first free day of the strip", () => {
    expect(nextFreeDay(days, "2026-11-19")).toBe("2026-11-20");
    expect(nextFreeDay(days, "2026-11-20")).toBe("2026-11-22");
    expect(nextFreeDay(days, "2026-11-22")).toBe("2026-11-20");
    expect(nextFreeDay([day("2026-11-19", "full")], "2026-11-19")).toBeNull();
  });

  it("keeps the date after a party change while it can be picked, else moves to the first free day", () => {
    expect(dateAfterPartyChange(days, "2026-11-19")).toBe("2026-11-19");
    expect(dateAfterPartyChange(days, "2026-11-21")).toBe("2026-11-20");
    expect(dateAfterPartyChange(days, "2027-01-01")).toBe("2027-01-01");
    expect(dateAfterPartyChange([day("2026-11-21", "closed")], "2026-11-21")).toBe("2026-11-21");
  });
});

describe("paging", () => {
  const today = "2026-11-19";

  it("has no previous page at today, and a next page of 12 days", () => {
    expect(pageBounds({ from: today, today })).toEqual({ prev: null, next: "2026-12-01" });
    expect(STRIP_DAYS).toBe(12);
  });

  it("goes back by 12 days but never before today", () => {
    expect(pageBounds({ from: "2026-12-01", today }).prev).toBe(today);
    expect(pageBounds({ from: "2026-12-20", today }).prev).toBe("2026-12-08");
  });

  it("stops the next page at the booking horizon", () => {
    expect(pageBounds({ from: today, today, last: "2026-11-30" }).next).toBeNull();
    expect(pageBounds({ from: today, today, last: "2026-12-01" }).next).toBe("2026-12-01");
  });

  it("starts the strip at a typed date only when the current page does not hold it", () => {
    expect(startFor("2026-11-25", today, today)).toBe(today);
    expect(startFor("2026-12-01", today, today)).toBe("2026-12-01");
    expect(startFor("2026-11-01", today, today)).toBe(today);
  });
});
