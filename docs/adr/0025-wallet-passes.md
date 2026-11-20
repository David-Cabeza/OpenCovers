# ADR-0025: Wallet passes for bookings (Apple Wallet and Google Wallet)

- Status: Proposed
- Date: 2026-11-20
- Deciders: David Cabeza

Nothing in this record is built. It proposes how a guest saves a booking in the phone's Wallet and how that pass stays current, so that the contract (`docs/contract/openapi.yaml`, plus a new `docs/contract/wallet.md`), the conformance cases and the code can follow, in that order, once it is accepted. It builds on [ADR-0017](0017-booking-widget-and-self-service-link.md) (the `/r` page and its token), [ADR-0022](0022-hosted-demo-sandbox.md) (the demo) and [ADR-0024](0024-guest-email-language.md) (the guest's language). Open questions for the owner are marked `Q1` to `Q8`.

## Decisions at a glance

| # | Question | Recommended | Main alternative rejected |
| --- | --- | --- | --- |
| 1 | Scope | Stage A only: a reservation pass saved from `/r`, updated when the booking changes. Stage B (a loyalty card) is a separate ADR, not decided here. | Building the loyalty card now. |
| 2 | What a "notification" is | Bounded by what each platform offers (section 2). Apple: a lock-screen alert only for a field with `changeMessage` that changes, plus `relevantDate`. Google: `notifyOnUpdate` on a fixed list of fields, and `addMessage`. No marketing channel. | Promising "pushes like a loyalty card". |
| 3 | Shape | One pass per reservation, per platform. The pass has its own opaque serial and a token derived by HMAC from that serial. The "updated since" tag is the event id. | Reusing the reservation id or the self-service token as the pass credential. |
| 4 | Data in the pass | Date, time, party size, venue name, public address and phone, a link. Never a guest name, contact or note. Erasure voids the pass, then deletes its device rows. | Putting the guest's name on the pass. |
| 5 | Secrets | Instance-level environment variables. Each platform is off when its variables are unset. Per-venue credentials are deferred. | Per-venue Apple or Google accounts now. |
| 6 | Shape of the code | Inside `apps/api`. A worker reads the event feed with a cursor, as the webhook worker does. `passkit-generator` for `.pkpass`, Node's `http2` for APNs, `google-auth-library` for Google. | A separate service, or an outbox table written by every write path. |
| 7 | Demo | Off in the hosted demo at launch. | A real certificate shared by every sandbox. |
| 8 | Staging | Seven stages, contract first. | One pull request. |

## Context

The owner asked that, after a guest books, the guest can keep the booking in the phone's Wallet and receive notifications through it, like a loyalty card. A product in this space, loyicard.com, was named as the reference. We design from the platforms' public documentation and from our own requirements, not from any competitor. A second tool the owner named, `github.com/morluto/rea`, is a reverse-engineering MCP tool with no Wallet function, so it plays no part here.

What the code and the docs say today, read on `origin/main` at `cb232dd`:

