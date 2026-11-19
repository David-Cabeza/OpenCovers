// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { DayStatus, PublicApi, PublicConfig, PublicDay } from "../src/api";
import { addDays, formatDate, todayLocal } from "../src/dates";
import { translator } from "../src/messages";

afterEach(cleanup);

const t = translator("en");
const today = todayLocal();
const d = (n: number) => addDays(today, n);

const config: PublicConfig = {
  venue: { name: "Casa Test", locale: "en", phone: null },
  minPartySize: 1,
  maxPartySize: 8,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  leadTimeMinutes: 0,
  maxAdvanceDays: 20,
  askConsent: false,
  challenge: { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" },
  linkResend: false,
};

// Day 0 full, 1 available, 2 closed, 3 full, everything else available.
const STATUS: Record<number, DayStatus> = { 0: "full", 2: "closed", 3: "full" };

function setup(options: { daysFail?: boolean } = {}) {
  const dayCalls: { from: string; days: number; party: number }[] = [];
  const availabilityCalls: { date: string; party: number }[] = [];
  const api = {
    config: async () => ({ ok: true as const, value: config }),
    days: async (from: string, days: number, party: number) => {
      dayCalls.push({ from, days, party });
      if (options.daysFail) return { ok: false as const, failure: { kind: "error" as const, code: "rate_limited", retryable: true } };
      const list: PublicDay[] = Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        const offset = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
        const status: DayStatus = offset > 20 ? "outside_window" : (STATUS[offset] ?? "available");
        return { date, status, firstTime: status === "available" ? "20:00" : null };
      });
      return { ok: true as const, value: { from, partySize: party, days: list } };
    },
    availability: async (date: string, party: number) => {
      availabilityCalls.push({ date, party });
      const offset = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
      const times = STATUS[offset] ? [] : ["19:00", "20:30"];
      return { ok: true as const, value: { times, reason: null } };
    },
  } as unknown as PublicApi;
  render(<App api={api} t={t} locale="en" />);
  return { dayCalls, availabilityCalls };
}

const chip = (offset: number, kind: "Available" | "Full" | "Closed") =>
  screen.findByRole("button", { name: t(`strip.day${kind}`, { date: formatDate(d(offset), "en") }) });

describe("the day strip in the form", () => {
  it("opens on the first available day with one /days and one /availability request", async () => {
    const { dayCalls, availabilityCalls } = setup();
    expect((await chip(1, "Available")).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("radio", { name: "19:00" })).toBeTruthy();
    expect(dayCalls).toEqual([{ from: today, days: 12, party: 2 }]);
    expect(availabilityCalls).toEqual([{ date: d(1), party: 2 }]);
  });

  it("names every chip by its date and state, inside a labelled group", async () => {
    setup();
    await chip(1, "Available");
    expect(await chip(0, "Full")).toBeTruthy();
    expect(await chip(2, "Closed")).toBeTruthy();
    const group = screen.getByRole("group", { name: t("strip.label") });
    expect(within(group).getAllByRole("button")).toHaveLength(12);
    expect(screen.getByRole("button", { name: t("strip.dayFull", { date: formatDate(d(0), "en") }) }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows no free times for a full chip and a button to the next free day", async () => {
    const user = userEvent.setup();
    setup();
    await chip(1, "Available");
    await user.click(await chip(3, "Full"));
    expect((await chip(3, "Full")).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(t("times.none", { n: 2 }))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("strip.nextFree") }));
    expect((await chip(4, "Available")).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("radio", { name: "19:00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("strip.nextFree") })).toBeNull();
  });

  it("does not select a closed chip", async () => {
    const user = userEvent.setup();
    const { availabilityCalls } = setup();
    await chip(1, "Available");
    await screen.findByRole("radio", { name: "19:00" });
    const closed = await chip(2, "Closed");
    expect(closed.getAttribute("aria-disabled")).toBe("true");
    expect(closed.hasAttribute("aria-pressed")).toBe(false);
    await user.click(closed);
    expect((await chip(1, "Available")).getAttribute("aria-pressed")).toBe("true");
    expect(availabilityCalls).toHaveLength(1);
  });

  it("asks /days again when the party changes, and keeps the date", async () => {
    const user = userEvent.setup();
    const { dayCalls } = setup();
    await chip(1, "Available");
    await user.selectOptions(screen.getByLabelText(t("field.party")), "4");
    await waitFor(() => expect(dayCalls).toHaveLength(2));
    expect(dayCalls[1]).toEqual({ from: today, days: 12, party: 4 });
    expect((await chip(1, "Available")).getAttribute("aria-pressed")).toBe("true");
  });

  it("pages by 12 days and back, and stops at the booking horizon", async () => {
    const user = userEvent.setup();
    const { dayCalls } = setup();
    await chip(1, "Available");
    const prev = screen.getByRole("button", { name: t("strip.prev") }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: t("strip.next") }));
    await waitFor(() => expect(dayCalls.at(-1)?.from).toBe(d(12)));
    // Day 21 and later are outside the window (horizon 20): the page is shorter and has no further page.
    await waitFor(() => expect((screen.getByRole("button", { name: t("strip.next") }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: t("strip.prev") }));
    await waitFor(() => expect(dayCalls.at(-1)?.from).toBe(today));
  });

  it("loads the strip from a date typed outside it", async () => {
    const user = userEvent.setup();
    const { dayCalls } = setup();
    await chip(1, "Available");
    const input = screen.getByLabelText(t("field.date"));
    await user.clear(input);
    await user.type(input, d(15));
    await waitFor(() => expect(dayCalls.at(-1)?.from).toBe(d(15)));
  });

  it("keeps the date field and the times working when /days fails", async () => {
    const { availabilityCalls } = setup({ daysFail: true });
    // Today is a full day in this fake, so the times area answers with the no-times line, and no strip helps.
    expect(await screen.findByText(t("times.none", { n: 2 }))).toBeTruthy();
    expect(screen.queryByRole("group", { name: t("strip.label") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("strip.nextFree") })).toBeNull();
    expect((screen.getByLabelText(t("field.date")) as HTMLInputElement).value).toBe(today);
    expect(availabilityCalls).toEqual([{ date: today, party: 2 }]);
  });
});
