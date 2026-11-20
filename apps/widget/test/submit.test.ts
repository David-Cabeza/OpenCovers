import { describe, expect, it } from "vitest";
import { publicApi, type BookingFields, type Created, type FormChallenge } from "../src/api";
import { createSubmitter, createTicketSource, MAX_TICKET_AGE_MS, MIN_FILL_MS, type Ticket } from "../src/submit";

const fields: BookingFields = {
  date: "2030-06-01",
  time: "20:00",
  partySize: 2,
  name: "Ana",
  contact: "ana@example.com",
  commentary: "",
  honeypot: "",
};

const created: Created = {
  reservation: {
    venue: { name: "Casa", locale: "es", phone: null },
    date: "2030-06-01",
    time: "20:00",
    partySize: 2,
    status: "booked",
    guest: { name: "Ana", contact: "a***@example.com" },
    commentary: "",
  },
  selfServiceToken: "11111111-1111-4111-8111-111111111111.secret",
};

const challenge = (n: number): FormChallenge => ({ nonce: `n${n}`, issuedAt: "", difficulty: 0, signature: "s" });

type Answer = { status: number; body?: unknown } | "network";

/** A fetch that records each create and answers from a script. */
function scriptedServer(answers: Answer[]) {
  const sent: { key: string; body: Record<string, unknown>; init: RequestInit; url: string }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    sent.push({
      url,
      init,
      key: (init.headers as Record<string, string>)["Idempotency-Key"],
      body: JSON.parse(String(init.body)),
    });
    const answer = answers.shift() ?? { status: 200, body: created };
    if (answer === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  };
  return { sent, fetcher };
}

function submitter(answers: Answer[]) {
  const server = scriptedServer(answers);
  const api = publicApi("pk_AAAAAAAAAAAAAAAAAAAAAA", server.fetcher);
  let tickets = 0;
  let keys = 0;
  const submit = createSubmitter({
    takeTicket: async (): Promise<Ticket> => ({ challenge: challenge(++tickets), solution: String(tickets) }),
    newKey: () => `key-${++keys}`,
    send: (key, f, ticket) => api.create(key, f, ticket.challenge, ticket.solution),
  });
  return { submit, sent: server.sent };
}

const error = (status: number, code: string, retryable: boolean): Answer => ({ status, body: { code, retryable } });

describe("guest language", () => {
  it("sends the locale the widget shows on the create, and nothing when none is given", async () => {
    const withLocale = scriptedServer([{ status: 201, body: created }]);
    await publicApi("pk_AAAAAAAAAAAAAAAAAAAAAA", withLocale.fetcher, "fr").create("k", fields, challenge(1), "1");
    expect(withLocale.sent[0].body.locale).toBe("fr");
    const without = scriptedServer([{ status: 201, body: created }]);
    await publicApi("pk_AAAAAAAAAAAAAAAAAAAAAA", without.fetcher).create("k", fields, challenge(1), "1");
    expect("locale" in without.sent[0].body).toBe(false);
  });
});

