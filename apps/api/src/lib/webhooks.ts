import { createHmac, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { events, venues, webhookEndpoints } from "../db/schema";
import { getEvents, getEventsWatermark, type Db } from "./reservations";
import {
  checkTarget,
  hostOf,
  resolveHost,
  type ResolvedAddress,
  type ResolveHost,
  type TargetPolicy,
} from "./webhook-target";

export const MAX_WEBHOOKS_PER_VENUE = 5;
const BATCH_SIZE = 50;
const CONCURRENCY = 4;
const TIMEOUT_MS = 5_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const LAST_ERROR_MAX = 500;
// A claim is a lease, not a lock. It must outlast the slowest batch
// (BATCH_SIZE events at TIMEOUT_MS each) so a live worker never loses its
// endpoint mid-batch. A crashed worker's endpoint frees up when it expires.
const LEASE_MS = 5 * 60_000;
// Event ids come from a sequence, so a transaction can commit id N after
// another committed N+1. Holding back events younger than this window keeps
// a cursor from moving past an id that is about to appear.
const SETTLE_MS = 2_000;

export type EndpointState = typeof webhookEndpoints.$inferSelect;

export type DeliveryOutcome =
  | { kind: "delivered" }
  | { kind: "failed"; reason: string };

export type WebhookSummary = {
  id: string;
  url: string;
  enabled: boolean;
  failures: number;
  lastError: string | null;
  nextAttemptAt: string;
};

export type WebhookCreated = { id: string; url: string; enabled: boolean; secret: string };

export type CreateWebhookResult =
  | { ok: true; webhook: WebhookCreated }
  | { ok: false; code: "webhook_url_rejected" | "webhook_limit_reached" | "venue_not_found" };

export type WebhookRequest = {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type WebhookFetch = (request: WebhookRequest) => Promise<{ status: number }>;

export type DeliveryDeps = TargetPolicy & {
  fetch: WebhookFetch;
  now: () => Date;
  concurrency?: number;
};

type Claim = { endpoint: EndpointState; leaseUntil: Date };

type FeedEvent = Awaited<ReturnType<typeof getEvents>>[number];

export function webhookPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): TargetPolicy {
  return { allowInsecure: env.WEBHOOK_ALLOW_INSECURE === "true", resolveHost };
}

export function webhookDepsFromEnv(env: NodeJS.ProcessEnv = process.env): DeliveryDeps {
  return { ...webhookPolicyFromEnv(env), fetch: pinnedFetch, now: () => new Date() };
}

export async function createWebhook(
  db: Db,
  venueId: string,
  rawUrl: string,
  policy: TargetPolicy,
): Promise<CreateWebhookResult> {
  const checked = await checkTarget(rawUrl, policy);
  if (!checked.ok) return { ok: false, code: "webhook_url_rejected" };
  const url = checked.target.url.href;
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");

  return db.transaction(async (tx) => {
    const venue = (
      await tx
        .select({ watermark: venues.eventsWatermark })
        .from(venues)
        .where(eq(venues.id, venueId))
        .for("update")
    )[0];
    if (!venue) return { ok: false, code: "venue_not_found" } as const;

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.venueId, venueId));
    if (count >= MAX_WEBHOOKS_PER_VENUE) return { ok: false, code: "webhook_limit_reached" } as const;

    const [{ maxId }] = await tx
      .select({ maxId: sql<number>`coalesce(max(${events.id}), 0)`.mapWith(Number) })
      .from(events)
      .where(eq(events.venueId, venueId));

    await tx.insert(webhookEndpoints).values({
      id,
      venueId,
      url,
      secret,
      lastEventId: Math.max(maxId, venue.watermark),
    });
    return { ok: true, webhook: { id, url, enabled: true, secret } } as const;
  });
}

export async function listWebhooks(db: Db, venueId: string): Promise<WebhookSummary[]> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.venueId, venueId))
    .orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id));
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    enabled: r.enabled,
    failures: r.failures,
    lastError: r.lastError,
    nextAttemptAt: r.nextAttemptAt.toISOString(),
  }));
}

export async function deleteWebhook(db: Db, venueId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.venueId, venueId), eq(webhookEndpoints.id, id)))
    .returning({ id: webhookEndpoints.id });
  return deleted.length > 0;
}

