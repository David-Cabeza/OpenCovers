import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues, webhookEndpoints } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { createReservation, getEvents, pruneEvents } from "../src/lib/reservations";
import type { ResolvedAddress, TargetPolicy } from "../src/lib/webhook-target";
import {
  backoffMs,
  createWebhook,
  listWebhooks,
  runWebhookDeliveries,
  type DeliveryDeps,
  type WebhookRequest,
} from "../src/lib/webhooks";

const PUBLIC_V4 = "93.184.215.14";
const PUBLIC_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c";

type Verify = (secret: string, rawBody: string, header: string, toleranceSeconds?: number) => boolean;

function documentedVerifier(): Verify {
  const doc = readFileSync(new URL("../../../docs/contract/webhooks.md", import.meta.url), "utf8");
  const snippet = doc.match(/```js\n([\s\S]*?)```/)?.[1];
  if (!snippet) throw new Error("webhooks.md has no js snippet");
  return new Function("require", `${snippet}\nreturn verifyWebhook;`)(createRequire(import.meta.url));
}

class FakeDns {
  records = new Map<string, string[]>();
  set(host: string, ...addresses: string[]) {
    this.records.set(host, addresses);
  }
  resolveHost = async (host: string): Promise<ResolvedAddress[]> => {
    const addresses = this.records.get(host);
    if (!addresses) throw new Error(`ENOTFOUND ${host}`);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

type Received = WebhookRequest & { eventId: string; payload: Record<string, unknown> };

class Receiver {
  requests: Received[] = [];
  respond: (request: Received) => number | Promise<number> = () => 200;
  fetch = async (request: WebhookRequest) => {
    const received = {
      ...request,
      eventId: request.headers["opencovers-event-id"],
      payload: JSON.parse(request.body),
    };
    this.requests.push(received);
    await new Promise((resolve) => setImmediate(resolve));
    return { status: await this.respond(received) };
  };
  idsFor(url: string) {
    return this.requests.filter((r) => r.url.href === url).map((r) => r.eventId);
  }
}

class Clock {
  current = new Date(Date.now() + 60_000);
  now = () => this.current;
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function setup() {
  const dns = new FakeDns();
  dns.set("a.example", PUBLIC_V4);
  dns.set("b.example", PUBLIC_V4);
  dns.set("c.example", PUBLIC_V4);
  const receiver = new Receiver();
  const clock = new Clock();
  const policy: TargetPolicy = { allowInsecure: false, resolveHost: dns.resolveHost };
  const deps: DeliveryDeps = { ...policy, fetch: receiver.fetch, now: clock.now };
  return { dns, receiver, clock, policy, deps };
}

let venueCounter = 0;
async function seedVenue(): Promise<string> {
  const venueId = `wh-${++venueCounter}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" });
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 4 }]);
  return venueId;
}

let bookingCounter = 0;
async function book(venueId: string, count = 1): Promise<string[]> {
  for (let i = 0; i < count; i++) {
    const n = ++bookingCounter;
    const day = String((n % 28) + 1).padStart(2, "0");
    const month = String(Math.floor(n / 28) % 12 + 1).padStart(2, "0");
    const result = await createReservation(
      db,
      venueId,
      { date: `2027-${month}-${day}`, time: "20:00", durationMinutes: 120, partySize: 2, tableIds: ["1"] },
      `wh-booking-${n}`,
    );
    if (!result.ok) throw new Error(`booking failed: ${result.code}`);
  }
  return (await getEvents(db, venueId, 0, 1000)).map((e) => String(e.id));
}

async function register(venueId: string, url: string, policy: TargetPolicy) {
  const result = await createWebhook(db, venueId, url, policy);
  if (!result.ok) throw new Error(`register failed: ${result.code}`);
  return result.webhook;
}

async function stateOf(venueId: string, id: string) {
  const found = (await listWebhooks(db, venueId)).find((w) => w.id === id);
  if (!found) throw new Error(`no webhook ${id}`);
  return found;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE webhook_endpoints, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

beforeEach(async () => {
  await db.delete(webhookEndpoints);
});

describe("webhook signature", () => {
  it("verifies with the documented algorithm and fails with a wrong secret or a stale timestamp", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    await book(venueId);

    await runWebhookDeliveries(db, deps);

    expect(receiver.requests).toHaveLength(1);
    const [request] = receiver.requests;
    const header = request.headers["opencovers-signature"];
    const verify = documentedVerifier();
    expect(verify(hook.secret, request.body, header)).toBe(true);
    expect(verify("not-the-secret", request.body, header)).toBe(false);
    expect(verify(hook.secret, request.body.replace('"version":1', '"version":2'), header)).toBe(false);
    expect(verify(hook.secret, request.body, header, 0.001)).toBe(false);
  });

  it("sends the thin event payload with the event id header", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    await register(venueId, "https://a.example/hook", policy);
    const [eventId] = await book(venueId);

    await runWebhookDeliveries(db, deps);

    const [request] = receiver.requests;
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["opencovers-event-id"]).toBe(eventId);
    expect(request.payload).toEqual({
      id: eventId,
      venueId,
      type: "created",
      reservationId: expect.any(String),
      version: 1,
      occurredAt: expect.any(String),
    });
  });
});

describe("webhook ordering and retries", () => {
  it("delivers events strictly in id order and acknowledges each once", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    await register(venueId, "https://a.example/hook", policy);
    const ids = await book(venueId, 4);

    await runWebhookDeliveries(db, deps);
    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor("https://a.example/hook")).toEqual(ids);
  });

  it("stops at the first failure and backs off per the formula", async () => {
    const { receiver, clock, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    const ids = await book(venueId, 3);
    receiver.respond = (r) => (r.eventId === ids[1] ? 500 : 200);

    await runWebhookDeliveries(db, deps);
    expect(receiver.idsFor(hook.url)).toEqual([ids[0], ids[1]]);
    let state = await stateOf(venueId, hook.id);
    expect(state.failures).toBe(1);
    expect(state.lastError).toContain("HTTP 500");
    expect(state.nextAttemptAt).toBe(new Date(clock.current.getTime() + 30_000).toISOString());

    clock.advance(29_000);
    await runWebhookDeliveries(db, deps);
    expect(receiver.requests).toHaveLength(2);

    clock.advance(1_000);
    await runWebhookDeliveries(db, deps);
    expect(receiver.idsFor(hook.url)).toEqual([ids[0], ids[1], ids[1]]);
    state = await stateOf(venueId, hook.id);
    expect(state.failures).toBe(2);
    expect(state.nextAttemptAt).toBe(new Date(clock.current.getTime() + 60_000).toISOString());

    expect([1, 2, 3, 4, 7, 8, 20].map(backoffMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
  });

  it("treats a thrown error such as a timeout as a failure", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    await book(venueId);
    receiver.respond = () => {
      throw new Error("timed out after 5000ms");
    };

    await runWebhookDeliveries(db, deps);

    const state = await stateOf(venueId, hook.id);
    expect(state.failures).toBe(1);
    expect(state.lastError).toContain("timed out");
  });

  it("resumes after a failure from the failed event without skipping or repeating acknowledged ones", async () => {
    const { receiver, clock, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    const ids = await book(venueId, 3);
    receiver.respond = (r) => (r.eventId === ids[1] ? 503 : 200);
    await runWebhookDeliveries(db, deps);

    receiver.respond = () => 200;
    clock.advance(30_000);
    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor(hook.url)).toEqual([ids[0], ids[1], ids[1], ids[2]]);
    expect((await stateOf(venueId, hook.id)).failures).toBe(0);
  });

  it("keeps a failing endpoint from blocking a healthy one", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const failing = await register(venueId, "https://a.example/hook", policy);
    const healthy = await register(venueId, "https://b.example/hook", policy);
    const ids = await book(venueId, 3);
    receiver.respond = (r) => (r.url.href === failing.url ? 500 : 200);

    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor(failing.url)).toEqual([ids[0]]);
    expect(receiver.idsFor(healthy.url)).toEqual(ids);
  });

  it("keeps a slow endpoint from delaying a healthy one", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const slow = await register(venueId, "https://a.example/hook", policy);
    const healthy = await register(venueId, "https://b.example/hook", policy);
    const ids = await book(venueId, 3);
    const slowStarted = deferred();
    const healthyDone = deferred();
    receiver.respond = async (r) => {
      if (r.url.href === slow.url) {
        slowStarted.resolve();
        await healthyDone.promise;
      } else {
        await slowStarted.promise;
        if (r.eventId === ids[2]) healthyDone.resolve();
      }
      return 200;
    };

    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor(healthy.url)).toEqual(ids);
    expect(receiver.idsFor(slow.url)).toEqual(ids);
  });

  it("holds back events younger than the settle window", async () => {
    const { receiver, clock, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    const ids = await book(venueId);
    clock.current = new Date();

    await runWebhookDeliveries(db, deps);
    expect(receiver.requests).toHaveLength(0);

    clock.advance(5_000);
    await runWebhookDeliveries(db, deps);
    expect(receiver.idsFor(hook.url)).toEqual(ids);
  });

  it("gives a new endpoint no historical events", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const before = await book(venueId, 2);
    const hook = await register(venueId, "https://a.example/hook", policy);
    const after = (await book(venueId, 1)).filter((id) => !before.includes(id));

    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor(hook.url)).toEqual(after);
  });

  it("jumps a cursor below the retention watermark and records the drop", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    const pruned = await book(venueId, 2);
    await pruneEvents(db, venueId, new Date(Date.now() + 86_400_000));
    const fresh = (await book(venueId, 1)).filter((id) => !pruned.includes(id));

    await runWebhookDeliveries(db, deps);

    expect(receiver.idsFor(hook.url)).toEqual(fresh);
    const state = await stateOf(venueId, hook.id);
    expect(state.failures).toBe(0);
    expect(state.lastError).toContain(`up to ${pruned[1]} expired`);
  });
});

describe("webhook claims across workers", () => {
  it("delivers each event exactly once when two workers run at the same time", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const urls = ["https://a.example/hook", "https://b.example/hook", "https://c.example/hook"];
    for (const url of urls) await register(venueId, url, policy);
    const ids = await book(venueId, 5);

    await Promise.all([
      runWebhookDeliveries(db, { ...deps, concurrency: 2 }),
      runWebhookDeliveries(db, { ...deps, concurrency: 2 }),
    ]);

    for (const url of urls) expect(receiver.idsFor(url)).toEqual(ids);
  });

  it("skips an endpoint another worker holds until that worker finishes", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    const hook = await register(venueId, "https://a.example/hook", policy);
    const ids = await book(venueId, 2);
    const release = deferred();
    const holding = deferred();
    receiver.respond = async () => {
      holding.resolve();
      await release.promise;
      return 200;
    };

    const first = runWebhookDeliveries(db, deps);
    await holding.promise;
    await runWebhookDeliveries(db, deps);
    expect(receiver.requests).toHaveLength(1);

    release.resolve();
    await first;
    await runWebhookDeliveries(db, deps);
    expect(receiver.idsFor(hook.url)).toEqual(ids);
  });
});

describe("webhook SSRF protection", () => {
  const blocked = [
    "127.0.0.1",
    "127.10.0.1",
    "10.1.2.3",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "[::1]",
    "[::]",
    "[fc00::1]",
    "[fd12:3456::1]",
    "[fe80::1]",
    "[ff02::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:10.0.0.1]",
    "[::ffff:172.16.0.1]",
    "[::ffff:192.168.0.1]",
    "[::ffff:169.254.169.254]",
    "[::ffff:100.64.0.1]",
    "[::ffff:0.0.0.0]",
    "[0:0:0:0:0:ffff:7f00:1]",
    "[64:ff9b::a9fe:a9fe]",
  ];

  it.each(blocked)("rejects https://%s", async (host) => {
    const { policy } = setup();
    const venueId = await seedVenue();
    const result = await createWebhook(db, venueId, `https://${host}/hook`, policy);
    expect(result).toEqual({ ok: false, code: "webhook_url_rejected" });
  });

  it.each([PUBLIC_V4, "172.32.0.1", "100.128.0.1", `[${PUBLIC_V6}]`])("accepts https://%s", async (host) => {
    const { policy } = setup();
    const venueId = await seedVenue();
    const result = await createWebhook(db, venueId, `https://${host}/hook`, policy);
    expect(result.ok).toBe(true);
  });

  it("rejects a host name that resolves to a private address, even alongside a public one", async () => {
    const { dns, policy } = setup();
    const venueId = await seedVenue();
    dns.set("internal.example", "10.0.0.5");
    dns.set("mixed.example", PUBLIC_V4, "fd00::5");

    for (const host of ["internal.example", "mixed.example", "missing.example"]) {
      const result = await createWebhook(db, venueId, `https://${host}/hook`, policy);
      expect(result).toEqual({ ok: false, code: "webhook_url_rejected" });
    }
  });

  it("rejects http and URLs with credentials", async () => {
    const { policy } = setup();
    const venueId = await seedVenue();
    for (const url of [
      `http://${PUBLIC_V4}/hook`,
      `ftp://${PUBLIC_V4}/hook`,
      `https://user:pass@${PUBLIC_V4}/hook`,
      `https://user@${PUBLIC_V4}/hook`,
      "not a url",
    ]) {
      expect(await createWebhook(db, venueId, url, policy)).toEqual({ ok: false, code: "webhook_url_rejected" });
    }
  });

  it("allows http and private addresses only under the insecure flag", async () => {
    const { policy } = setup();
    const venueId = await seedVenue();
    const insecure = { ...policy, allowInsecure: true };
    expect((await createWebhook(db, venueId, "http://127.0.0.1:9/hook", insecure)).ok).toBe(true);
    expect(await createWebhook(db, venueId, "https://u:p@127.0.0.1/hook", insecure)).toEqual({
      ok: false,
      code: "webhook_url_rejected",
    });
  });

  it("connects to the address it validated", async () => {
    const { receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    await register(venueId, "https://a.example/hook", policy);
    await book(venueId);

    await runWebhookDeliveries(db, deps);

    expect(receiver.requests[0].address).toEqual({ address: PUBLIC_V4, family: 4 });
  });

  it("refuses to deliver when DNS rebinds to a private address after registration", async () => {
    const { dns, receiver, policy, deps } = setup();
    const venueId = await seedVenue();
    dns.set("rebind.example", PUBLIC_V4);
    const hook = await register(venueId, "https://rebind.example/hook", policy);
    await book(venueId);
    dns.set("rebind.example", "169.254.169.254");

    await runWebhookDeliveries(db, deps);

    expect(receiver.requests).toHaveLength(0);
    const state = await stateOf(venueId, hook.id);
    expect(state.failures).toBe(1);
    expect(state.lastError).toContain("blocked address");
  });
});

describe("webhook admin API", () => {
  async function venueWithKey(role: "read" | "write" = "write") {
    const venueId = await seedVenue();
    const key = `key-${venueId}-${role}`;
    await addKey(db, key, `principal-${venueId}`, [venueId], role);
    return { venueId, key };
  }

  function call(venueId: string, key: string, method: string, path = "", body?: unknown) {
    return app.request(`/v1/venues/${venueId}/webhooks${path}`, {
      method,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("returns the secret only in the create response", async () => {
    const { venueId, key } = await venueWithKey();
    const created = await call(venueId, key, "POST", "", { url: `https://${PUBLIC_V4}/hook` });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toEqual({ id: expect.any(String), url: `https://${PUBLIC_V4}/hook`, enabled: true, secret: expect.any(String) });
    expect(Buffer.from(body.secret, "base64url")).toHaveLength(32);

    const listed = await call(venueId, key, "GET");
    const text = await listed.text();
    expect(text).not.toContain(body.secret);
    expect(JSON.parse(text)).toEqual({
      webhooks: [
        {
          id: body.id,
          url: `https://${PUBLIC_V4}/hook`,
          enabled: true,
          failures: 0,
          lastError: null,
          nextAttemptAt: expect.any(String),
        },
      ],
    });
  });

  it("rejects a non-https URL and a host that resolves to loopback", async () => {
    const { venueId, key } = await venueWithKey();
    for (const url of [`http://${PUBLIC_V4}/hook`, "https://localhost/hook"]) {
      const res = await call(venueId, key, "POST", "", { url });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "webhook_url_rejected", message: "webhook_url_rejected" });
    }
    expect((await call(venueId, key, "POST", "", {})).status).toBe(400);
  });

  it("caps a venue at 5 endpoints", async () => {
    const { venueId, key } = await venueWithKey();
    for (let i = 0; i < 5; i++) {
      const res = await call(venueId, key, "POST", "", { url: `https://${PUBLIC_V4}/hook/${i}` });
      expect(res.status).toBe(201);
    }
    const sixth = await call(venueId, key, "POST", "", { url: `https://${PUBLIC_V4}/hook/5` });
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).code).toBe("webhook_limit_reached");
  });

  it("isolates webhooks per venue", async () => {
    const a = await venueWithKey();
    const b = await venueWithKey();
    const created = await (await call(a.venueId, a.key, "POST", "", { url: `https://${PUBLIC_V4}/hook` })).json();

    const crossDelete = await call(b.venueId, b.key, "DELETE", `/${created.id}`);
    const unknownDelete = await call(b.venueId, b.key, "DELETE", "/no-such-webhook");
    expect(crossDelete.status).toBe(404);
    expect(await crossDelete.json()).toEqual(await unknownDelete.json());
    expect(await (await call(b.venueId, b.key, "GET")).json()).toEqual({ webhooks: [] });

    const crossVenue = await call(a.venueId, b.key, "GET");
    expect(crossVenue.status).toBe(404);
    expect((await crossVenue.json()).code).toBe("venue_not_found");

    const ownDelete = await call(a.venueId, a.key, "DELETE", `/${created.id}`);
    expect(ownDelete.status).toBe(200);
    expect(await ownDelete.json()).toEqual({ webhooks: [] });
  });

  it("forbids a read key", async () => {
    const { venueId, key } = await venueWithKey("read");
    expect((await call(venueId, key, "GET")).status).toBe(403);
    expect((await call(venueId, key, "POST", "", { url: `https://${PUBLIC_V4}/hook` })).status).toBe(403);
  });
});
