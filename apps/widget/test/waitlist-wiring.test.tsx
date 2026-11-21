// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Joined, PublicApi, PublicConfig, PublicDay, PublicWaitlistEntry, Result, WaitlistApi } from "../src/api";
import { addDays, formatDate, todayLocal } from "../src/dates";
import { CATALOGS, translator } from "../src/messages";
import { WaitlistJoin } from "../src/WaitlistJoin";
import { WaitlistPage } from "../src/WaitlistPage";

vi.mock("../src/pow", () => ({ solveInBackground: async () => "42" }));

afterEach(cleanup);

const t = translator("en");
const today = todayLocal();
const d = (n: number) => addDays(today, n);

const config: PublicConfig = {
  venue: { name: "Casa Test", locale: "en", phone: "+34 910 000 000" },
  minPartySize: 1,
  maxPartySize: 8,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  leadTimeMinutes: 0,
  maxAdvanceDays: 20,
  askConsent: false,
  privacyNoticeUrl: "https://casa.example/privacy",
  waitlistEnabled: true,
  challenge: { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" },
  linkResend: false,
};

const TOKEN = `0f8fad5b-d9cb-469f-a165-70867728950e.${"A".repeat(43)}`;
const entry: PublicWaitlistEntry = {
  venue: config.venue,
  date: d(3),
  window: { from: "20:00", to: "22:00" },
  partySize: 2,
  status: "waiting",
  guest: { contact: "a***@example.com" },
  linkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};
const joined: Joined = { entry, waitlistToken: TOKEN };
const fail = (code: string, retryable = false): Result<never> => ({ ok: false, failure: { kind: "error", code, retryable } });

// ---- the join form on its own -------------------------------------------------------------------------------

function form(options: { join?: (...args: unknown[]) => Promise<Result<Joined>>; privacy?: boolean } = {}) {
  const calls: unknown[][] = [];
  const joinWaitlist = vi.fn(async (...args: unknown[]) => {
    calls.push(args);
    return options.join ? options.join(...args) : ({ ok: true, value: joined } as Result<Joined>);
  });
  const onJoined = vi.fn();
  const onBack = vi.fn();
  let n = 0;
  const cfg = options.privacy === false ? { ...config, privacyNoticeUrl: null } : config;
  render(
    <WaitlistJoin
      api={{ joinWaitlist } as unknown as Pick<PublicApi, "joinWaitlist">}
      t={t}
      locale="en"
      config={cfg}
      date={d(3)}
      party={2}
      takeTicket={async () => ({ challenge: config.challenge, solution: "42" })}
      tries={0}
      newKey={() => `key-${++n}`}
      onBack={onBack}
      onJoined={onJoined}
    />,
  );
  return { calls, joinWaitlist, onJoined, onBack };
}

const consentBox = () => screen.getByRole("checkbox") as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: t("waitlist.submit") }) as HTMLButtonElement;

async function fillValid(user: ReturnType<typeof userEvent.setup>, email = "ana@example.com") {
  await user.type(screen.getByLabelText(t("field.name")), "Ana");
  await user.type(screen.getByLabelText(t("waitlist.email")), email);
}

