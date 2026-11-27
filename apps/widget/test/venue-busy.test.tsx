// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicReservation, SelfServiceApi, SelfServiceToken } from "../src/api";
import { selfServiceApi } from "../src/api";
import { explain, explainSelfService } from "../src/errors";
import { ManagePage } from "../src/Manage";
import { CATALOGS, translator, type Locale } from "../src/messages";

afterEach(cleanup);

const busy = { kind: "error", code: "venue_busy", retryable: true } as const;

const view: PublicReservation = {
  venue: { name: "Casa", locale: "en", phone: "+34 600 000 000" },
  date: "2030-06-01",
  time: "21:00",
  partySize: 2,
  maxPartySize: 8,
  status: "booked",
  version: 3,
  guest: { name: "Ana", contact: "a***@example.com" },
  commentary: "",
  consent: "unknown",
  changeableUntil: "2030-06-01T17:00:00.000Z",
  linkExpiresAt: "2030-06-03T23:00:00.000Z",
};

/** The self-service page over a server that answers its first write with `venue_busy`. */
function openManage(after: Partial<PublicReservation>) {
  const keys: string[] = [];
  const fetcher = async (_url: string, init: RequestInit) => {
    if (init.method !== "POST") return new Response(JSON.stringify(view));
    keys.push((init.headers as Record<string, string>)["Idempotency-Key"]!);
    return keys.length === 1
      ? new Response(JSON.stringify({ code: "venue_busy", message: "venue_busy", retryable: true }), { status: 503 })
      : new Response(JSON.stringify({ ...view, ...after }));
  };
  const api: SelfServiceApi = selfServiceApi("t" as SelfServiceToken, fetcher);
  let n = 0;
  render(<ManagePage api={api} fixedLocale="en" initialLocale="en" newKey={() => `key-${++n}`} />);
  return keys;
}

const t = translator("en");

describe("venue_busy on the guest pages", () => {
  it("tells a guest nothing was saved, in every language, and not as an unexpected failure", () => {
    const unexpected = { kind: "error", code: "something_new", retryable: false } as const;
    const booking = explain(busy);
    const change = explainSelfService(busy);
    const other = explainSelfService(unexpected);
    if (change.kind !== "notice" || other.kind !== "notice") throw new Error("expected a notice");
    for (const locale of Object.keys(CATALOGS) as Locale[]) {
      const say = translator(locale);
      expect(say(booking.message), locale).not.toBe(say(explain(unexpected).message));
      expect(say(change.notice.message), locale).not.toBe(say(other.notice.message));
    }
    // Trying again is enough, so neither sends the guest to the phone.
    expect(booking.phone).toBeUndefined();
    expect(booking.back).toBeUndefined();
    expect(change.notice.phone).toBeUndefined();
  });

  it("keeps the guest's change on screen and saves it on a second try with the same key", async () => {
    const user = userEvent.setup();
    const keys = openManage({ commentary: "By the window", version: 4 });
    await user.click(await screen.findByRole("button", { name: t("manage.edit") }));
    await user.type(screen.getByRole("textbox", { name: t("field.note") }), "By the window");
    await user.click(screen.getByRole("button", { name: t("manage.save") }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Another change was being saved, so yours was not and your booking is as before. Try again in a moment: it should work.",
    );
    expect((screen.getByRole("textbox", { name: t("field.note") }) as HTMLTextAreaElement).value).toBe("By the window");
    await user.click(screen.getByRole("button", { name: t("manage.save") }));
    expect((await screen.findByText(t("manage.saved"))).getAttribute("role")).toBe("status");
    expect(keys).toEqual(["key-1", "key-1"]);
  });

  it("says the same on a cancel, and cancels on a second try with the same key", async () => {
    const user = userEvent.setup();
    const keys = openManage({ status: "cancelled", version: 4 });
    await user.click(await screen.findByRole("button", { name: t("manage.cancel") }));
    await user.click(screen.getByRole("button", { name: t("manage.cancelConfirm") }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Another change was being saved, so yours was not and your booking is as before. Try again in a moment: it should work.",
    );
    await user.click(screen.getByRole("button", { name: t("manage.cancelConfirm") }));
    expect(await screen.findByRole("heading", { name: t("manage.cancelledTitle") })).toBeTruthy();
    expect(keys).toEqual(["key-1", "key-1"]);
  });
});
