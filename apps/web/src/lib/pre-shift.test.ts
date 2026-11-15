import { describe, expect, it } from "vitest";
import type { Reservation, Table } from "@/lib/api";
import { buildPreShift, totalCovers } from "@/lib/pre-shift";

function reservation(overrides: Partial<Reservation>): Reservation {
  return {
    id: "r1",
    venueId: "v1",
    date: "2026-11-20",
    time: "20:00",
    service: "dinner",
    partySize: 2,
    status: "booked",
    version: 1,
    bookedVia: "staff",
    guest: { name: "Ana" },
    tables: [],
    ...overrides,
  };
}

const tables = [{ id: "t1", name: "Window 1" }] as Table[];

describe("buildPreShift", () => {
  it("reads the booking note and treats an empty note as none", () => {
    const rows = buildPreShift(
      [
        reservation({ id: "a", time: "19:00", commentary: "Anniversary, bring a cake" }),
        reservation({ id: "b", time: "20:00", commentary: "" }),
        reservation({ id: "c", time: "21:00", commentary: "   " }),
        reservation({ id: "d", time: "22:00" }),
      ],
      tables,
      null,
    );
    expect(rows.map((r) => r.commentary)).toEqual(["Anniversary, bring a cake", null, null, null]);
  });

  it("keeps only upcoming reservations of the chosen service", () => {
    const rows = buildPreShift(
      [
        reservation({ id: "dinner", time: "21:00" }),
        reservation({ id: "seated", time: "20:00", status: "seated" }),
        reservation({ id: "cancelled", time: "13:00", status: "cancelled" }),
        reservation({ id: "attended", time: "13:30", status: "attended" }),
        reservation({ id: "lunch", time: "14:00", service: "lunch" }),
      ],
      tables,
      "dinner",
    );
    expect(rows.map((r) => r.reservation.id)).toEqual(["seated", "dinner"]);
  });

  it("sorts by time across services when no service is chosen", () => {
    const rows = buildPreShift(
      [
        reservation({ id: "late", time: "21:00" }),
        reservation({ id: "early", time: "12:00", service: "lunch" }),
      ],
      tables,
      null,
    );
    expect(rows.map((r) => r.reservation.id)).toEqual(["early", "late"]);
  });

  it("names tables, falls back to the id, and gives no names to an overbooked booking", () => {
    const rows = buildPreShift(
      [
        reservation({ id: "a", time: "19:00", tables: ["t1", "t9"] }),
        reservation({ id: "b", time: "20:00", tables: [] }),
        reservation({ id: "c", time: "21:00", tables: undefined }),
      ],
      tables,
      null,
    );
    expect(rows.map((r) => r.tableNames)).toEqual([["Window 1", "t9"], [], []]);
  });

  it("flags large parties and totals covers", () => {
    const rows = buildPreShift(
      [reservation({ id: "a", partySize: 5 }), reservation({ id: "b", time: "21:00", partySize: 6 })],
      tables,
      null,
    );
    expect(rows.map((r) => r.large)).toEqual([false, true]);
    expect(totalCovers(rows)).toBe(11);
  });
});
