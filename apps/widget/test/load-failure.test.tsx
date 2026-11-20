// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import type { Failure, PublicApi, PublicConfig, PublicDay } from "../src/api";
import { addDays } from "../src/dates";
import { translator } from "../src/messages";

afterEach(cleanup);

const t = translator("es");

const config: PublicConfig = {
  venue: { name: "Casa Test", locale: "es", phone: null, address: null },
  minPartySize: 1,
  maxPartySize: 8,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  leadTimeMinutes: 0,
  maxAdvanceDays: 20,
  askConsent: false,
  challenge: { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" },
  linkResend: false,
};

const days = async (from: string, n: number, party: number) => ({
  ok: true as const,
  value: {
    from,
    partySize: party,
    days: Array.from({ length: n }, (_, i): PublicDay => ({ date: addDays(from, i), status: "available", firstTime: "20:00" })),
  },
});

describe("a config that does not load", () => {
  it("offers a retry on a network failure, and does not say booking is off", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const api = {
      config: async () => {
        calls += 1;
        return calls === 1 ? { ok: false as const, failure: { kind: "network" } as Failure } : { ok: true as const, value: config };
      },
      days,
      availability: async () => ({ ok: true as const, value: { times: ["20:00"], reason: null } }),
    } as unknown as PublicApi;
    render(<App api={api} t={t} locale="es" />);

    const heading = await screen.findByRole("heading", { name: t("loadFailed.title") });
    // Focus moves in an effect that runs after the heading is found, so wait for it.
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole("alert").textContent).toBe(t("loadFailed.body"));
    expect(screen.queryByText(t("unavailable.body"))).toBeNull();

    await user.click(screen.getByRole("button", { name: t("action.retry") }));
    expect(await screen.findByRole("heading", { name: t("step.choose") })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("also offers a retry on a server error", async () => {
    const api = {
      config: async () => ({ ok: false as const, failure: { kind: "error", code: "unknown", retryable: true } as Failure }),
    } as unknown as PublicApi;
    render(<App api={api} t={t} locale="es" />);
    expect(await screen.findByRole("button", { name: t("action.retry") })).toBeTruthy();
  });

  it("keeps the unavailable message for a venue with online booking off", async () => {
    const api = {
      config: async () => ({ ok: false as const, failure: { kind: "error", code: "venue_not_found", retryable: false } as Failure }),
    } as unknown as PublicApi;
    render(<App api={api} t={t} locale="es" />);
    expect(await screen.findByRole("heading", { name: t("unavailable.title") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("action.retry") })).toBeNull();
  });
});

describe("a times list that does not load", () => {
  it("offers a retry that asks again", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const api = {
      config: async () => ({ ok: true as const, value: config }),
      days,
      availability: async () => {
        calls += 1;
        return calls === 1
          ? { ok: false as const, failure: { kind: "network" } as Failure }
          : { ok: true as const, value: { times: ["20:00"], reason: null } };
      },
    } as unknown as PublicApi;
    render(<App api={api} t={t} locale="es" />);
    await user.click(await screen.findByRole("button", { name: t("action.retry") }));
    expect(await screen.findByRole("radio", { name: "20:00" })).toBeTruthy();
  });
});

describe("a party larger than the online maximum", () => {
  it("says to book directly with the restaurant when the venue has no phone", async () => {
    const user = userEvent.setup();
    const api = {
      config: async () => ({ ok: true as const, value: config }),
      days,
      availability: async () => ({ ok: true as const, value: { times: ["20:00"], reason: null } }),
    } as unknown as PublicApi;
    render(<App api={api} t={t} locale="es" />);
    await user.selectOptions(await screen.findByRole("combobox", { name: t("field.party") }), "more");
    expect(screen.getByText(t("party.large", { n: 8 }))).toBeTruthy();
    expect(t("party.large", { n: 8 })).not.toMatch(/llama/i);
  });
});