- A guest booking through the widget gets a self-service link, a token `<linkId>.<secret>` in the URL fragment of `/r`. The database stores only the SHA-256 of the secret (`self_service_links` in `apps/api/src/db/schema.ts`). The link lasts until 48 hours after the booking ends (`LINK_LIFE_MS` in `apps/api/src/lib/self-service.ts`). `GET /public/self-service` takes it in `X-Self-Service-Token`, and every failure is the same `404` `self_service_link_invalid` (`docs/contract/openapi.yaml`, line 2249).
- A modify cannot change the date or the time (ADR-0017, Context). The statuses are closed: `booked`, `seated`, `attended`, `no_show`, `cancelled`.
- `reservations.version` is a per-reservation integer, and every write appends an event (`apps/api/src/db/schema.ts`, `events`). `events.id` is a global bigserial. Since ADR-0024 (`event-commit-order`) a venue's events commit in id order, through the lock in `appendEvents` (`apps/api/src/lib/events.ts`). Events carry no guest data, only `type`, `reservationId`, `version`, and the channel and actor (ADR-0023).
- Webhooks are a cursor over that feed, delivered by a worker with a lease, batches, a timeout and backoff (`apps/api/src/lib/webhooks.ts`: `BATCH_SIZE` 50, `TIMEOUT_MS` 5 s, backoff 30 s to 1 h). Webhooks are blocked in a demo sandbox (`sandboxWebhooksBlocked`, `apps/api/src/demo/limits.ts`).
- Emails to the guest carry only what the engine wrote and never the guest's name or note (`apps/api/src/lib/mailer.ts`, the comment above `buildEmail`). The same rule is kept here.
- Erasure blanks name, contact, guest link, consent, rating, note and reconfirmation, deletes the self-service link, writes a tombstone hash and returns `erased` events (`eraseReservations` in `apps/api/src/lib/venue.ts`).
- A venue's public name, phone and address are already published for JSON-LD (`apps/api/src/lib/public-profile.ts`, `venues.public_phone`).
- Optional integrations are off when their variable is unset: `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (`apps/api/src/lib/mailer.ts`), documented in `.env.example`.
- ADR-0024 is Accepted but not built; its contract stage is open as pull request 253. It stores the guest's language on the booking as `guest_locale`. A pass text should follow it, with the venue's locale as fallback until it ships.

Design rules this must respect (`CLAUDE.md`): a venue's data is isolated, every write carries an idempotency key and produces a monotonic version, store the minimum guest data a booking needs, erasure returns counts and keeps hashes, and the contract and the conformance cases come before the implementation.

## Decision drivers

- **Honest scope.** Say what Wallet can and cannot do before promising it.
- **Minimum guest data.** A pass is a copy of a booking on a device we do not control. Put in it only what the guest already has in the confirmation.
- **Optional and self-hostable.** The feature costs nothing and changes nothing for an operator who does not set it up, as with `RESEND_API_KEY`.
- **Reuse the engine's guarantees.** The event feed and its commit order already say, in order, what changed.
- **No new account of ours holds guest tracking data.** Device registrations are personal data and are kept as short as the pass lives.

## 1. Scope in stages

**Stage A (this ADR).** A reservation pass for a booking made through the public channel. The guest opens `/r`, taps "Add to Apple Wallet" or "Add to Google Wallet", and the pass shows the venue, date, time and party size. It updates when the booking is modified, cancelled or its status changes. Wallet's own reminder comes from the pass's relevance date (section 2). Staff bookings have no self-service link and so no pass in Stage A; a staff-issued pass is an option for a later stage (Q8).

**Stage B (a separate ADR, not decided here).** A persistent loyalty card: points, repeat guests, marketing messages. It collides with "store the minimum guest data a booking needs" and cannot be built on this design. It would need at least:

1. A guest identity across bookings. Today a guest record exists per venue and only when the contact normalizes (ADR-0003), and ADR-0024 rejected a per-guest preference for the same reason: merges and unmerges must reconcile it.
2. An opt-in to marketing, separate from booking consent. `consent` today means "may be contacted after the visit" and defaults to `unknown` (REQ-N4); the engine does not gate on it, integrations do. Marketing needs a recorded, withdrawable, per-purpose consent and wording that passes legal review (GDPR; LSSI-CE in Spain for electronic commercial communications).
3. A point balance and its rules, a lawful basis, a retention period and an erasure path for each of them.
4. A persistent pass per guest and per venue (or per instance), with its own lifecycle, not tied to one booking's end date.
5. A channel to send marketing. Section 2 shows that neither platform offers a free-form one on Apple, and that Google's is capped.
6. A decision on who the controller is: the venue, or OpenCovers.

Stage A is built so Stage B is not blocked: a pass has its own serial and its own table, and nothing in Stage A depends on a guest identity.

## 2. What a Wallet "notification" is

Checked against Apple's and Google's documentation on 2026-11-20 (links at the end). The words matter, because "notifications like a loyalty card" is bounded by them.

**Apple.**

- A device registers a pass with our web service and sends a push token. We then push through APNs with the same certificate and key that signed the pass. The push payload is an empty JSON dictionary (`{}`) ([Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)). It carries no text. It tells the device to ask our web service which passes changed and to fetch them.
- A visible alert comes from a field whose `changeMessage` is set. `changeMessage` is a format string with `%@` for the field's new value, and Apple says "You need to provide a value for the system to show a change notification" ([PassFieldContent](https://developer.apple.com/documentation/walletpasses/passfieldcontent)). The alert text is our string with the new value in it, and it needs a field that changed.
- `relevantDates` (an array of date intervals) and `locations` (up to 10) make Wallet surface the pass on the lock screen near the time or place. `relevantDate` is deprecated in favour of `relevantDates` ([Pass](https://developer.apple.com/documentation/walletpasses/pass)).
- Not verified: whether Wallet shows an alert only for a field with `changeMessage`, or in other cases too. The pages above do not say "only". We design to the documented path and do not depend on the absence of others.

**Google.**

- Updates are REST calls on the object: `PATCH` or `UPDATE`. A push notification can come from `notifyPreference: notifyOnUpdate` in that call, but only for a fixed list of fields: on the class `eventName`, `eventVenue.name`, `eventVenue.address`, `eventDateTime.doorsOpen` and `eventDateTime.start`; on the object `eventSeat.seat`, `row`, `section` and `gate`. It fires only when the event starts in 3 hours or less, at most 3 times per 24 hours, and `notifyPreference` must be set on every request ([Trigger push notifications](https://developers.google.com/wallet/tickets/events/use-cases/trigger-push-notifications)).
- `addMessage` adds a message to the back of the pass. With `TEXT_AND_NOTIFY` it also sends a push. Google controls the lock-screen text. The limit is 3 notifying messages per pass per 24 hours, then `QuotaExceededException`, and Google may throttle what it sees as spam. Messages beyond the limit are sent as plain `TEXT`. A link in a message must go to a site or app related to the pass (same page).
- Users must have notifications enabled for their passes (same page).

**What this means.** Neither platform offers a free-form marketing push on the Apple model: on Apple we choose text only through `changeMessage` on a field that really changed, and the push itself is empty. On Google, `addMessage` lets the issuer write the text, with the limits above. The Google page does not say whether promotional content is allowed, and I did not find a policy page that decides it; Stage B must settle that before relying on it. For Stage A we send only messages that follow from a change to the booking, which both platforms support. So the honest promise is: the pass updates itself, the guest sees an alert when the booking changes (a cancel, a status change, a changed party size), and Wallet reminds the guest near the time. It is not a channel for offers.

**Stage A notifications.** Only these:

| Change | Apple | Google |
| --- | --- | --- |
| Cancelled by staff or guest | `voided: true`, status field changes, its `changeMessage` fires | Object state `INACTIVE`, `addMessage` with `TEXT_AND_NOTIFY` |
| Party size changed | Party field changes, its `changeMessage` fires | `PATCH` the field, `addMessage` with `TEXT_AND_NOTIFY` |
| Status `seated`, `attended`, `no_show` | Status field updates. No `changeMessage` on these (a "no show" alert helps nobody). | `PATCH` only, no notification |
| Time near | `relevantDates` interval around the start | See Q4 and "Not verified" |

## 3. Mapping onto our model

### One pass per reservation, per platform

A new table `wallet_passes`: an opaque `id` (the pass serial, 128 random bits, base64url), `venue_id`, `reservation_id`, `platform` (`apple` or `google`), `state` (`active`, `voided`, `erased`), `content_hash`, `updated_tag` (the id of the last event that changed the content), `reservation_version`, `created_at`. At most one live pass per reservation and platform, enforced by a partial unique index, as `uq_self_service_links_live` does for links.

The pass holds no personal value. Its serial is not the reservation id, so a pass that leaves the phone does not name a booking.

### Credentials: three, kept apart

| Credential | Who holds it | Use |
| --- | --- | --- |
| Self-service token (ADR-0017) | The guest, in `/r` | Asks for a pass. Never placed in the pass. |
| Pass authentication token | Inside the pass, so on every device that has it | Apple sends it as `Authorization: ApplePass <token>` to our web service ([Send an updated pass](https://developer.apple.com/documentation/walletpasses/send-an-updated-pass)). Opens only that pass's web service calls. |
| APNs certificate and key | The instance | Signs the pass and the push. |

The pass token is `HMAC-SHA256(WALLET_TOKEN_SECRET, serial)`, base64url. We derive it instead of storing a hash, because the "latest pass" response must contain the `authenticationToken` again and we hold no plaintext. The cost: rotating `WALLET_TOKEN_SECRET` invalidates every pass (a previous-key variable, as `BLOCKLIST_KEY_PREVIOUS` does for the blocklist). ADR-0017 rejected an HMAC-derived token for the self-service link because a link must be revocable per link; a pass is revoked by its row's `state`, so the objection does not apply here.

The self-service token is never placed in a pass. A pass is copied into iCloud backups, shared by AirDrop and shown on a lock screen; a token in it would turn sharing a pass into the right to cancel the booking. The cost: the pass cannot link straight to `/r#token`, and the "latest pass" request could not rebuild such a link anyway, since we store only the hash. The pass links to the venue's public page and to `/r?lang=` where the guest asks for a new link by email (the lost-link resend, ADR-0017 stage 12).

