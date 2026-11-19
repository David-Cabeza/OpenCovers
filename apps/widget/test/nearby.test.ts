import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicApi } from "../src/api";
import { NearbyDays } from "../src/App";
import { formatDay, isoWeekday } from "../src/dates";
import { translator } from "../src/messages";
import { findFreeDays, LOOKAHEAD_DAYS } from "../src/nearby";

// 2026-11-18 is a Wednesday.
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function fakeApi(free: Record<string, string[]>) {
  const asked: string[] = [];
  const api = {
    availability: async (date: string) => {
      asked.push(date);
      return { ok: true as const, value: { times: free[date] ?? [] } };
    },
  } as unknown as PublicApi;
  return { api, asked };
}

describe("finding free days", () => {
  it("picks the first bookable day and skips the full ones before it", async () => {
    const { api, asked } = fakeApi({ "2026-11-20": ["20:00", "20:30"], "2026-11-21": ["13:00"] });
    const days = await findFreeDays({ api, weekdays: ALL_DAYS, party: 2, from: "2026-11-18", want: 1 });
    expect(days).toEqual([{ date: "2026-11-20", times: ["20:00", "20:30"] }]);
    expect(asked).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("returns up to three nearby days in date order, even when a batch answers more", async () => {
    const free = Object.fromEntries(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => [d, ["19:00"]]));
    const { api } = fakeApi(free);
    const days = await findFreeDays({ api, weekdays: ALL_DAYS, party: 2, from: "2026-11-19", want: 3 });
    expect(days.map((d) => d.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
  });

  it("skips closed weekdays without a request", async () => {
    const { api, asked } = fakeApi({ "2026-11-23": ["20:00"] });
    // Open Mondays only (2026-11-23 is a Monday).
    const days = await findFreeDays({ api, weekdays: [1], party: 2, from: "2026-11-18", want: 1 });
    expect(days.map((d) => d.date)).toEqual(["2026-11-23"]);
    expect(asked.every((d) => isoWeekday(d) === 1)).toBe(true);
  });

  it("stops at the lookahead cap when nothing is free", async () => {
    const { api, asked } = fakeApi({ "2027-03-01": ["20:00"] });
    const days = await findFreeDays({ api, weekdays: ALL_DAYS, party: 2, from: "2026-11-18", want: 3 });
    expect(days).toEqual([]);
    expect(asked).toHaveLength(LOOKAHEAD_DAYS);
    expect(asked.at(-1)).toBe("2026-12-01");
  });

  it("does not look past the booking horizon", async () => {
    const { api, asked } = fakeApi({});
    await findFreeDays({ api, weekdays: ALL_DAYS, party: 2, from: "2026-11-18", last: "2026-11-20", want: 3 });
    expect(asked).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("counts a failed request as no times and keeps looking", async () => {
    const api = {
      availability: async (date: string) =>
        date === "2026-11-18"
          ? { ok: false as const, failure: { kind: "network" as const } }
          : { ok: true as const, value: { times: ["21:00"] } },
    } as unknown as PublicApi;
    const days = await findFreeDays({ api, weekdays: ALL_DAYS, party: 2, from: "2026-11-18", want: 1 });
    expect(days[0].date).toBe("2026-11-19");
  });

  it("stops asking once the caller no longer waits", async () => {
    const { api, asked } = fakeApi({});
    let live = true;
    const wrapped = {
      availability: async (d: string, p: number) => {
        live = false;
        return api.availability(d, p);
      },
    } as unknown as PublicApi;
    await findFreeDays({ api: wrapped, weekdays: ALL_DAYS, party: 2, from: "2026-11-18", want: 3, live: () => live });
    expect(asked).toHaveLength(3);
  });
});

describe("the nearby days", () => {
  const t = translator("en");
  const render = (nearby: Parameters<typeof NearbyDays>[0]["nearby"]) =>
    renderToStaticMarkup(createElement(NearbyDays, { nearby, t, locale: "en", onPick: () => {} }));

  it("offers each day as a button with its date and first free time", () => {
    const html = render({ kind: "done", days: [{ date: "2026-11-20", times: ["20:00", "21:00"] }] });
    expect(html).toContain("Nearest days with free times");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>/);
    expect(html).toContain(`${formatDay("2026-11-20", "en")}, from 20:00`);
  });

  it("says so when no day in the lookahead has times", () => {
    expect(render({ kind: "done", days: [] })).toContain(`No free times in the next ${LOOKAHEAD_DAYS} days`);
  });

  it("shows a loading line while it searches", () => {
    expect(render({ kind: "loading" })).toContain("Looking for nearby days");
  });
});
