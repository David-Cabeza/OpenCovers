// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import type { PublicApi, PublicConfig, PublicSlot } from "../src/api";
import { addDays, todayLocal } from "../src/dates";
import { translator } from "../src/messages";

afterEach(cleanup);

const t = translator("en");
const today = todayLocal();

const base: PublicConfig = {
  venue: { name: "Casa Test", locale: "en", phone: null },
  minPartySize: 1,
  maxPartySize: 8,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  leadTimeMinutes: 0,
  maxAdvanceDays: 20,
  askConsent: false,
  challenge: { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" },
  linkResend: false,
  zones: ["Sala", "Terraza"],
};

const ALL: PublicSlot[] = [
  { time: "13:00", zones: ["Sala", "Terraza"] },
  { time: "14:00", zones: ["Sala"] },
  { time: "15:00", zones: [] },
];

interface Options {
  zones?: string[];
  slots?: (zone: string | undefined) => PublicSlot[] | undefined;
  createFailure?: string;
  slotsOnly?: boolean;
}

function setup(options: Options = {}) {
  const config = { ...base, zones: "zones" in options ? options.zones : base.zones };
  const availability: { date: string; party: number; zone: string | undefined }[] = [];
  const dayArgs: unknown[][] = [];
  const created: Record<string, unknown>[] = [];
  const slotsFor = options.slots ?? ((zone) => (zone ? ALL.filter((s) => s.zones?.includes(zone)) : ALL));
  const api = {
    config: async () => ({ ok: true as const, value: config }),
    days: async (...args: unknown[]) => {
      dayArgs.push(args);
      const [from, n, party] = args as [string, number, number];
      const days = Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), status: "available" as const, firstTime: "13:00" }));
      return { ok: true as const, value: { from, partySize: party, days } };
    },
    availability: async (date: string, party: number, zone?: string) => {
      availability.push({ date, party, zone });
      const slots = slotsFor(zone);
      const times = slots ? slots.map((s) => s.time) : ["13:00", "14:00"];
      return { ok: true as const, value: { times, ...(slots ? { slots } : {}), reason: null } };
    },
    create: async (_key: string, fields: { zone?: string }) => {
      created.push(fields as Record<string, unknown>);
      if (options.createFailure) return { ok: false as const, failure: { kind: "error" as const, code: options.createFailure, retryable: false } };
      throw new Error("stop");
    },
  } as unknown as PublicApi;
  render(<App api={api} t={t} locale="en" />);
  return { availability, dayArgs, created };
}

const zoneGroup = () => screen.queryByRole("group", { name: t("zone.label") });
const time = (name: string) => screen.findByRole("radio", { name });

describe("the zone choice", () => {
  it("is hidden with no zones or one", async () => {
    for (const zones of [[], ["Sala"], undefined]) {
      setup({ zones: zones as string[], slots: () => undefined });
      await time("13:00");
      expect(zoneGroup()).toBeNull();
      cleanup();
    }
  });

  it("is shown with two or more zones, Any zone by default, and sends no zone", async () => {
    const { availability } = setup();
    await time(/13:00/);
    const group = zoneGroup()!;
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["", "Sala", "Terraza"]);
    expect(within(group).getByRole("radio", { name: t("zone.any") })).toHaveProperty("checked", true);
    expect(availability).toEqual([{ date: today, party: 2, zone: undefined }]);
  });

  it("refetches with the chosen zone, lists only the returned times and leaves /days alone", async () => {
    const user = userEvent.setup();
    const { availability, dayArgs } = setup();
    await time(/13:00/);
    await user.click(screen.getByRole("radio", { name: "Terraza" }));
    await waitFor(() => expect(availability.at(-1)?.zone).toBe("Terraza"));
    await waitFor(() => expect(screen.queryByRole("radio", { name: /14:00/ })).toBeNull());
    expect(screen.getByRole("radio", { name: "13:00" })).toBeTruthy();
    expect(dayArgs).toHaveLength(1);
    expect(dayArgs[0]).toEqual([today, 12, 2]);
    await user.click(screen.getByRole("radio", { name: t("zone.any") }));
    await waitFor(() => expect(availability.at(-1)?.zone).toBeUndefined());
    expect(await time(/14:00/)).toBeTruthy();
  });

  it("clears a chosen time that the new zone no longer lists, and keeps the date", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await time(/14:00/));
    await user.click(screen.getByRole("radio", { name: "Terraza" }));
    await waitFor(() => expect(screen.queryByRole("radio", { name: /14:00/ })).toBeNull());
    expect((screen.getByRole("radio", { name: "13:00" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(t("field.date")) as HTMLInputElement).value).toBe(today);
    await user.click(screen.getByRole("button", { name: t("action.continue") }));
    expect(screen.getByText(t("validate.time"))).toBeTruthy();
  });
});