describe("the waitlist join form", () => {
  it("shows the consent box unticked, with the provisional label and the privacy link, and the submit disabled", () => {
    form();
    expect(consentBox().checked).toBe(false);
    expect(screen.getByText(t("waitlist.consent", { venue: "Casa Test" }))).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    const link = screen.getByRole("link", { name: t("notice.privacy") }) as HTMLAnchorElement;
    expect(link.href).toBe("https://casa.example/privacy");
  });

  it("has no privacy link when the venue set no notice", () => {
    form({ privacy: false });
    expect(screen.queryByRole("link", { name: t("notice.privacy") })).toBeNull();
  });

  it("enables the submit only while the box is ticked, and sends nothing while it is not", async () => {
    const user = userEvent.setup();
    const { joinWaitlist } = form();
    await fillValid(user);
    expect(submitButton().disabled).toBe(true);
    await user.click(consentBox());
    expect(submitButton().disabled).toBe(false);
    await user.click(consentBox());
    expect(submitButton().disabled).toBe(true);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("refuses a phone number with its own message and sends nothing", async () => {
    const user = userEvent.setup();
    const { joinWaitlist } = form();
    await fillValid(user, "+34 600 123 456");
    await user.click(consentBox());
    await user.click(submitButton());
    expect(await screen.findByText(t("waitlist.phoneRefused"))).toBeTruthy();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("refuses a half or reversed window", async () => {
    const user = userEvent.setup();
    const { joinWaitlist } = form();
    await fillValid(user);
    await user.click(consentBox());
    await user.type(screen.getByLabelText(t("waitlist.from")), "20:00");
    await user.click(submitButton());
    expect(await screen.findByText(t("waitlist.window.pair"))).toBeTruthy();
    await user.type(screen.getByLabelText(t("waitlist.to")), "19:00");
    await user.click(submitButton());
    expect(await screen.findByText(t("waitlist.window.order"))).toBeTruthy();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("sends the join with the consent, the window, the date, the party and the same key on a retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls, onJoined } = form({
      join: async () => (++attempts === 1 ? ({ ok: false, failure: { kind: "network" } } as Result<Joined>) : ({ ok: true, value: joined } as Result<Joined>)),
    });
    await fillValid(user);
    await user.type(screen.getByLabelText(t("waitlist.from")), "20:00");
    await user.type(screen.getByLabelText(t("waitlist.to")), "22:00");
    await user.click(consentBox());
    await user.click(submitButton());
    expect(await screen.findByText(t("error.network"))).toBeTruthy();
    await user.click(submitButton());
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(joined));
    const [first, second] = calls as [string, Record<string, unknown>, unknown, string][];
    expect(first[0]).toBe("key-1");
    expect(second[0]).toBe("key-1");
    expect(first[1]).toMatchObject({
      date: d(3),
      partySize: 2,
      name: "Ana",
      email: "ana@example.com",
      window: { from: "20:00", to: "22:00" },
      emailConsent: true,
      honeypot: "",
    });
    expect(first[3]).toBe("42");
  });

  it("uses a new key when the payload changes after a refusal", async () => {
    const user = userEvent.setup();
    const { calls } = form({ join: async () => fail("invalid_request") });
    await fillValid(user);
    await user.click(consentBox());
    await user.click(submitButton());
    await screen.findByText(t("waitlist.error.invalid"));
    await user.type(screen.getByLabelText(t("field.name")), "b");
    await user.click(submitButton());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c[0])).toEqual(["key-1", "key-2"]);
  });

  const cases: [string, Result<never>, string][] = [
    ["waitlist_unavailable", fail("waitlist_unavailable"), t("waitlist.error.unavailable")],
    ["invalid_request", fail("invalid_request"), t("waitlist.error.invalid")],
    ["rate_limited", fail("rate_limited", true), t("error.rateLimited")],
    ["network", { ok: false, failure: { kind: "network" } }, t("error.network")],
    ["booking_declined", fail("booking_declined"), t("waitlist.error.genericPhone", { phone: "+34 910 000 000" })],
  ];
  for (const [name, result, text] of cases) {
    it(`shows a friendly message for ${name}`, async () => {
      const user = userEvent.setup();
      const { onJoined } = form({ join: async () => result });
      await fillValid(user);
      await user.click(consentBox());
      await user.click(submitButton());
      expect(await screen.findByText(text)).toBeTruthy();
      expect(onJoined).not.toHaveBeenCalled();
    });
  }
});

// ---- the offer in the booking form ---------------------------------------------------------------------------

