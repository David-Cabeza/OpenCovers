import { describe, expect, it } from "vitest";
import {
  isChangeable,
  parseToken,
  selfServiceApi,
  selfServiceUrl,
  takeToken,
  type PublicReservation,
  type SelfServiceToken,
} from "../src/api";
import { explainSelfService } from "../src/errors";
import { CATALOGS } from "../src/messages";
import { createKeyedAction } from "../src/submit";

const TOKEN = `0f8fad5b-d9cb-469f-a165-70867728950e.${"A".repeat(42)}w`;

const view: PublicReservation = {
  venue: { name: "Casa", locale: "es", phone: "+34 910 000 000" },
  date: "2030-06-01",
  time: "21:00",
  partySize: 2,
  status: "booked",
  version: 3,
  guest: { name: "Ana", contact: "a***@example.com" },
  commentary: "",
  consent: "unknown",
  changeableUntil: "2030-06-01T17:00:00.000Z",
  linkExpiresAt: "2030-06-03T23:00:00.000Z",
};

type Answer = { status: number; body?: unknown } | "network";

function scriptedServer(answers: Answer[]) {
  const sent: { url: string; init: RequestInit; headers: Record<string, string> }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    sent.push({ url, init, headers: init.headers as Record<string, string> });
    const answer = answers.shift() ?? { status: 200, body: view };
    if (answer === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  };
  return { sent, fetcher };
}

const errorBody = (code: string, retryable = false) => ({ code, message: code, retryable });

describe("the token in the fragment", () => {
  it("parses only a well-formed `<linkId>.<secret>`", () => {
    expect(parseToken(`#${TOKEN}`)).toBe(TOKEN);
    expect(parseToken(TOKEN)).toBe(TOKEN);
    for (const bad of ["", "#", "#abc.def", `#${TOKEN}x`, `#${TOKEN.toUpperCase()}`, `#${TOKEN}&x=1`, `#${TOKEN.replace(".", "")}`]) {
      expect(parseToken(bad), bad).toBeNull();
    }
  });

  it("reads the token once and removes the fragment from the address, keeping the path and query", () => {
    const replaced: string[] = [];
    const history = { replaceState: (_data: unknown, _unused: string, url: string) => void replaced.push(url) };
    expect(takeToken({ hash: `#${TOKEN}`, pathname: "/r", search: "?lang=en" }, history)).toBe(TOKEN);
    expect(replaced).toEqual(["/r?lang=en"]);
  });

  it("clears a malformed fragment too, and leaves an address with no fragment alone", () => {
    const replaced: string[] = [];
    const history = { replaceState: (_data: unknown, _unused: string, url: string) => void replaced.push(url) };
    expect(takeToken({ hash: "#not-a-token", pathname: "/r", search: "" }, history)).toBeNull();
    expect(replaced).toEqual(["/r"]);
    expect(takeToken({ hash: "", pathname: "/r", search: "" }, history)).toBeNull();
    expect(replaced).toEqual(["/r"]);
  });

  it("builds the link on the widget origin with the token in the fragment only", () => {
    const url = new URL(selfServiceUrl("https://book.example.com", TOKEN, "en"));
    expect(url.origin).toBe("https://book.example.com");
    expect(url.pathname).toBe("/r");
    expect(url.search).toBe("?lang=en");
    expect(url.hash).toBe(`#${TOKEN}`);
    expect(parseToken(url.hash)).toBe(TOKEN);
  });
});

