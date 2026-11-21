import { describe, expect, it } from "vitest";
import {
  guestPageOf,
  publicApi,
  takeToken,
  takeWaitlistToken,
  waitlistApi,
  waitlistEntryUrl,
  type WaitlistFields,
  type WaitlistToken,
} from "../src/api";
import { explainWaitlist, explainWaitlistPage } from "../src/errors";
import { CATALOGS } from "../src/messages";
import { checkWaitlist } from "../src/validate";

const TOKEN = `0f8fad5b-d9cb-469f-a165-70867728950e.${"A".repeat(43)}`;
const challenge = { nonce: "n", issuedAt: "2026-01-01T00:00:00Z", difficulty: 1, signature: "s" };

function server(body: unknown = {}, status = 200) {
  const sent: { url: string; init: RequestInit; headers: Record<string, string> }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    sent.push({ url, init, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  };
  return { sent, fetcher };
}

const fields: WaitlistFields = {
  date: "2030-06-01",
  partySize: 3,
  name: "  Ana ",
  email: " ana@example.com ",
  window: { from: "20:00", to: "22:00" },
  emailConsent: true,
  honeypot: "",
};

describe("the waitlist calls", () => {
  it("posts the join with the key, the trimmed guest, the consent, the window, the challenge and the locale", async () => {
    const { sent, fetcher } = server();
    await publicApi("pk_AAAAAAAAAAAAAAAAAAAAAA", fetcher, "de").joinWaitlist("k-1", fields, challenge, "42");
    const [call] = sent;
    expect(call.url).toBe("/v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA/waitlist");
    expect(call.init.method).toBe("POST");
    expect(call.init.credentials).toBe("omit");
    expect(call.headers["Idempotency-Key"]).toBe("k-1");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init.body as string)).toEqual({
      date: "2030-06-01",
      partySize: 3,
      window: { from: "20:00", to: "22:00" },
      locale: "de",
      guest: { name: "Ana", contact: "ana@example.com" },
      emailConsent: true,
      honeypot: "",
      challenge,
      solution: "42",
    });
  });

  it("leaves out the window and the locale when there are none, and never sends a note, phone or zone", async () => {
    const { sent, fetcher } = server();
    await publicApi("pk_AAAAAAAAAAAAAAAAAAAAAA", fetcher).joinWaitlist("k-2", { ...fields, window: null }, challenge, "1");
    const body = JSON.parse(sent[0].init.body as string);
    expect(Object.keys(body).sort()).toEqual(["challenge", "date", "emailConsent", "guest", "honeypot", "partySize", "solution"]);
    expect(Object.keys(body.guest).sort()).toEqual(["contact", "name"]);
  });

  it("reads and leaves with the token only in X-Self-Service-Token, on the waitlist routes", async () => {
    const { sent, fetcher } = server();
    const api = waitlistApi(TOKEN as WaitlistToken, fetcher);
    await api.read();
    await api.leave("leave-1");
    expect(sent.map((s) => s.url)).toEqual(["/v1/public/waitlist-entry", "/v1/public/waitlist-entry/leave"]);
    for (const s of sent) {
      expect(s.url).not.toContain(TOKEN);
      expect(s.headers["X-Self-Service-Token"]).toBe(TOKEN);
      expect(s.init.body).toBeUndefined();
    }
    expect(sent[0].init.method).toBeUndefined();
    expect(sent[1].init.method).toBe("POST");
    expect(sent[1].headers["Idempotency-Key"]).toBe("leave-1");
  });

  it("builds the leave link with the token in the fragment", () => {
    const url = new URL(waitlistEntryUrl("https://book.example.com", TOKEN, "fr"));
    expect(url.pathname).toBe("/r/waitlist");
    expect(url.search).toBe("?lang=fr");
    expect(url.hash).toBe(`#${TOKEN}`);
  });
});

