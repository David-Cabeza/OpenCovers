import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { migrateDb } from "../src/db/migrate";

beforeAll(async () => {
  await migrateDb();
});

const KB = 1024;

/** Valid JSON of exactly `size` bytes: the object padded with trailing spaces. */
function padded(value: unknown, size: number): string {
  const json = JSON.stringify(value);
  return json + " ".repeat(size - json.length);
}

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

/** A body with no Content-Length that yields `chunk` bytes per read, and counts the bytes read from it. */
function endless(chunk: number, total: number) {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= total) return controller.close();
        sent += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(32));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, sent: () => sent };
}

describe("request body size", () => {
  const modify = "/v1/public/self-service/modify";
  const change = { version: 1, commentary: "window seat" };

  it("reads a public body up to 16 KB and refuses a larger one with invalid_request", async () => {
    const fits = await post(modify, padded(change, 16 * KB));
    expect((await fits.json()).code).toBe("self_service_link_invalid");

    const over = await post(modify, padded(change, 16 * KB + 1));
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ code: "invalid_request", message: "invalid_request", retryable: false });
    expect(over.headers.get("cache-control")).toBe("no-store");
  });

  it("stops reading a public body with no Content-Length once it passes the limit", async () => {
    const body = endless(KB, 300 * KB * KB);
    const res = await post(modify, body.stream);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(body.sent()).toBeLessThan(64 * KB);
  });

  it("refuses a body whose Content-Length is over the limit without reading it", async () => {
    const body = endless(KB, 300 * KB * KB);
    const res = await post(modify, body.stream, { "content-length": String(300 * KB * KB) });
    expect(res.status).toBe(400);
    expect(body.sent()).toBe(0);
  });

  it("limits the public create the same way", async () => {
    const res = await post("/v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA/reservations", padded({}, 16 * KB + 1));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("reads a staff body up to 256 KB and refuses a larger one before authentication", async () => {
    const fits = await post("/v1/venues", padded({ name: "Casa" }, 256 * KB));
    expect(fits.status).toBe(401);

    const over = await post("/v1/venues", padded({ name: "Casa" }, 256 * KB + 1));
    expect(over.status).toBe(400);
    expect((await over.json()).code).toBe("invalid_request");

    const body = endless(16 * KB, 300 * KB * KB);
    const streamed = await post("/v1/venues", body.stream);
    expect(streamed.status).toBe(400);
    expect(body.sent()).toBeLessThan(512 * KB);
  });

  it("limits the sign-in body too", async () => {
    const res = await post("/api/auth/sign-in/email", padded({ email: "a@example.com", password: "x" }, 256 * KB + 1), {
      origin: "http://localhost:3000",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });
});