describe("the self-service calls", () => {
  it("send the token only in X-Self-Service-Token, with no cookie, cache or referrer", async () => {
    const server = scriptedServer([]);
    const api = selfServiceApi(TOKEN as SelfServiceToken, server.fetcher);
    await api.read();
    await api.modify("11111111-1111-4111-8111-111111111111", 3, { partySize: 4 });
    await api.cancel("22222222-2222-4222-8222-222222222222");
    expect(server.sent.map((s) => [s.init.method ?? "GET", s.url])).toEqual([
      ["GET", "/v1/public/self-service"],
      ["POST", "/v1/public/self-service/modify"],
      ["POST", "/v1/public/self-service/cancel"],
    ]);
    for (const { url, init, headers } of server.sent) {
      expect(headers["X-Self-Service-Token"]).toBe(TOKEN);
      expect(init.credentials).toBe("omit");
      expect(init.cache).toBe("no-store");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(url).not.toContain(TOKEN.split(".")[1]);
      expect(String(init.body ?? "")).not.toContain(TOKEN.split(".")[1]);
    }
    expect(server.sent[1].headers["Idempotency-Key"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(JSON.parse(String(server.sent[1].init.body))).toEqual({ version: 3, partySize: 4 });
    expect(server.sent[2].headers["Idempotency-Key"]).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("one Idempotency-Key per guest action", () => {
  function action(answers: Answer[]) {
    const server = scriptedServer(answers);
    const api = selfServiceApi(TOKEN as SelfServiceToken, server.fetcher);
    let n = 0;
    const newKey = () => `key-${(n += 1)}`;
    const cancel = createKeyedAction({ newKey, send: (key) => api.cancel(key) });
    const modify = createKeyedAction({
      newKey,
      send: (key, p: { version: number; partySize: number }) => api.modify(key, p.version, { partySize: p.partySize }),
    });
    const keys = () => server.sent.map((s) => s.headers["Idempotency-Key"]);
    return { cancel, modify, keys };
  }

  it("reuses the key when a cancel is retried after no answer, a 429 or a 5xx, so it replays", async () => {
    const a = action(["network", { status: 429, body: errorBody("rate_limited", true) }, { status: 503 }]);
    for (let i = 0; i < 3; i += 1) expect((await a.cancel(undefined)).ok).toBe(false);
    expect((await a.cancel(undefined)).ok).toBe(true);
    expect(a.keys()).toEqual(["key-1", "key-1", "key-1", "key-1"]);
  });

  it("takes a new key after an answer, and for a different change", async () => {
    const a = action([{ status: 409, body: errorBody("reservation_changed") }, { status: 200, body: view }, "network"]);
    await a.modify({ version: 3, partySize: 4 });
    await a.modify({ version: 4, partySize: 4 });
    await a.modify({ version: 4, partySize: 5 });
    await a.modify({ version: 4, partySize: 5 });
    expect(a.keys()).toEqual(["key-1", "key-2", "key-3", "key-3"]);
  });
});

describe("self-service errors", () => {
  const outcome = (code: string) => explainSelfService({ kind: "error", code, retryable: false });

  it("maps the link, cutoff and version codes to their page states", () => {
    expect(outcome("self_service_link_invalid")).toEqual({ kind: "invalid" });
    expect(outcome("self_service_closed")).toEqual({ kind: "closed" });
    expect(outcome("reservation_changed")).toEqual({ kind: "changed" });
  });

  it("gives every other code a message in every locale", () => {
    const codes = ["party_size_too_small", "party_size_too_large", "no_suitable_table", "invalid_request", "rate_limited"];
    for (const failure of [
      ...codes.map((code) => ({ kind: "error" as const, code, retryable: false })),
      { kind: "network" as const },
      { kind: "error" as const, code: "something_new", retryable: false },
    ]) {
      const result = explainSelfService(failure);
      if (result.kind !== "notice") throw new Error(`expected a notice for ${JSON.stringify(failure)}`);
      for (const catalog of Object.values(CATALOGS)) expect(catalog[result.notice.message]).toBeTruthy();
    }
  });

  it("never says why a link does not work", () => {
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog["manage.invalidBody"]).not.toMatch(/caduc|expir|revoc|revok|cancel|borr|eras/i);
    }
  });
});

describe("whether the guest may still change", () => {
  it("allows a booked booking before changeableUntil only", () => {
    const before = Date.parse(view.changeableUntil) - 1;
    expect(isChangeable(view, before)).toBe(true);
    expect(isChangeable(view, before + 1)).toBe(false);
    expect(isChangeable({ ...view, status: "cancelled" }, before)).toBe(false);
    expect(isChangeable({ ...view, status: "seated" }, before)).toBe(false);
  });
});