export function backoffMs(failures: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export async function runWebhookDeliveries(db: Db, deps: DeliveryDeps): Promise<void> {
  const visited = new Set<string>();
  const lane = async () => {
    for (;;) {
      const claim = await claimEndpoint(db, deps.now(), visited);
      if (!claim) return;
      visited.add(claim.endpoint.id);
      await deliverEndpoint(db, deps, claim);
    }
  };
  await Promise.all(Array.from({ length: deps.concurrency ?? CONCURRENCY }, lane));
}

// One statement both picks a due endpoint and pushes next_attempt_at out to
// the lease end. SKIP LOCKED lets a concurrent claimer pass over the row it
// is about to lease, and once committed the row is no longer due, so no
// other process picks it up until the lease ends. No transaction stays open
// across the HTTP calls.
async function claimEndpoint(db: Db, now: Date, visited: Set<string>): Promise<Claim | null> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const due = db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.enabled, true),
        lte(webhookEndpoints.nextAttemptAt, now),
        visited.size > 0 ? notInArray(webhookEndpoints.id, [...visited]) : undefined,
      ),
    )
    .orderBy(asc(webhookEndpoints.nextAttemptAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const [endpoint] = await db
    .update(webhookEndpoints)
    .set({ nextAttemptAt: leaseUntil })
    .where(inArray(webhookEndpoints.id, due))
    .returning();
  return endpoint ? { endpoint, leaseUntil } : null;
}

async function deliverEndpoint(db: Db, deps: DeliveryDeps, claim: Claim): Promise<void> {
  const { endpoint } = claim;
  let cursor = endpoint.lastEventId;
  let dropped: string | null = null;
  const watermark = await getEventsWatermark(db, endpoint.venueId);
  if (cursor < watermark) {
    dropped = `events after ${cursor} up to ${watermark} expired before delivery`;
    cursor = watermark;
  }

  const pending = settled(await getEvents(db, endpoint.venueId, cursor, BATCH_SIZE), deps.now());
  let outcome: DeliveryOutcome = { kind: "delivered" };
  let progressed = false;
  if (pending.length > 0) {
    const checked = await checkTarget(endpoint.url, deps);
    if (!checked.ok) {
      outcome = { kind: "failed", reason: checked.reason };
    } else {
      for (const event of pending) {
        outcome = await deliverEvent(endpoint, event, checked.target, deps);
        if (outcome.kind === "failed") break;
        cursor = event.id;
        progressed = true;
      }
    }
  }
  await finish(db, claim, cursor, outcome, progressed, dropped, deps.now());
}

function settled(feed: FeedEvent[], now: Date): FeedEvent[] {
  const cutoff = now.getTime() - SETTLE_MS;
  const firstUnsettled = feed.findIndex((e) => Date.parse(e.occurredAt) > cutoff);
  return firstUnsettled === -1 ? feed : feed.slice(0, firstUnsettled);
}

async function deliverEvent(
  endpoint: EndpointState,
  event: FeedEvent,
  target: { url: URL; address: ResolvedAddress },
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  const id = String(event.id);
  const body = JSON.stringify({
    id,
    venueId: endpoint.venueId,
    type: event.type,
    reservationId: event.reservationId,
    version: event.version,
    occurredAt: event.occurredAt,
    tombstoneHash: event.tombstoneHash,
  });
  const timestamp = Math.floor(deps.now().getTime() / 1000);
  try {
    const { status } = await deps.fetch({
      url: target.url,
      address: target.address,
      headers: {
        "content-type": "application/json",
        "user-agent": "OpenCovers-Webhooks/1",
        "opencovers-event-id": id,
        "opencovers-signature": signatureHeader(endpoint.secret, timestamp, body),
      },
      body,
      timeoutMs: TIMEOUT_MS,
    });
    if (status >= 200 && status < 300) return { kind: "delivered" };
    return { kind: "failed", reason: `event ${id}: HTTP ${status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason: `event ${id}: ${message}` };
  }
}

// The update only lands while next_attempt_at still equals our lease end. If
// the lease expired and another worker re-claimed the endpoint, this worker's
// stale result is discarded instead of rewinding or double-advancing the cursor.
async function finish(
  db: Db,
  claim: Claim,
  cursor: number,
  outcome: DeliveryOutcome,
  progressed: boolean,
  dropped: string | null,
  now: Date,
): Promise<void> {
  const { endpoint, leaseUntil } = claim;
  const fields =
    outcome.kind === "delivered"
      ? {
          lastEventId: cursor,
          failures: 0,
          nextAttemptAt: now,
          ...(dropped ? { lastError: dropped } : {}),
        }
      : failedFields(endpoint, cursor, outcome.reason, progressed, dropped, now);
  await db
    .update(webhookEndpoints)
    .set(fields)
    .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.nextAttemptAt, leaseUntil)));
}

function failedFields(
  endpoint: EndpointState,
  cursor: number,
  reason: string,
  progressed: boolean,
  dropped: string | null,
  now: Date,
) {
  const failures = (progressed ? 0 : endpoint.failures) + 1;
  const message = dropped ? `${dropped}; ${reason}` : reason;
  return {
    lastEventId: cursor,
    failures,
    lastError: message.slice(0, LAST_ERROR_MAX),
    nextAttemptAt: new Date(now.getTime() + backoffMs(failures)),
  };
}

export const pinnedFetch: WebhookFetch = ({ url, address, headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: address.address, family: address.family }]);
      } else {
        callback(null, address.address, address.family);
      }
    };
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        hostname: hostOf(url),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: pinned,
        agent: false,
      },
      (response) => {
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0 });
        response.destroy();
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    request.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    request.end(body);
  });