### Getting the pass from `/r`

Apple needs the browser to navigate to the `.pkpass`, and a navigation cannot send `X-Self-Service-Token`. So: `POST /public/self-service/wallet/apple` with the token header returns a one-time download URL valid for 2 minutes. The page navigates to it and iOS offers "Add to Wallet". For Google, `POST /public/self-service/wallet/google` returns `https://pay.google.com/gp/v/save/<signed JWT>` ([Save link](https://developers.google.com/wallet/tickets/events/web)). Google recommends keeping that JWT under 1800 characters, which a pass with these fields meets. Both routes are limited like the other self-service routes, return the same `404` `self_service_link_invalid` for a bad token, and send `Cache-Control: no-store`.

### Apple PassKit web service

Served under one base path on the API origin, `webServiceURL = <base>/wallet/apple`, outside `/v1` because Apple appends its own `/v1/...`. Endpoints from Apple's reference:

| Call | Method and path | Auth | Answers |
| --- | --- | --- | --- |
| Register | `POST /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}`, body `{"pushToken": "..."}` | `ApplePass` pass token | `201` new, `200` already registered, `401` |
| Unregister | `DELETE` same path | pass token | `200`, `401` |
| Serials updated since | `GET /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}?passesUpdatedSince={tag}` | device library id (no token) | `200` `{serialNumbers, lastUpdated}`, `204` |
| Latest pass | `GET /v1/passes/{passTypeIdentifier}/{serialNumber}` | pass token | `200` `application/vnd.apple.pkpass`, `401` |
| Log | `POST /v1/log` | none | `200` |

Apple's page for the log body does not give the field names; the usual shape is `{"logs": [...]}` (not verified). We accept it, cap the body, and write nothing to the database.

**Venue isolation.** The Apple calls carry no venue. The serial maps to exactly one pass row and so one venue. An unknown serial, a wrong token, a pass of any state we no longer serve and a `passTypeIdentifier` we do not own all return `401`, the same body, because Apple documents `401` as the only failure and a distinct answer would tell a prober which serials exist. This is the equivalent of "another venue's request returns not found" for a surface that has no venue in its path. The "serials updated since" call is authenticated only by the device library identifier (Apple's design); it returns serials, never content, and the identifier is a value only that device knows. We store it as a keyed hash (below).

**The updated-since tag.** `lastUpdated` and `passesUpdatedSince` use `wallet_passes.updated_tag`, the id of the last event that changed the pass's content. Event ids are global and increase, and per venue they commit in order (ADR-0024), so "updated since tag N" never skips a change within a venue, and across venues each pass's own tag is all that is compared. The `version` of a booking is the monotonic value the design rule asks for: a pass row records `reservation_version`, and a stale job (version below the stored one) is dropped.

**Idempotency.** The engine's rule is an `Idempotency-Key` on writes. Apple's calls cannot carry one. They are idempotent by their natural key (device, pass), which Apple's `200` against `201` on register relies on. This is a deliberate, documented exception in `wallet.md`. The reservation writes that cause an update keep their own keys.

### Google Wallet

Google's model is a class and an object, written through the REST API with a service account ([onboarding](https://developers.google.com/wallet/tickets/events/getting-started/onboarding-guide)). We use one class per instance and one object per pass, `id = <issuerId>.<serial>`. A `PATCH` with the full desired state is idempotent, so a retry is harmless.

An event-ticket class fits badly: its date, venue and name sit on the class, one class per venue per day would multiply classes, and the update notification fires only for those class fields. So Stage A uses Google's generic type, which holds the text on the object, and `addMessage` for the two changes that deserve a push. Whether a generic object can drive a time-based lock-screen reminder is not verified (Q4).

### What changes a pass

Only the pass-relevant projection counts: venue name, date, time, party size, status, locale. `content_hash` is the hash of that projection. A `modified` event that changes only the note, consent or rating produces the same hash and sends nothing. An `erased` event is handled in section 4.

## 4. Data minimisation and privacy

**In the pass:** the venue's display name, date, time (in the venue's zone), party size, status, the venue's public address and phone when set, and links to the venue's booking page and to `/r`. The same fields as the confirmation email, plus the public address and phone the venue already publishes.

**Never in the pass:** the guest's name, contact, note, consent, rating, table, zone label, reservation id, booking channel. Whoever books types the name and the note, so on a shared or forwarded pass they would show a stranger's text, which is why `mailer.ts` leaves them out of the emails to the guest. A test, like the one for the emails, builds a pass from a reservation with a hostile name and note and asserts neither appears in the `.pkpass` files or in the Google object.

**No barcode.** A reservation pass needs none. A barcode would carry an identifier that could be scanned from a lock screen.

**Device registrations.** `wallet_registrations`: `pass_id`, `device_hash`, `push_token`, `created_at`, `last_push_at`. The device library identifier is only compared, so we store `HMAC(WALLET_TOKEN_SECRET, id)`. The push token must be sent to APNs, so it is stored in clear. Both identify a device and so are personal data. Retention:

- deleted on unregister;
- deleted when APNs answers that the token is invalid (Apple says to delete a device then, same page as above);
- deleted when the pass ends: 24 hours after the booking's `ends_at`, with the pass row's push stopped at the same time;
- deleted when the booking is erased, after one final push (below).

No device row outlives its pass. There is no analytics on devices.

**Erasure.** `eraseReservations` gains, in the same transaction, a pass update: each pass of the reservation goes to `erased`, `voided`, with its content reduced to the venue name and "Reservation removed" and its `updated_tag` set. The worker then sends the last push and deletes the registrations once APNs accepts it or after 24 hours. A Google object is patched to `INACTIVE` with the same stub, and then left; we hold no data on Google's side to delete. Whatever the guest already saved on the device is the guest's copy: after erasure it is the stub, once the device syncs. The erasure result gains counts of passes and registrations removed, and keeps no hash of them: the serial is random and names nothing. Retention (`apps/api/src/lib/retention.ts`) calls the same function, so it behaves the same.

**Consent wording.** Stage A sends no marketing, only changes to a booking the guest holds, and only after the guest tapped "Add to Wallet" on `/r`. The wording next to the button says what is stored: "Your phone will ask our server for updates to this booking. We keep your phone's update address until the booking ends." That text, and whether the legal basis is the booking itself, wait for the same legal review as the emails (REQ-N2). Stage B's marketing consent is a separate matter (section 1).

## 5. Secrets and who holds them

| Platform | Needs | Cost | Held by |
| --- | --- | --- | --- |
| Apple | An Apple Developer Program membership, a Pass Type ID and its certificate, and Apple's WWDR intermediate certificate. Apple's page I fetched does not state the price; it has been 99 USD a year, to confirm at developer.apple.com/programs. | Paid | The operator |
| Google | A Google Pay & Wallet issuer account and a service account key. In demo mode only users with a role on the issuer account, or added test accounts, can add a pass, and passes are labelled "[TEST ONLY]". Production needs a business profile and Google's review of a "publishing access" request ([publishing access](https://developers.google.com/wallet/tickets/events/getting-started/request-publishing-access)). The pages I fetched give no price. | Not stated in the pages read | The operator |

**No credentials exist yet.** This ADR does not assume any. The owner creates them, or does not.

**Instance-level, from the environment.** Names proposed, none committed, added to `.env.example` commented out:

| Variable | Meaning |
| --- | --- |
| `WALLET_TOKEN_SECRET` | Key for pass tokens and device hashes. Base64 of at least 32 bytes. `WALLET_TOKEN_SECRET_PREVIOUS` during a rotation. |
| `WALLET_APPLE_PASS_TYPE_ID`, `WALLET_APPLE_TEAM_ID` | From the Apple account. |
| `WALLET_APPLE_CERT_PEM`, `WALLET_APPLE_KEY_PEM`, `WALLET_APPLE_KEY_PASSPHRASE`, `WALLET_APPLE_WWDR_PEM` | The signing certificate and key, and the WWDR certificate, as PEM (base64 allowed). |
| `WALLET_APPLE_WEB_SERVICE_URL` | The public HTTPS URL of the Apple web service. Apple requires HTTPS in production. |
| `WALLET_GOOGLE_ISSUER_ID`, `WALLET_GOOGLE_SERVICE_ACCOUNT_JSON` | Issuer id and the service account key (base64 of the JSON). |

Each platform is off when its variables are unset, and the `/r` button for it does not show, as email is off without `RESEND_API_KEY`. A half-set platform stops the API at startup with a message, as `PUBLIC_CHALLENGE_SECRET` and `BLOCKLIST_KEY` do for bad values. `WALLET_TOKEN_SECRET` has no development default: a passwords-in-source default would let anyone forge pass tokens.

**Per-venue credentials: deferred.** A venue with its own Apple account would need its certificate stored encrypted per venue, a key we do not yet have a place for, and a pass type per venue. That is a large step for an unproven feature. Consequence: on a hosted instance, passes come out under the instance operator's Apple team and Google issuer, with the venue's name on the pass. The pass's `organizationName` is the venue's display name (Q6).

## 6. Implementation shape

### Where

All in `apps/api`: `lib/wallet/` (projection, Apple pass builder, Apple web service handlers, APNs client, Google client), the routes in `app.ts` beside the other public routes, one migration by `pnpm db:generate`, the worker started where the webhook worker starts.

### Libraries

| Need | Candidate | Checked on 2026-11-20 | Verdict |
| --- | --- | --- | --- |
| Build and sign a `.pkpass` | `passkit-generator` | npm: 3.7.0, MIT, published 2026-10-14, dependencies `joi`, `tslib`, `do-not-zip`, `node-forge`, not deprecated | Use. Pin it. Review its signing path at stage 2. |
| Same, by hand | zip, SHA-1 manifest, detached PKCS#7 signature | | Not now: more code to get wrong. A fallback if the library lapses. |
| APNs push | Node's built-in `node:http2` with the pass certificate as client certificate | No dependency | Use. The push is one request: `POST /3/device/<token>`, topic the Pass Type ID, empty body `{}`. |
| APNs push, library | `@parse/node-apn` 8.2.0, MIT, modified 2026-11-01 | Whether it supports a pass push (topic, no alert) is not verified | Not chosen. |
| Google REST auth | `google-auth-library` 11.3.4, Apache-2.0, `node >=22` | Fits `.nvmrc` | Use for the access token. |
| Google Save link JWT | `node:crypto` RS256 with the service account key | No dependency | Use. |
| Google, whole SDK | `googleapis` 190.0.0, Apache-2.0 | Very large | Rejected. |

Licences are compatible with Apache-2.0. Each added dependency goes through the project's usual review; there are no Wallet dependencies today (`apps/api/package.json` lists seven runtime ones).

### The worker

A pass update must not delay or fail a booking, and must be retried. So it runs after commit, from the event feed, not inside the request.

- A cursor per venue over `getEvents`, with a lease, batches and exponential backoff, the same shape as the webhook worker (`apps/api/src/lib/webhooks.ts`). Because a venue's events commit in id order (ADR-0024), the cursor never passes a pending event.
- For each event of a reservation that has a live pass: recompute the projection from the current reservation, compare `content_hash`, and if it changed, update `updated_tag`, send the APNs push to each registration, `PATCH` the Google object. The projection is read from the database now, not from the event, so a replay or a retry gives the same result.
- Apple's push is empty and idempotent: a second one costs a request. Google's `PATCH` is idempotent. `addMessage` is not, so the worker records the event id it sent for in the pass row before sending and skips a repeat. That makes it at-most-once for a notifying message, on purpose: a missed alert is better than a repeated one under Google's 3 per 24 hours.
- A cursor exists only for a venue with at least one live pass, so an instance without Wallet pays nothing.

**Why not an outbox written by each write path:** `appendEvents` must be the last statement of a transaction (`apps/api/src/lib/events.ts`), and every write path would change. The feed already carries what we need.

**Relation to webhooks and the feed.** No new event type, no change to the feed or to webhook payloads (C11 and its cases stay as they are). A pass is not a reservation change, so it writes no event. Webhook consumers are unaffected, and a pass's push does not depend on a venue's endpoints.

### Contract

`docs/contract/wallet.md` (new) for the Apple web service and the failure answers. `openapi.yaml` gains the two `POST /public/self-service/wallet/{apple,google}` routes and a `wallet` object in the public booking config saying which platforms are on, so the widget shows only the buttons that work. New conformance cases, GAP in `conformance-status.md` until built: passes only for a booking with a live link; a bad token fails like `self_service_link_invalid`; Apple register, unregister and serials; `401` uniform; cancel voids; erasure voids, stops pushes and deletes registrations; no guest text in a pass. MCP: unchanged, as the self-service routes are not exposed through it.

### The demo (ADR-0022)

**Off in the hosted demo at launch.** A demo cannot ship a certificate per visitor, and a shared one would put the owner's Apple team behind passes for invented bookings, with push tokens of strangers' phones on a demo database we delete after 14 days. The sandbox hides both buttons (the wallet block of the public config reports both platforms off), and `/r` in a demo shows a one-line note that passes need the operator's Apple and Google accounts. This matches how the demo already blocks webhook delivery (`sandboxWebhooksBlocked`). Per `CLAUDE.md` a feature that adds a screen or a setting also goes into `apps/api/src/demo/template.ts`; here the setting is the instance's, not the venue's, so the template needs no change, and stage 7 states so in its description (Q5 offers an alternative).

### Staging

Each stage is one pull request. A contract stage changes `openapi.yaml`, `conformance.md` and `conformance-status.md` together, with new cases as GAP.

| Stage | Flag | Depends on | Ships alone |
| --- | --- | --- | --- |
| 0 | This ADR, accepted. | none | yes |
| 1 | Contract: `wallet.md`, the two public routes, the config block, the cases, erasure counts. | 0 | yes |
| 2 | Pass projection and `.pkpass` generation, `wallet_passes` migration, the download route, off unless Apple variables are set. No web service yet, so the pass does not update. | 1 | yes |
| 3 | Apple web service and the worker with the APNs client, erasure and retention hooks. | 2 | yes |
| 4 | Google: class, object, Save link, `PATCH` and `addMessage` from the worker. | 2 | yes, in parallel with 3 |
| 5 | The `/r` buttons, the consent wording, localization of the pass text (reviewed locales only, ADR-0024 Q3). | 3 or 4 | yes |
| 6 | Docs: `docs/deploy.md` section on obtaining the credentials, `.env.example`, README note. | 3 | with 5 |
| 7 | Demo: confirm off, the `/r` note, and the CI check. | 5 | yes |

Real devices are needed for stages 3 to 5 and cannot be tested in CI; the stage descriptions list what was tried by hand.

## 7. Legal and brand

- **Apple.** Use only Apple's badge artwork, never our own; keep it secondary to the page's message; do not dim, animate or add effects; and add instructions to open it on an iPhone, since the page may be open on another device. Write "Apple Wallet" and "Wallet" as Apple specifies. Do not suggest an association with Apple. The licence covers only our passes and lasts while the Apple Developer Program membership does, and Apple may end it on 10 days' written notice. Where legal information appears, the credit line "Apple, Apple Watch, iPhone, and iPod touch are trademarks of Apple Inc., registered in the U.S. and other countries" is required ([Add to Apple Wallet guidelines](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/)).
- **Google.** Use only Google's "Add to Google Wallet" button, unmodified, black, at least 48 dp high with 8 dp of clear space, localized where a version exists; write "Google Wallet" in full; place it on a confirmation screen; and follow the pass limits, among them title under 47 characters, notification title under 29 and body under 40 collapsed and 80 expanded ([brand guidelines](https://developers.google.com/wallet/tickets/events/resources/brand-guidelines)). All pass content and linked sites must follow Google's Payments content policies (same page).
- **Whose name is on the pass.** The venue's. The pass shows the venue's name and details, with no OpenCovers branding in the guest's face, in line with ADR-0017's "no OpenCovers branding" widget. A small "Powered by OpenCovers" back-of-pass field is possible only if both platforms' rules allow it, which I did not find stated; so Stage A has none. Operators who want it add it to the venue's own text. Revisit when Apple's and Google's pass design pages are read in full (Q6).
- **Not verified:** Apple's review rules for passes in general, and whether Apple requires an app or the owner's name on `organizationName`.

## 8. Alternatives considered

- **A loyalty card first.** Rejected for now: it needs the guest identity, consent and marketing channel listed in section 1, and the platforms do not offer a free-form push.
- **Pass token stored as a hash.** Rejected: the "latest pass" response must contain the token, and we would hold none.
- **The self-service token inside the pass.** Rejected: sharing a pass would give away the right to change or cancel a booking, and the update could not rebuild it.
- **The reservation id as the serial.** Rejected: a pass that leaves the phone would name a booking.
- **An outbox row from every write path.** Rejected: it changes every write path and the events lock rule; the feed has what we need.
- **Webhooks as the trigger.** Rejected: webhooks belong to the venue's own endpoints, are blocked in the demo and carry no guest data; the worker reads the feed itself.
- **Per-venue Apple and Google accounts.** Deferred (Q3).
- **Event ticket class on Google.** Rejected for the reasons in section 3.
- **A separate pass service.** Rejected: the pass needs the same database, the same erasure transaction and the same feed.
- **Barcode or QR on the pass.** Rejected: nothing to scan at a table, and an identifier on the lock screen.

## Consequences

**Easier.** A guest keeps the booking in the Wallet and sees an alert if it is cancelled or its party size changes. The feature costs an operator nothing until the variables are set. The event feed and its commit order do the ordering work.

**Harder.** A second set of credentials to obtain, rotate and document. A paid Apple membership for anyone who wants Apple passes. Real-device testing. Two more tables on the erasure and retention paths, which must stay in step with them. Pass text to translate and to put through legal review, one language at a time (ADR-0024).

**Accepted.** A pass cannot link to the booking's management page. A guest who erases nothing keeps a copy of the booking on the phone, which is theirs. Without per-venue credentials, a venue's passes come from the operator's Apple team and Google issuer. On a hosted instance that means ours. Google's `addMessage` is at most once, so a notification can be missed. Wallet never offers a marketing channel on Apple.

**Changes to existing rules.** ADR-0017 section 4 lists what the guest view shows and what erasure removes; erasure now also voids passes and deletes registrations, and its counts gain two. C5 and C18 list what erasure and retention do and gain the same. ADR-0022's template needs no change. No existing rule is weakened.

## Open questions for the owner

- **Q1. Who holds the Apple Developer account?** Recommend a company or personal account of the owner for the hosted instance, and say plainly in `docs/deploy.md` that a self-hoster needs their own. The certificate expires and must be renewed; put the date in the operator's calendar. If the owner does not want to hold one, Stage A ships Google only.
- **Q2. Apple and Google together?** Recommend Apple first for the work (the web service and APNs are the hard part), Google right after as its own stage; the contract and `/r` cover both from stage 1. Google needs no cost beyond review.
- **Q3. Per-venue credentials?** Recommend no. Revisit when a hosted venue asks to be under its own brand on the lock screen.
- **Q4. Google generic type or event ticket?** Recommend generic. Before stage 4, read Google's generic-pass docs for a time-based reminder on an object; if none exists, Google passes get the cancel and party-size alerts but no reminder.
- **Q5. Demo behaviour?** Recommend off (section 6). The alternative is a real instance certificate with the pass named "OpenCovers demo", which shows the feature but puts visitors' push tokens and the owner's Apple team into a throwaway stack.
- **Q6. Name on the pass.** Recommend the venue's name only, no OpenCovers mention, until the platforms' rules are read in full.
- **Q7. Loyalty card (Stage B), yes or no?** Recommend not now. Decide after Stage A has real use and a lawyer has answered the controller and consent questions in section 1. A loyalty card is a product and a legal project, not a feature of this ADR.
- **Q8. Staff-issued passes?** Today only a booking with a self-service link can get a pass. Recommend leaving staff bookings out of Stage A, and asking whether a venue wants to send a pass by email for phone bookings. That would need a stored link for staff bookings, which ADR-0017 does not give them.

## Evidence and limits

Verified in code at `cb232dd`: `apps/api/src/lib/mailer.ts`, `apps/api/src/lib/venue.ts` (`eraseReservations`), `apps/api/src/lib/events.ts`, `apps/api/src/lib/webhooks.ts`, `apps/api/src/lib/self-service.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/demo/limits.ts`, `docs/contract/openapi.yaml` (`/public/self-service`), `docs/requirements.md` (REQ-N2, REQ-N4), `.env.example`.

Verified in documentation on 2026-11-20 (fetched, not recalled): the Apple pages named in section 2 and 3 (the JSON behind `developer.apple.com/documentation/walletpasses`), the Apple Wallet badge guidelines, and the Google Wallet pages for push notifications, the Save link, the brand guidelines, onboarding and publishing access. Package facts from the npm registry.

Not verified:

- That Wallet shows an alert only for a field with `changeMessage`. The pages do not say "only".
- Apple's `authenticationToken` minimum length (the pages fetched give none; 16 characters is recalled) and the log body's field names.
- That Apple's page for `webServiceURL` requires HTTPS in production. The overview says so; the key's own description does not.
- Apple's Developer Program price, and Google's cost, if any.
- Google's policy on promotional messages, and a time-based reminder for a generic object.
- Apple's and Google's general pass review rules, and whether a "Powered by" mention is allowed.
- Whether `@parse/node-apn` can push a pass, and whether `passkit-generator` signs with the current WWDR certificate. Neither was run.
- Anything on a real device. No pass was built or installed for this record.
- The number of Google classes an issuer may hold.

## Sources

- Apple, [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes)
- Apple, [Pass](https://developer.apple.com/documentation/walletpasses/pass), [PassFieldContent](https://developer.apple.com/documentation/walletpasses/passfieldcontent), [Send an updated pass](https://developer.apple.com/documentation/walletpasses/send-an-updated-pass)
- Apple, [Add to Apple Wallet guidelines](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/)
- Google, [Trigger push notifications](https://developers.google.com/wallet/tickets/events/use-cases/trigger-push-notifications), [Save link](https://developers.google.com/wallet/tickets/events/web), [`addMessage`](https://developers.google.com/wallet/tickets/events/rest/v1/eventticketobject/addmessage), [brand guidelines](https://developers.google.com/wallet/tickets/events/resources/brand-guidelines), [request publishing access](https://developers.google.com/wallet/tickets/events/getting-started/request-publishing-access)
- npm: `passkit-generator`, `google-auth-library`, `@parse/node-apn`, `googleapis`
