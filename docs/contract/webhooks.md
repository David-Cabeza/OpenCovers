# Webhooks

A webhook pushes each event of a venue's feed to an HTTPS endpoint, so a platform learns about a reservation change without polling. The event feed stays the source of truth. A webhook is a cursor over that feed that the engine advances for you.

The payload is thin. It names the event and the reservation, never the guest. To get the reservation, including `guest.consent` and `rating`, the receiver calls `GET /v1/venues/{venueId}/reservations/{reservationId}` with its own key.

## Registering an endpoint

Webhooks are managed over HTTP only. They are not exposed through MCP. Every call needs a `write` or `admin` key for the venue, or a staff session with that role, the same as `PUT /v1/venues/{venueId}/config`. A `read` key gets `forbidden`.

- `POST /v1/venues/{venueId}/webhooks` with `{"url": "https://..."}` returns `201` and `{"id", "url", "enabled", "secret"}`.
- `GET /v1/venues/{venueId}/webhooks` returns `{"webhooks": [...]}` with `id`, `url`, `enabled`, `failures`, `lastError`, and `nextAttemptAt`. It never returns the secret.
- `DELETE /v1/venues/{venueId}/webhooks/{webhookId}` removes the endpoint and returns the remaining list.

A venue can have at most 5 endpoints. A sixth fails with `webhook_limit_reached`. An endpoint id from another venue fails with `webhook_not_found`, the same as an unknown id.

A new endpoint starts at the end of the feed. It receives only events written after it was registered. To catch up on older events, read the feed once with `GET /v1/venues/{venueId}/events`.

## Secret handling

The engine generates the secret, 32 random bytes encoded as base64url. It is returned once, in the create response. Store it then. The engine never shows it again. To rotate it, register a new endpoint, switch your receiver to the new secret, and delete the old endpoint.

## Delivery

Each event is one `POST` with `Content-Type: application/json`:

```json
{
  "id": "1042",
  "venueId": "casa-pepe",
  "type": "created",
  "reservationId": "r_8f2c",
  "version": 1,
  "occurredAt": "2026-11-12T19:04:11.512Z"
}
```

`type` is one of `created`, `modified`, `cancelled`, `seated`, `attended`, `no_show`, or `erased`. An `erased` event also carries `tombstoneHash`. `id` is the feed's event id, as a string.

Headers:

- `OpenCovers-Event-Id`: the event id, the same as `id` in the body.
- `OpenCovers-Signature`: `t=<unix seconds>,v1=<hex>`.

Any `2xx` response acknowledges the event. Anything else is a failure, including a redirect, a timeout after 5 seconds, and a refused connection. The engine does not follow redirects.

## Signature

`v1` is the hex HMAC-SHA256 of the string `<t>.<raw body>`, keyed by the secret exactly as the create response returned it. `t` is the time the engine signed the request.

To verify, compute the HMAC over the raw request body, before any JSON parsing. Compare it in constant time. Reject a `t` too far from your clock, so a captured request cannot be replayed later.

```js
const crypto = require("node:crypto");

function verifyWebhook(secret, rawBody, signatureHeader, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=", 2)),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || typeof parts.v1 !== "string") return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest();
  const received = Buffer.from(parts.v1, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
```

## Ordering and retries

Events reach an endpoint strictly in id order. The engine sends the next event only after the previous one was acknowledged.

When a delivery fails, the engine stops that endpoint. It never skips ahead. It retries the same event after `min(30s × 2^(failures − 1), 1h)`, so 30 seconds, then 1 minute, 2, 4, and so on up to one hour between attempts. `failures`, `lastError`, and `nextAttemptAt` in the listing show the state. A success resets `failures` to 0 and moves on to the next event. `lastError` keeps the most recent error until another one replaces it.

Endpoints are delivered independently. A slow or failing endpoint does not delay another one.

The engine holds back an event for about 2 seconds after it was written. Concurrent writes can commit their event ids out of order, and the wait keeps the cursor from moving past an id that is about to appear.

## At-least-once

Delivery is at least once. The same event can arrive more than once, for example when your receiver acknowledged it but the engine restarted before recording the acknowledgement. Deduplicate on the event id. Because events arrive in order, keeping the highest id you processed is enough.

## Retention

Events are kept for the venue's retention period. If an endpoint stays down longer than that, the oldest undelivered events are pruned before they can be sent. The engine then jumps the endpoint to the oldest event still retained and records the dropped range in `lastError`. Resynchronize by reading the affected reservations.

## Allowed URLs

A webhook makes the engine send requests on the venue's behalf, so the engine refuses targets inside its own network.

- The URL must use `https` and must not contain a user name or password.
- The engine resolves the host name. If any address it resolves to is in a blocked range, the URL fails with `webhook_url_rejected`. The blocked ranges are loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local including cloud metadata (`169.254.0.0/16`, `fe80::/10`), carrier-grade NAT (`100.64.0.0/10`), unspecified (`0.0.0.0/8`, `::`), multicast and reserved (`224.0.0.0/3`, `ff00::/8`), and every IPv4-mapped (`::ffff:a.b.c.d`) or NAT64 (`64:ff9b::a.b.c.d`) form of a blocked IPv4 address.
- The check runs again before each delivery batch, and the engine connects to the exact address it just checked. A DNS record that changes to a private address after registration makes the delivery fail. It does not reach the private address.

The rejection message does not say why. It does not reveal what a host name resolved to.

For local development and tests, `WEBHOOK_ALLOW_INSECURE=true` allows `http` URLs and private addresses. It is off by default. Never set it in production.