describe("zones and services beside the times", () => {
  it("shows the zones with a table under each time, named in the accessible name", async () => {
    setup();
    const both = (await time(/13:00/)) as HTMLInputElement;
    expect(both.getAttribute("aria-label")).toBe(t("times.withZones", { time: "13:00", zones: "Sala, Terraza" }));
    expect(screen.getByText("Sala, Terraza")).toBeTruthy();
    expect(screen.getByRole("radio", { name: t("times.withZones", { time: "14:00", zones: "Sala" }) })).toBeTruthy();
    // Only a table outside the public zones fits: no zone text, plain name.
    expect(screen.getByRole("radio", { name: "15:00" })).toBeTruthy();
  });

  it("does not repeat the zones once a zone is chosen", async () => {
    const user = userEvent.setup();
    setup();
    await time(/13:00/);
    await user.click(screen.getByRole("radio", { name: "Sala" }));
    expect(await time("14:00")).toBeTruthy();
    expect(screen.queryByText("Sala, Terraza")).toBeNull();
    expect(screen.getByRole("radio", { name: "13:00" })).toBeTruthy();
  });

  it("groups the times under a heading per service, in the order they appear", async () => {
    setup({
      zones: [],
      slots: () => [
        { time: "13:00", service: "Lunch" },
        { time: "14:00", service: "Lunch" },
        { time: "20:00", service: "Dinner" },
      ],
    });
    await time("13:00");
    const groups = screen.getAllByRole("group").filter((g) => ["Lunch", "Dinner"].includes(g.getAttribute("aria-label") ?? ""));
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Lunch", "Dinner"]);
    expect(within(groups[0]).getAllByRole("radio")).toHaveLength(2);
    expect(within(groups[1]).getByRole("radio", { name: "20:00" })).toBeTruthy();
    expect(screen.getByText("Dinner")).toBeTruthy();
  });

  it("keeps a flat list without service, and with no slots at all", async () => {
    setup({ zones: [], slots: () => [{ time: "13:00" }, { time: "14:00" }] });
    await time("13:00");
    expect(screen.queryByRole("group", { name: "Lunch" })).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    cleanup();
    setup({ zones: [], slots: () => undefined });
    await time("13:00");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});

async function toDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: t("action.continue") }));
  await screen.findByRole("heading", { name: t("step.summary") });
}

describe("booking with a zone", () => {
  it("shows the zone line in the summary only when a zone was chosen", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await time(/13:00/));
    await toDetails(user);
    expect(screen.queryByText("Sala")).toBeNull();
    expect(screen.queryByRole("button", { name: t("summary.edit", { field: t("zone.label") }) })).toBeNull();
    cleanup();

    setup();
    await user.click(await screen.findByRole("radio", { name: "Sala" }));
    await user.click(await time("13:00"));
    await toDetails(user);
    expect(screen.getByText(t("zone.label"))).toBeTruthy();
    expect(screen.getByText("Sala")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("summary.edit", { field: t("zone.label") }) }));
    expect(await screen.findByRole("heading", { name: t("step.choose") })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Sala" }) as HTMLInputElement).checked).toBe(true);
  });

  async function fillAndBook(user: ReturnType<typeof userEvent.setup>) {
    await toDetails(user);
    await user.click(screen.getByRole("button", { name: t("action.continue") }));
    await user.type(await screen.findByLabelText(t("field.name")), "Ana");
    await user.type(screen.getByLabelText(t("field.contact")), "ana@example.com");
    await user.click(screen.getByRole("button", { name: t("action.book") }));
  }

  it("sends zone in the create only when one is chosen", async () => {
    const user = userEvent.setup();
    const first = setup({ createFailure: "invalid_request" });
    await user.click(await time(/13:00/));
    await fillAndBook(user);
    await waitFor(() => expect(first.created).toHaveLength(1), { timeout: 8000 });
    expect("zone" in first.created[0]).toBe(false);
    cleanup();

    const second = setup({ createFailure: "invalid_request" });
    await user.click(await screen.findByRole("radio", { name: "Terraza" }));
    await user.click(await time("13:00"));
    await fillAndBook(user);
    await waitFor(() => expect(second.created).toHaveLength(1), { timeout: 8000 });
    expect(second.created[0].zone).toBe("Terraza");
  }, 20000);

  it("reloads the times on slot_taken and keeps the zone", async () => {
    const user = userEvent.setup();
    const { availability, created } = setup({ createFailure: "slot_taken" });
    await user.click(await screen.findByRole("radio", { name: "Sala" }));
    await user.click(await time("14:00"));
    await fillAndBook(user);
    await waitFor(() => expect(created).toHaveLength(1), { timeout: 8000 });
    expect(await screen.findByRole("heading", { name: t("step.choose") })).toBeTruthy();
    await waitFor(() => expect(availability.at(-1)?.zone).toBe("Sala"));
    expect((screen.getByRole("radio", { name: "Sala" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(t("error.slotTaken"))).toBeTruthy();
  }, 20000);
});
