// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import type { PublicApi, PublicConfig, PublicDay } from "../src/api";
import { addDays, formatDate, todayLocal } from "../src/dates";
import { translator } from "../src/messages";
import { noticeHref } from "../src/theme";

afterEach(cleanup);

const t = translator("en");
const today = todayLocal();

const base: PublicConfig = {
  venue: { name: "Casa Test", locale: "en", phone: "+34 600 000 000", address: "Calle Larga 1, 28001 Madrid" },
  minPartySize: 1,
  maxPartySize: 8,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  leadTimeMinutes: 0,
  maxAdvanceDays: 20,
  askConsent: false,
  privacyNoticeUrl: "https://casa.example/privacy",
  challenge: { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" },
  linkResend: false,
};

function setup(over: Partial<PublicConfig> = {}, venue: Partial<PublicConfig["venue"]> = {}) {
  const config = { ...base, ...over, venue: { ...base.venue, ...venue } };
  const calls = { days: 0, availability: 0, other: 0 };
  const api = {
    config: async () => ({ ok: true as const, value: config }),
    days: async (from: string, n: number, party: number) => {
      calls.days += 1;
      const days: PublicDay[] = Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), status: "available", firstTime: "20:00" }));
      return { ok: true as const, value: { from, partySize: party, days } };
    },
    availability: async () => {
      calls.availability += 1;
      return { ok: true as const, value: { times: ["19:00", "20:30"], reason: null } };
    },
    create: async () => {
      calls.other += 1;
      throw new Error("not expected");
    },
  } as unknown as PublicApi;
  render(<App api={api} t={t} locale="en" />);
  return calls;
}

async function toSummary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "20:30" }));
  await user.click(screen.getByRole("button", { name: t("action.continue") }));
  return screen.findByRole("heading", { name: t("step.summary") });
}

const noCheckedBox = () => {
  for (const box of screen.queryAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
};

describe("the summary step", () => {
  it("shows date, time, party and address, takes focus, and costs no request", async () => {
    const user = userEvent.setup();
    const calls = setup();
    const heading = await toSummary(user);
    // Focus moves in an effect that runs after the heading is found, so wait for it.
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const seen = { ...calls };
    expect(screen.getByText(formatDate(today, "en"))).toBeTruthy();
    expect(screen.getByText("20:30")).toBeTruthy();
    expect(screen.getByText(t("field.partyOption", { n: 2 }))).toBeTruthy();
    expect(screen.getByText(t("summary.address"))).toBeTruthy();
    expect(screen.getByText("Calle Larga 1, 28001 Madrid")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("action.continue") }));
    expect(await screen.findByRole("heading", { name: t("step.details") })).toBeTruthy();
    expect(calls).toEqual(seen);
  });

  it("shows no address row when the venue has none", async () => {
    const user = userEvent.setup();
    setup({}, { address: null });
    await toSummary(user);
    expect(screen.queryByText(t("summary.address"))).toBeNull();
    cleanup();
    setup({}, { address: undefined });
    await toSummary(user);
    expect(screen.queryByText(t("summary.address"))).toBeNull();
  });

  it("goes back to the choices from every edit link, keeping the time, and refetches the times", async () => {
    const user = userEvent.setup();
    const calls = setup();
    for (const field of [t("field.date"), t("field.time"), t("field.party")]) {
      await toSummary(user);
      const before = calls.availability;
      await user.click(screen.getByRole("button", { name: t("summary.edit", { field }) }));
      expect(await screen.findByRole("heading", { name: t("step.choose") })).toBeTruthy();
      expect(((await screen.findByRole("radio", { name: "20:30" })) as HTMLInputElement).checked).toBe(true);
      expect(calls.availability).toBeGreaterThan(before);
    }
  });

  it("goes back from the details to the summary", async () => {
    const user = userEvent.setup();
    setup();
    await toSummary(user);
    await user.click(screen.getByRole("button", { name: t("action.continue") }));
    await user.click(await screen.findByRole("button", { name: t("action.back") }));
    expect(await screen.findByRole("heading", { name: t("step.summary") })).toBeTruthy();
  });
});

describe("the privacy notice link", () => {
  it("opens in a new tab with no opener and no referrer, labelled and never showing the URL", async () => {
    const user = userEvent.setup();
    setup();
    await toSummary(user);
    expect(screen.queryByRole("link", { name: t("notice.privacy") })).toBeNull();
    await user.click(screen.getByRole("button", { name: t("action.continue") }));
    const link = (await screen.findByRole("link", { name: t("notice.privacy") })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://casa.example/privacy");
    expect(link.target).toBe("_blank");
    expect(link.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    expect(screen.queryByText(/casa\.example/)).toBeNull();
  });

  it("shows no link when the URL is null, missing or not a plain https URL", async () => {
    const user = userEvent.setup();
    for (const bad of [null, undefined, "http://casa.example/p", "javascript:alert(1)", "https://u:p@casa.example/", "https://casa.example/a b"]) {
      setup({ privacyNoticeUrl: bad });
      await toSummary(user);
      await user.click(screen.getByRole("button", { name: t("action.continue") }));
      await screen.findByRole("heading", { name: t("step.details") });
      expect(screen.queryByRole("link", { name: t("notice.privacy") })).toBeNull();
      cleanup();
    }
  });

  it("accepts only https with a host", () => {
    expect(noticeHref("https://casa.example/privacy?x=1")).toBe("https://casa.example/privacy?x=1");
    expect(noticeHref("HTTPS://Casa.Example/")).toBe("https://casa.example/");
    for (const bad of ["", "casa.example", "data:text/html,x", "https://" + "a".repeat(2050), 5, null]) {
      expect(noticeHref(bad)).toBeNull();
    }
  });
});

describe("the unticked-box rule (ADR-0021: never pre-tick)", () => {
  it("renders no checkbox ticked in any step, with the consent question on or off", async () => {
    const user = userEvent.setup();
    for (const askConsent of [true, false]) {
      setup({ askConsent });
      await screen.findByRole("radio", { name: "20:30" });
      noCheckedBox();
      await toSummary(user);
      noCheckedBox();
      await user.click(screen.getByRole("button", { name: t("action.continue") }));
      await screen.findByRole("heading", { name: t("step.details") });
      noCheckedBox();
      cleanup();
    }
  });

  it("has no source that ticks a checkbox by default", () => {
    const dir = path.join(__dirname, "../src");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      const boxes = source.match(/<input[^>]*type="checkbox"[^>]*>/gs) ?? [];
      for (const box of boxes) expect(box).not.toMatch(/defaultChecked|checked=\{?(true|"true")/);
    }
  });
});