function app(options: { enabled?: boolean; fullOffset?: number; join?: () => Promise<Result<Joined>> } = {}) {
  const cfg = { ...config, waitlistEnabled: options.enabled ?? true };
  const joinWaitlist = vi.fn(options.join ?? (async () => ({ ok: true, value: joined }) as Result<Joined>));
  const api = {
    config: async () => ({ ok: true as const, value: cfg }),
    days: async (from: string, days: number, party: number) => {
      const list: PublicDay[] = Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        const offset = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
        const status = offset === (options.fullOffset ?? 0) ? ("full" as const) : ("available" as const);
        return { date, status, firstTime: status === "available" ? "20:00" : null };
      });
      return { ok: true as const, value: { from, partySize: party, days: list } };
    },
    availability: async (date: string) => ({
      ok: true as const,
      value: { times: date === d(options.fullOffset ?? 0) ? [] : ["19:00"], reason: null },
    }),
    joinWaitlist,
  } as unknown as PublicApi;
  render(<App api={api} t={t} locale="en" />);
  return { joinWaitlist };
}

// The form opens on the first available day, so the guest picks the full chip.
const pickFull = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("button", { name: t("strip.dayFull", { date: formatDate(today, "en") }) }));

describe("the waitlist in the booking form", () => {
  it("offers the waitlist on a full day when the venue turned it on", async () => {
    const user = userEvent.setup();
    app();
    expect(screen.queryByRole("button", { name: t("waitlist.join") })).toBeNull();
    await pickFull(user);
    expect(await screen.findByRole("button", { name: t("waitlist.join") })).toBeTruthy();
    expect(screen.getByText(t("waitlist.fullTitle"))).toBeTruthy();
  });

  it("does not offer it when the setting is off, and not on a day with free times", async () => {
    const user = userEvent.setup();
    app({ enabled: false });
    await pickFull(user);
    await screen.findByText(t("times.none", { n: 2 }));
    expect(screen.queryByRole("button", { name: t("waitlist.join") })).toBeNull();
    cleanup();
    app({ fullOffset: 5 });
    await screen.findByRole("radio", { name: "19:00" });
    expect(screen.queryByRole("button", { name: t("waitlist.join") })).toBeNull();
  });

  it("joins from a full day and shows the entry, that it is not a booking, and the leave link", async () => {
    const user = userEvent.setup();
    const { joinWaitlist } = app();
    await pickFull(user);
    await user.click(await screen.findByRole("button", { name: t("waitlist.join") }));
    expect(consentBox().checked).toBe(false);
    await fillValid(user);
    await user.click(consentBox());
    await user.click(submitButton());
    expect(await screen.findByText(t("waitlist.done.title"), {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(t("waitlist.done.notBooking"))).toBeTruthy();
    expect(screen.getByText(t("waitlist.done.window", { from: "20:00", to: "22:00" }))).toBeTruthy();
    expect(screen.getByText(t("waitlist.done.body", { date: formatDate(d(3), "en"), party: "2 guests", venue: "Casa Test" }))).toBeTruthy();
    const link = screen.getByLabelText(t("waitlist.done.linkTitle")) as HTMLInputElement;
    expect(new URL(link.value).pathname).toBe("/r/waitlist");
    expect(new URL(link.value).hash).toBe(`#${TOKEN}`);
    expect(new URL(link.value).search).toBe("?lang=en");
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("goes back to the times from the join form", async () => {
    const user = userEvent.setup();
    app();
    await pickFull(user);
    await user.click(await screen.findByRole("button", { name: t("waitlist.join") }));
    await user.click(screen.getByRole("button", { name: t("action.back") }));
    expect(await screen.findByText(t("waitlist.fullTitle"))).toBeTruthy();
  });
});

// ---- /r/waitlist ---------------------------------------------------------------------------------------------

function page(options: { read?: () => Promise<Result<PublicWaitlistEntry>>; leave?: () => Promise<Result<PublicWaitlistEntry>> | Result<PublicWaitlistEntry>; api?: null } = {}) {
  const read = vi.fn(options.read ?? (async () => ({ ok: true, value: entry }) as Result<PublicWaitlistEntry>));
  const leave = vi.fn(async (_key: string) => (options.leave ? options.leave() : ({ ok: true, value: { ...entry, status: "cancelled" as const } } as Result<PublicWaitlistEntry>)));
  let n = 0;
  render(
    <WaitlistPage
      api={options.api === null ? null : ({ read, leave } as unknown as WaitlistApi)}
      fixedLocale="en"
      initialLocale="en"
      newKey={() => `leave-${++n}`}
    />,
  );
  return { read, leave };
}

describe("the /r/waitlist page", () => {
  it("shows the entry: venue, date, window, party and status", async () => {
    page();
    expect(await screen.findByText(formatDate(d(3), "en"))).toBeTruthy();
    expect(screen.getByText("20:00 – 22:00")).toBeTruthy();
    expect(screen.getByText("2 guests")).toBeTruthy();
    expect(screen.getByText(t("waitlist.manage.status.waiting"))).toBeTruthy();
    expect(screen.getByText("a***@example.com")).toBeTruthy();
    expect(screen.getByText(t("waitlist.done.notBooking"))).toBeTruthy();
  });

  it("leaves the list with one call and shows the left state", async () => {
    const user = userEvent.setup();
    const { leave } = page();
    await user.click(await screen.findByRole("button", { name: t("waitlist.manage.leave") }));
    expect(await screen.findByText(t("waitlist.manage.leftTitle"))).toBeTruthy();
    expect(leave).toHaveBeenCalledWith("leave-1");
    expect(screen.queryByRole("button", { name: t("waitlist.manage.leave") })).toBeNull();
  });

  it("shows the invalid-link state for the identical 404, and for no token, with no reason", async () => {
    page({ read: async () => fail("self_service_link_invalid") });
    expect(await screen.findByText(t("waitlist.manage.invalidTitle"))).toBeTruthy();
    cleanup();
    const { read } = page({ api: null });
    expect(await screen.findByText(t("waitlist.manage.invalidTitle"))).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("shows an entry that is already cancelled as left, and an expired link as expired", async () => {
    page({ read: async () => ({ ok: true, value: { ...entry, status: "cancelled" } }) });
    expect(await screen.findByText(t("waitlist.manage.leftTitle"))).toBeTruthy();
    cleanup();
    page({ read: async () => ({ ok: true, value: { ...entry, linkExpiresAt: new Date(Date.now() - 1000).toISOString() } }) });
    expect(await screen.findByText(t("waitlist.manage.expiredTitle"))).toBeTruthy();
  });

  it("reads the entry again when staff seated it meanwhile, and keeps the leave button off", async () => {
    const user = userEvent.setup();
    let reads = 0;
    page({
      read: async () => ({ ok: true, value: ++reads > 1 ? { ...entry, status: "seated" as const } : entry }) as Result<PublicWaitlistEntry>,
      leave: () => fail("invalid_transition"),
    });
    await user.click(await screen.findByRole("button", { name: t("waitlist.manage.leave") }));
    expect(await screen.findByText(t("waitlist.manage.status.seated"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("waitlist.manage.leave") })).toBeNull();
  });

  it("keeps the leave button and says so on a network failure, and retries with the same key", async () => {
    const user = userEvent.setup();
    let tries = 0;
    const { leave } = page({
      leave: () => (++tries === 1 ? { ok: false, failure: { kind: "network" } } : { ok: true, value: { ...entry, status: "cancelled" } }),
    });
    await user.click(await screen.findByRole("button", { name: t("waitlist.manage.leave") }));
    expect(await screen.findByText(t("error.network"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("waitlist.manage.leave") }));
    expect(await screen.findByText(t("waitlist.manage.leftTitle"))).toBeTruthy();
    expect(leave.mock.calls.map((c) => c[0])).toEqual(["leave-1", "leave-1"]);
  });
});

describe("waitlist strings", () => {
  it("exist in every locale, and the consent label names the venue", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      expect(catalog["waitlist.consent"], locale).toContain("{venue}");
      expect(catalog["waitlist.join"], locale).toBeTruthy();
    }
  });
});
