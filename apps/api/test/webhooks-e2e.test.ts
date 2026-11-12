import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { runWebhookDeliveries, webhookDepsFromEnv } from "../src/lib/webhooks";

type Delivery = { headers: IncomingHttpHeaders; body: string };

const deliveries: Delivery[] = [];
let server: Server;
let port: number;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE webhook_endpoints, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      deliveries.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  process.env.WEBHOOK_ALLOW_INSECURE = "true";
});

afterAll(async () => {
  delete process.env.WEBHOOK_ALLOW_INSECURE;
  await new Promise((resolve) => server.close(resolve));
});

describe("webhook end to end", () => {
  it("delivers a signed created event to a real receiver that the documented snippet verifies", async () => {
    const venueId = "wh-e2e";
    await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
    await db.insert(services).values({ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" });
    await db.insert(tables).values({ id: "1", venueId, name: "T1", seats: 4 });
    await addKey(db, "e2e-key", "widdot", [venueId], "write");
    const headers = { apikey: "e2e-key", "Content-Type": "application/json" };

    const registered = await app.request(`/v1/venues/${venueId}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: `http://127.0.0.1:${port}/hooks/opencovers` }),
    });
    expect(registered.status).toBe(201);
    const { secret } = await registered.json();

    const booked = await app.request(`/v1/venues/${venueId}/reservations`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "e2e-create" },
      body: JSON.stringify({
        date: "2027-03-10",
        time: "21:00",
        partySize: 2,
        guest: { name: "Ana", contact: "ana@example.com", consent: "granted" },
      }),
    });
    expect(booked.status).toBe(200);
    const reservation = await booked.json();

    const deps = webhookDepsFromEnv();
    await runWebhookDeliveries(db, { ...deps, now: () => new Date(Date.now() + 5_000) });

    expect(deliveries).toHaveLength(1);
    const [delivery] = deliveries;
    const payload = JSON.parse(delivery.body);
    expect(payload).toMatchObject({ venueId, type: "created", reservationId: reservation.id, version: 1 });
    expect(delivery.headers["opencovers-event-id"]).toBe(payload.id);
    expect(delivery.headers["content-type"]).toBe("application/json");

    const doc = readFileSync(new URL("../../../docs/contract/webhooks.md", import.meta.url), "utf8");
    const snippet = doc.match(/```js\n([\s\S]*?)```/)?.[1];
    const verifyWebhook = new Function("require", `${snippet}\nreturn verifyWebhook;`)(
      createRequire(import.meta.url),
    );
    const signature = delivery.headers["opencovers-signature"] as string;
    expect(verifyWebhook(secret, delivery.body, signature)).toBe(true);
    expect(verifyWebhook(`${secret}x`, delivery.body, signature)).toBe(false);

    const read = await app.request(`/v1/venues/${venueId}/reservations/${payload.reservationId}`, { headers });
    expect((await read.json()).guest.consent).toBe("granted");
  });
});