describe("idempotency key per attempt", () => {
  it("resends the same key, challenge and solution after a network failure", async () => {
    const { submit, sent } = submitter(["network"]);
    expect(await submit(fields)).toEqual({ ok: false, failure: { kind: "network" } });
    expect(await submit(fields)).toEqual({ ok: true, value: created });
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-1"]);
    expect(sent[1].body.challenge).toEqual(sent[0].body.challenge);
    expect(sent[1].body.solution).toBe(sent[0].body.solution);
  });

  it("resends the same key after an answer the contract marks retryable, a 429 or a 5xx with no body", async () => {
    const { submit, sent } = submitter([error(429, "rate_limited", true), { status: 502 }]);
    await submit(fields);
    await submit(fields);
    await submit(fields);
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("starts a new attempt, with a new key and challenge, after a refusal", async () => {
    const { submit, sent } = submitter([error(409, "slot_taken", false), error(400, "invalid_request", false)]);
    await submit(fields);
    await submit({ ...fields, time: "20:30" });
    await submit({ ...fields, time: "20:30" });
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-2", "key-3"]);
    expect(new Set(sent.map((s) => (s.body.challenge as FormChallenge).nonce)).size).toBe(3);
  });

  it("starts a new attempt when the guest changes the booking after a network failure", async () => {
    const { submit, sent } = submitter(["network"]);
    await submit(fields);
    await submit({ ...fields, name: "Ana María" });
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-2"]);
  });

  it("never reuses a key after a success", async () => {
    const { submit, sent } = submitter([]);
    await submit(fields);
    await submit(fields);
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-2"]);
  });

  it("calls only the same-origin public route, with no credentials and the token nowhere in a URL", async () => {
    const { submit, sent } = submitter([]);
    const result = await submit(fields);
    expect(result.ok && result.value.selfServiceToken).toBeTruthy();
    expect(sent[0].url).toBe("/v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA/reservations");
    expect(sent[0].init).toMatchObject({ credentials: "omit", cache: "no-store", method: "POST" });
    expect(sent[0].body).toMatchObject({ honeypot: "", guest: { name: "Ana", contact: "ana@example.com" } });
    expect(sent[0].body).not.toHaveProperty("commentary");
    expect(sent[0].body.guest).not.toHaveProperty("consent");
  });
});

describe("challenge tickets", () => {
  function clock() {
    let now = 1_000_000;
    const waits: number[] = [];
    return {
      now: () => now,
      advance: (ms: number) => (now += ms),
      sleep: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
      waits,
    };
  }

  it("holds a challenge back until the engine's 3-second minimum has passed", async () => {
    const c = clock();
    const source = createTicketSource({
      fetchChallenge: async () => challenge(2),
      solve: async (ch) => ch.nonce,
      now: c.now,
      sleep: c.sleep,
    });
    source.offer(challenge(1));
    c.advance(1_000);
    expect(await source.take()).toEqual({ challenge: challenge(1), solution: "n1" });
    expect(c.waits).toEqual([MIN_FILL_MS - 1_000]);
  });

  it("hands each challenge out once and replaces one near the end of its life", async () => {
    const c = clock();
    let fetched = 1;
    const source = createTicketSource({
      fetchChallenge: async () => challenge(++fetched),
      solve: async (ch) => ch.nonce,
      now: c.now,
      sleep: c.sleep,
    });
    source.offer(challenge(1));
    c.advance(10_000);
    const first = await source.take();
    c.advance(10_000);
    const second = await source.take();
    c.advance(MAX_TICKET_AGE_MS + 1);
    const third = await source.take();
    expect([first, second, third].map((t) => t?.challenge.nonce)).toEqual(["n1", "n2", "n4"]);
  });

  it("ends a submit with a local failure, sending nothing, when the proof of work cannot run", async () => {
    const source = createTicketSource({
      fetchChallenge: async () => challenge(2),
      solve: async () => {
        throw new Error("crypto.subtle needs a secure context");
      },
      sleep: async () => undefined,
    });
    source.offer(challenge(1));
    let sent = 0;
    const submit = createSubmitter({
      takeTicket: source.take,
      newKey: () => "k",
      send: async () => {
        sent += 1;
        return { ok: true, value: created };
      },
    });
    expect(await submit(fields)).toEqual({ ok: false, failure: { kind: "local" } });
    expect(sent).toBe(0);
  });

  it("gives no ticket when no new challenge can be fetched, and the submit reads as a network failure", async () => {
    const source = createTicketSource({ fetchChallenge: async () => null, solve: async () => "0" });
    expect(await source.take()).toBeNull();
    const submit = createSubmitter({ takeTicket: source.take, newKey: () => "k", send: async () => ({ ok: true, value: created }) });
    expect(await submit(fields)).toEqual({ ok: false, failure: { kind: "network" } });
  });
});