describe("the waitlist page routing and token", () => {
  it("tells the booking page from the waitlist page, with or without a trailing slash", () => {
    expect(guestPageOf("/r")).toBe("booking");
    expect(guestPageOf("/r/")).toBe("booking");
    expect(guestPageOf("/r/waitlist")).toBe("waitlist");
    expect(guestPageOf("/r/waitlist/")).toBe("waitlist");
    expect(guestPageOf("/w/pk_x")).toBeNull();
    expect(guestPageOf("/r/other")).toBeNull();
  });

  it("reads the token from the fragment once and removes it from the address bar", () => {
    const replaced: unknown[][] = [];
    const history = { replaceState: (...args: unknown[]) => void replaced.push(args) };
    const token = takeWaitlistToken({ hash: `#${TOKEN}`, pathname: "/r/waitlist", search: "?lang=en" }, history);
    expect(token).toBe(TOKEN);
    expect(replaced).toEqual([[null, "", "/r/waitlist?lang=en"]]);
    expect(takeToken({ hash: "#nonsense", pathname: "/r/waitlist", search: "" }, history)).toBeNull();
  });
});

describe("waitlist form checks", () => {
  it("accepts a name, an email and no window, or a window with from before to", () => {
    expect(checkWaitlist("Ana", "ana@example.com", "", "")).toEqual({});
    expect(checkWaitlist("Ana", "ana@example.com", "19:00", "23:30")).toEqual({});
  });

  it("refuses a phone with its own message, and other bad emails with the email message", () => {
    expect(checkWaitlist("Ana", "+34 600 123 456", "", "").email).toBe("waitlist.phoneRefused");
    expect(checkWaitlist("Ana", "600123456", "", "").email).toBe("waitlist.phoneRefused");
    expect(checkWaitlist("Ana", "ana@", "", "").email).toBe("validate.email");
    expect(checkWaitlist("Ana", "", "", "").email).toBe("validate.email");
  });

  it("refuses an empty or long name, a half window, equal ends and a window that crosses midnight", () => {
    expect(checkWaitlist(" ", "a@b.co", "", "").name).toBe("validate.name");
    expect(checkWaitlist("x".repeat(101), "a@b.co", "", "").name).toBe("validate.name");
    expect(checkWaitlist("Ana", "a@b.co", "20:00", "").window).toBe("waitlist.window.pair");
    expect(checkWaitlist("Ana", "a@b.co", "", "20:00").window).toBe("waitlist.window.pair");
    expect(checkWaitlist("Ana", "a@b.co", "20:00", "20:00").window).toBe("waitlist.window.order");
    expect(checkWaitlist("Ana", "a@b.co", "22:00", "01:00").window).toBe("waitlist.window.order");
  });
});

describe("waitlist error messages", () => {
  const err = (code: string) => ({ kind: "error" as const, code, retryable: false });

  it("maps every contract error of the join to a message that exists in every locale", () => {
    const failures = [err("waitlist_unavailable"), err("booking_declined"), err("invalid_request"), err("rate_limited"), { kind: "network" as const }, { kind: "local" as const }];
    for (const failure of failures) {
      const { message } = explainWaitlist(failure);
      for (const catalog of Object.values(CATALOGS)) expect(catalog[message]).toBeTruthy();
    }
  });

  it("reads a declined contact as any unexpected failure, so a blocked contact is not revealed", () => {
    expect(explainWaitlist(err("booking_declined"))).toEqual(explainWaitlist(err("something_new")));
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog[explainWaitlist(err("booking_declined")).message]).not.toMatch(/bloque|block|declin|rechaz|bann|sperr|bloc|blocc/i);
    }
  });

  it("does not say which cause made the waitlist unavailable", () => {
    expect(explainWaitlist(err("waitlist_unavailable")).message).toBe("waitlist.error.unavailable");
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog["waitlist.error.unavailable"]).not.toMatch(/\b(cap|limit|máximo|maximum|límite|limite|Limit)\b/i);
    }
  });

  it("sends the page's identical 404 to the invalid state and a seated entry to a re-read", () => {
    expect(explainWaitlistPage(err("self_service_link_invalid"))).toEqual({ kind: "invalid" });
    expect(explainWaitlistPage(err("invalid_transition"))).toEqual({ kind: "changed" });
    expect(explainWaitlistPage({ kind: "network" }).kind).toBe("notice");
  });
});
