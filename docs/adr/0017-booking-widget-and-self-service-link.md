# ADR-0017: Guest booking widget and self-service link

- Status: Accepted
- Date: 2026-11-17
- Deciders: David Cabeza

Nothing in this record is built. It decides the design so that the contract (`docs/contract/openapi.yaml`), the conformance cases and the code can follow it, in that order. The maintainer accepted decisions 1 to 14 and answered Q1 to Q4 on 2026-11-17. The other open questions are answered before the stage that needs them.

## Decisions at a glance

| # | Question | Decision | Main alternative rejected |
| --- | --- | --- | --- |
| 1 | How the widget reaches the venue's page | An iframe that loads a widget page from a separate widget origin (`WIDGET_ADDRESS`), required in production. Local development alone may serve it from the staff app's origin on a separate path (Q1). A copy-paste `<iframe>` snippet, plus an optional resize script later. | A script that renders into the host page (shadow DOM or a web component). |
| 2 | Framing policy | The staff app keeps `X-Frame-Options: DENY` and `frame-ancestors 'none'`. The widget page sends `frame-ancestors` built per venue from its allowed origins, and no `X-Frame-Options`. | One static policy for every venue in the Caddyfile. |
| 3 | JSON-LD | Stays where ADR-0012 put it, in the host page HTML. The widget never emits JSON-LD and is `noindex`. | JSON-LD inside the widget page. |
| 4 | Public API routes | A separate prefix, `/v1/public/...`, outside the venue auth middleware. Guests can read the widget config, read availability, create a booking, and read, modify or cancel their own booking with a self-service token. | Public routes under `/v1/venues/{venueId}/` registered above the middleware. |
| 5 | Which venue a guest addresses | A per-venue public booking key. It is not a secret and not a credential. It names the venue, gates online booking, and can be rotated. | The venue UUID in the URL with no key. |
| 6 | Self-service link | A capability token `<linkId>.<secret>` for one reservation. The database stores only the SHA-256 hash, as for invitations (ADR-0006, Q4). The token travels in the URL fragment. It expires 48 hours after the booking ends. It rotates on a create replay, a staff reissue and a lost-link resend, and a guest cancel revokes it with no replacement (Q3). | A signed, stateless token such as a JWT, or an HMAC-derived token. |
| 7 | Rate limits | Extend ADR-0007 with three rules for `/v1/public`: reads per address, booking creates per address, and token use per address. Add a per-venue ceiling on public creates. | No limit on public reads, as ADR-0012 chose for the JSON-LD route. |
| 8 | Bot protection | A honeypot field and a signed form challenge with a minimum fill time and a small proof of work, on by default. Turnstile or hCaptcha only as an operator opt-in. | A mandatory third-party CAPTCHA. |
| 9 | Slot hoarding | A cap on open future online bookings per contact (default 2), the existing ADR-0013 per-day cap, online lead time and horizon. The public channel never uses the overbooking ceiling. | Email verification before a booking counts. |
| 10 | Guest data collected | Name, one contact, party size, date and time, an optional note, and consent only when the venue turns the question on. No allergy or diet field until the legal review. | A structured allergy field. |
| 11 | Per-venue settings | A new admin resource `online-booking`, separate from `config` and from the public profile. Themes are validated data only. | More fields on `PUT /config`. |
| 12 | Confirmation mode | Auto-confirm only in the first release (Q2). Every online booking is `booked` at once when there is room. `confirmationMode` accepts only `auto`, and `approval` stays reserved. A `pending` status that holds tables is deferred to stage 14. | A `pending` status in the first release, or an approval flag on `booked`. |
| 13 | Attribution | `bookedVia: "widget"`, `ownerPrincipal: "widget"`, `basis: "service"`, set by the route. | Per-key principals. |
| 14 | Events, webhooks, email | The same `created`, `modified` and `cancelled` events. The confirmation email carries the self-service link and stays gated by `notificationsEnabled`. | A new event type per channel. |

## Context

Phase 11 of `ROADMAP.md` lists an embeddable booking widget with no OpenCovers branding, a self-service link to view, change or cancel a booking, theme tokens and localization. Its exit criterion is that a venue puts a branded booking page on its own site without writing code.

Today every route that touches reservations sits behind the venue auth middleware in `apps/api/src/app.ts`, mounted on `/v1/venues/:venueId/*`. A caller is either a staff session with a membership or an API key with the role `read`, `write` or `admin`. The only unauthenticated venue route is `GET /v1/venues/{venueId}/public.jsonld` (ADR-0012), registered above that middleware. ADR-0012 already names the risk of that placement: a reorder could widen exposure.

Facts this design rests on, read in the code and the docs on `main` at `1d3c5e9`:

- `POST /v1/venues/{venueId}/reservations` requires an `Idempotency-Key` header and calls `createReservation` with `bookedVia` and `ownerPrincipal` set to the caller's principal and `basis: "service"`. A caller cannot set those fields (REQ-G3, C12).
- `createReservation` decides availability and writes the booking in one transaction (REQ-B1). The GiST exclusion constraint `table_allocations_no_overlap` rejects a double-held table (REQ-B2). A booking accepted under the overbooking ceiling holds no table (ADR-0004).
- `modifyReservation` changes party size, tables, consent, rating, note and reconfirmation. It cannot change the date or time (ADR-0013).
- Lead time, horizon, blocked dates and the per-guest per-day cap already exist (`leadTimeMinutes`, ADR-0013). Services carry party limits and weekdays (ADR-0015).
- The status vocabulary is closed: `booked`, `seated`, `attended`, `no_show`, `cancelled` (REQ-B6). There is no pending state.
- Consent is per reservation and tri-state, `unknown`, `granted` or `denied` (REQ-N4). Its text and legal basis wait for a legal review.
- The booking note holds up to 500 characters and is not for health data. No allergy or diet field exists until a legal review (REQ-N6, ADR-0003).
- `notifyReservation` sends `confirmation`, `cancellation` and `notice` emails once per reservation and version, and only when the venue sets `notificationsEnabled` (off by default, REQ-N2).
- Webhook and feed events carry ids, a type and a version, and no guest data (`docs/contract/webhooks.md`).
- `apps/web/Caddyfile` sends `X-Frame-Options: DENY` and a CSP with `frame-ancestors 'none'` on every response it serves, the API routes included.
- The rate limiter (ADR-0007) keys on the client address, keeps counters in memory, never reads the body, and never limits `GET`, `HEAD` or `OPTIONS`.
- The error vocabulary already holds `approval_required` and `confirmation_required`, unused by any route today.

## Decision drivers

- **The design rules hold for the public channel exactly as for staff.** One transaction, the exclusion constraint, idempotency keys, monotonic versions, venue isolation, minimum guest data.
- **A guest is not a principal.** A guest has no account, no session and no API key. What a guest may do must be narrower than a `write` key, and enumerable from the routes alone.
- **The staff app's framing policy does not change.**
- **Vendor-neutral by default.** No third-party service is required to take an online booking.
- **Legal review gates guest-facing text.** Consent wording, email text and health data stay off until reviewed.
- **Small stages.** Each stage is one pull request, contract first.

## 1. Delivery

### Options

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| A. Iframe | The venue pastes `<iframe src="https://book.example.com/w/{bookingKey}">`. The widget is a separate page on a separate origin. | The host page cannot read what the guest types. The host's CSS and scripts cannot break it. API calls are same-origin from the widget page, so no CORS. Works on any site builder that accepts HTML. The same page works top-level as a hosted booking page. | Fixed height unless a resize script runs. Looks less native. The host page must allow the widget origin in its own `frame-src`, if it has a CSP. |
| B. Script with shadow DOM | The venue adds `<script src=".../embed.js" data-key="...">`. The script renders into a shadow root in the host page. | Native look, automatic height. | Runs in the host's origin. Any host script can read the form, including the guest's contact. Shadow DOM is not a security boundary. API calls become cross-origin, so the API needs CORS per venue. The host's CSP must allow the script and `connect-src`. A broken or hostile host page can alter the form. |
| C. Web component | `<opencovers-booking key="...">` defined by a script. | Same as B, with a cleaner tag. | Same as B. A custom element is a script in the host page. |

### Decision

Use option A. The widget is a separate front-end build (a new `apps/widget`, React and Tailwind like `apps/web`, no shadcn dependency it does not need), served from its own origin.

The deciding reason is the guest's data. In option B or C every script on the venue's page, including its analytics and ad tags, can read the name and contact as the guest types them. In an iframe from another origin the browser stops that. The second reason is that option A needs no CORS on the booking routes, which keeps the public API simple to reason about.

The snippet is plain HTML, so a venue with a site builder can paste it:

```html
<iframe src="https://book.example.com/w/pk_7Hc2..." title="Reservas" width="100%" height="640" style="border:0"></iframe>
```

A later stage adds an optional `embed.js` that only creates the iframe and resizes it. The widget page posts its height with `postMessage` to the parent, and `embed.js` accepts the message only when `event.origin` is the widget origin and the message has the expected shape. The message carries a height and nothing else. No guest data ever crosses `postMessage`.

The same page opened top-level is the hosted booking page. A venue without a site can link to it, and the public profile's `bookingUrl` (ADR-0012) can point to it.

### Origins and framing

The widget gets its own origin, for example `book.example.com`, as a second site block in the Caddyfile with its own address variable (`WIDGET_ADDRESS`). In production it must not share the staff app's origin, and a production instance that serves the widget requires `WIDGET_ADDRESS` (Q1). A shared origin would put the staff session cookie in reach of any bug in the widget, and would force path exceptions into the staff app's headers.

#### Local development

Local development alone may serve the widget from the staff app's origin on a separate path, so a contributor needs no second domain or certificate (Q1, option B).

- The staff app's dev server on `:5173` proxies `/w/*` to the API, beside the `/api` and `/v1` proxies it already has. `/v1/public/*` already reaches the API through the `/v1` proxy. The widget opens at `http://localhost:5173/w/{bookingKey}`.
- There is no second Caddy site block and no `WIDGET_ADDRESS` in development. Caddy is not in the development loop.
- The browser holds the staff session cookie for that origin and attaches it to same-origin requests. In development the widget is kept away from it by code, not by the browser. The widget calls only `/v1/public/*`, and every call sets `credentials: "omit"`, so the cookie is not sent. No route under `/v1/public/` reads a cookie or a session, so a cookie that arrives anyway changes nothing. A test pins that a public request with a staff cookie gets the same answer as one without. The widget sets no cookies of its own.
- The exception never ships. `compose.prod.yaml` and the production Caddyfile serve the widget only from the `WIDGET_ADDRESS` site block, and the staff site block never proxies `/w/*`.

| Response | `X-Frame-Options` | CSP `frame-ancestors` | Set by |
| --- | --- | --- | --- |
| Staff app, every path (unchanged) | `DENY` | `'none'` | `apps/web/Caddyfile`, staff site block |
| Widget page `GET /w/{bookingKey}` | not sent | `'self'` plus the venue's `allowedOrigins`. `'none'` when the list is empty, so the page works only top-level. | The API, per venue |
| Widget static assets (`/assets/*`) | not sent | not needed. Assets are not framed documents. | Caddy, widget site block |
| `/v1/public/*` JSON | not sent | `'none'` | Caddy, widget site block |

`X-Frame-Options` cannot list origins (`ALLOW-FROM` is obsolete and ignored by current browsers), so the widget page relies on `frame-ancestors`, which every current browser supports. The page must be served by the API, not by Caddy as a static file, because the header differs per venue. The API returns a small HTML shell that loads the hashed widget assets. Caddy's widget site block proxies `/w/*` and `/v1/public/*` to the API and serves `/assets/*` as files.

The rest of the widget page's CSP stays as strict as the staff app's: `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; object-src 'none'`. `img-src https:` is for the venue logo URL (see section 5). The page also sends `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. The widget sets no cookies and uses no browser storage, so third-party cookie blocking does not affect it.

An unknown or disabled booking key returns the `404` page with `frame-ancestors 'none'`.

### JSON-LD

The rule from ADR-0012 stands. The venue's server prints the `public.jsonld` document into its own page HTML. Content inside an iframe belongs to the framed page, so the widget never emits JSON-LD. The widget page sends `X-Robots-Tag: noindex` and `<meta name="robots" content="noindex">` so a crawler does not index it as a second page for the venue. Nothing in this ADR changes the JSON-LD route.

## 2. Public booking API

### Route placement

All guest routes live under `/v1/public/`, a prefix the venue auth middleware does not match. A route there cannot become authenticated, or unauthenticated, by a reorder in `app.ts`. The JSON-LD route stays where it is. Moving it would break the URLs venues already embed.

### How a guest names a venue

| Option | For | Against |
| --- | --- | --- |
| A. No key. The venue UUID in the path. | Nothing new to store. | The venue UUID also appears in staff URLs and API calls. Online booking cannot be switched off for an old embed without switching off the venue. Nothing to rotate when a venue wants to cut off copies of its widget. |
| B. A per-venue public booking key. | One switch for online booking. Rotating it cuts every old embed at once. The venue UUID stays out of public pages. | One more value to manage. People will mistake it for a secret. |
| C. A secret embed key or a signed embed token. | None that holds. | A secret pasted into public HTML is not a secret. It would add ceremony and no control. |

Decision. Option B. The key is `pk_` followed by 16 random bytes in base64url. It is public by design, sits in the page HTML, and authenticates nothing. The routes treat it as a lookup handle. An admin creates it by enabling online booking and replaces it with a rotate call. The old key stops working at once, with no grace period. An unknown key, a rotated key and a venue with online booking off all return the same `404 venue_not_found`, with the same body and headers.

### Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `GET /v1/public/{bookingKey}` | Widget config. | Display name, locale, theme, online party limits, bookable days, a fresh form challenge. No address, no notice address, no keys. |
| `GET /v1/public/{bookingKey}/availability?date=&partySize=` | Bookable times for a date and party size. | Times only. No table ids, no zones, no counts of free covers. |
| `POST /v1/public/{bookingKey}/reservations` | Create a booking. | Needs `Idempotency-Key`. Returns the guest view and the self-service token once. |
| `GET /v1/public/self-service` | Read the booking the token names. | Token in the `X-Self-Service-Token` header. |
| `POST /v1/public/self-service/modify` | Change party size, note or consent. | Needs `Idempotency-Key`. |
| `POST /v1/public/self-service/cancel` | Cancel. | Needs `Idempotency-Key`. Revokes the link in the same transaction and issues no new one (Q3). |

The self-service routes carry no venue id and no reservation id. The token names both. A guest cannot address a reservation other than the one the token was minted for.

### How the design rules apply

- **One transaction.** The public create calls `createReservation`. Availability and the write stay in one transaction. The public routes add no second check outside it. Online limits (party size, lead time, horizon, services, weekdays, open bookings per contact) run inside the same transaction, through the same reason functions that availability calls, so the public availability and the public create agree by construction, as C20 and C21 require for staff.
- **No overlap.** The exclusion constraint is untouched. A public booking always holds a table. `createReservation` gains a channel input that turns the overbooking path off. A create that would need the ceiling fails with `slot_taken`, and public availability never shows a time that only the ceiling could fill. The ceiling stays a staff tool (ADR-0004).
- **No table or zone choice.** The public create refuses `tables` and `zone` with `invalid_request`. The engine assigns the table (REQ-B3).
- **Idempotency.** The widget generates one `Idempotency-Key` (a random UUID) per submit and keeps it in memory, so a retry after a network failure replays instead of booking twice. Idempotency keys are scoped per venue today (`idempotency_keys` has the primary key `(venue_id, key)`), so a guest-chosen key could collide with a key a staff client or an integration used, and a replay would then hand that other booking, and a fresh token for it, to the guest. The public routes therefore accept only a UUID as the key and store it with a `public:` prefix, so a public request can replay only a public request. A test pins that a public create with a key already used by a staff create books nothing and returns nothing of the staff booking.
- **Monotonic versions.** Guest writes go through `modifyReservation` and `cancelReservation`, so each change bumps the version once and emits one event. A guest modify also carries the `version` the guest saw. If the stored version is higher, the modify fails with a new `409 reservation_changed` and the widget reloads the booking. Staff writes do not need this check because staff see the agenda live. A guest may hold a page open for hours.
- **Venue isolation.** The booking key resolves to one venue, and the token resolves to one reservation in one venue. Every query below the route uses that venue id. An unknown key and a key for another venue are indistinguishable.
- **Minimum data.** See section 4.

### What a guest may change

Party size, the note and consent. Party size runs the same table search as a staff modify, and the online party limits apply. A guest cannot change the date or time, because `modifyReservation` cannot. To move a booking a guest cancels and books again, and the widget says so. A real move needs a modify that re-runs the time rules, which ADR-0013 names as a future change. That is open question Q5.

A guest can modify or cancel only while the booking is `booked` and the start is more than `selfServiceCutoffMinutes` away (default 120). Later, the write fails with a new `409 self_service_closed`, and the widget shows the venue's phone from the public profile when one is set. Reading stays possible until the token expires or is revoked. A guest cancel revokes it (Q3).

### The self-service token

| Property | Decision |
| --- | --- |
| Format | `<linkId>.<secret>`. `linkId` is a random UUID. `secret` is 32 random bytes from `node:crypto` in base64url. |
| Storage | A table `self_service_links` with `id`, `venue_id`, `reservation_id`, `secret_hash` (SHA-256, hex), `created_at`, `expires_at`, `revoked_at`. At most one unrevoked link per reservation, by a partial unique index. Foreign keys cascade on delete of the venue and the reservation. |
| Compare | Look up by `linkId`, hash the presented secret, compare with `timingSafeEqual`. An unknown `linkId` runs the same compare against a dummy hash. Expiry uses the database clock. |
| Scope | One reservation. Read, modify within the rules above, cancel. Nothing else. |
| Delivery | Returned once in the create response and passed in memory to the confirmation email. Never stored in clear and never logged. The staff reissue call below is the only staff route that returns one. |
| URL | `https://book.example.com/r#<token>`. The token is in the fragment, which browsers do not send to the server, write to proxy logs or put in a `Referer`. The page reads it and sends it in the `X-Self-Service-Token` header. |
| Expiry | 48 hours after the booking's end time. A Phase 13 rating link may extend this later. |
| Revocation | On erasure, on retention expiry of the reservation, on rotation, and on a guest cancel. A guest cancel revokes the link in the cancel transaction and mints no new one (Q3). Rows are deleted 30 days after expiry, as invitations are (ADR-0006). |
| Rotation | On an idempotent replay of the create, on a staff "reissue link" call, and on a guest "send me a new link" request. Each rotation revokes the old link and mints a new one in one transaction. Not on a guest modify (Q3). |
| Failure | Unknown id, wrong secret, expired, revoked, erased, and any venue: all return the same `404 self_service_link_invalid`. |
| Caching | Every self-service response sends `Cache-Control: no-store`. |

Why rotation on replay. The idempotency record stores the reservation id and version, not the response, and the token must not be stored in clear. A replay therefore cannot return the original token. It rotates instead, returns the new token, and sends one new link email when email is on. The email that carried the first token then holds a dead link, which is the cost of storing only a hash.

Why not rotate on every guest change. Rotation on modify kills the link in the guest's email each time the guest changes the party size, and it does not stop an attacker who already holds the token, because the attacker acts before the guest. It costs the guest and protects little. The maintainer chose no rotation on modify (Q3).

Why revoke on a guest cancel. A cancelled booking needs no link. A guest who wants to come after all books again, which creates a new reservation with its own link. Revoking at the cancel leaves nothing live for a forwarded or leaked link to read. The cancel response is the last answer the link gives. It carries the cancelled guest view and no token. A staff cancel does not revoke the link, so the guest can still read that the venue cancelled.

### Staff reissue

`POST /v1/venues/{venueId}/reservations/{reservationId}/self-service-link`, with a `write` or `admin` role and an `Idempotency-Key`, rotates the link of a `booked` reservation. It returns the new token once, so staff can read the link to a guest on the phone, and emails it when email is on. It is the only staff route that ever sees a token. It refuses a reservation that is not `booked` with `invalid_transition`, so a cancelled booking never gets a new link.

### A lost link

A guest who lost the link asks for a new one with `POST /v1/public/{bookingKey}/self-service/resend` and an email address. The route always answers `202` with the same body, whether or not a booking matches, and does its work after the response. When `notificationsEnabled` is on and the normalized email matches future `booked` bookings of that venue, it rotates each one's link and emails the new links to that address. The address is the one stored on the booking, so the link only ever goes where the booking already sends mail. It is rate limited per address and per contact. This route is a later stage and depends on email being on.

## 3. Abuse resistance

### Rate limits (extends ADR-0007)

ADR-0007 never limits `GET`. This ADR makes one exception: `GET` requests under `/v1/public/` are limited, because public availability runs a table search for anyone. The JSON-LD route keeps ADR-0012's choice.

| Rule | Matches | Key | Default |
| --- | --- | --- | --- |
| `public_read` | `GET` under `/v1/public/` | address | 300 per 15 minutes |
| `public_booking` | `POST /v1/public/{bookingKey}/reservations` and `.../self-service/resend` | address | 10 per hour |
| `public_venue` | the same `POST` routes | venue | 100 per hour |
| `self_service` | every `/v1/public/self-service` request | address | 60 per 15 minutes |

The limiter keeps its shape: fixed windows, in memory, `429 rate_limited` with `Retry-After`, the same body whatever the request names. `public_venue` is the one rule keyed by venue instead of address. The limiter reads the booking key from the path, which it already parses, and never the body. Each rule gets a `RATE_LIMIT_PUBLIC_*` variable in the ADR-0007 format. `TRUST_PROXY` must be right for every rule keyed by address, as ADR-0007 explains, and the widget site block in Caddy replaces `X-Forwarded-For` the same way the staff block does.

`public_venue` caps what a distributed attacker can book in one venue in an hour. It is also a lever for denial of service: whoever spends it stops every online booking in that venue until the window ends. Staff bookings are untouched. The default is high enough for a busy venue and low enough to bound a flood. Q6 asks whether it should be a per-venue setting.

Note 2026-11-17 (ADR-0007, amendment of that date): a create that answers `400` or `404` gives its `public_venue` charge back, so a malformed body or an unknown key spends only the sender's `public_booking` budget. IPv6 addresses are keyed by `/48`. A body over 16 KB under `/v1/public/` fails with `invalid_request`.

A per-contact limit cannot live in the limiter, because the limiter does not read the body. It lives in the create transaction as the open-bookings cap below.

### Bot protection

| Layer | Decision |
| --- | --- |
| Honeypot | One text input hidden off-screen with `aria-hidden="true"`, `tabindex="-1"` and `autocomplete="off"`, with a name that autofill does not target. A non-empty value fails with `invalid_request`, the same response as any other malformed form. |
| Form challenge | `GET /v1/public/{bookingKey}` returns a challenge: a random nonce, the time it was issued, a difficulty, and an HMAC over all three with a server key. The create sends it back with a solution. The API refuses a challenge younger than 3 seconds or older than 30 minutes, a bad HMAC, a wrong solution, and a nonce it has seen in the last 30 minutes (an in-memory set, like the limiter). |
| Proof of work | The solution is a counter such that SHA-256 of nonce and counter starts with N zero bits. The widget computes it in a Web Worker while the guest fills the form. The default N targets about one second on a mid-range phone. It is a measured setting, not a guess, before stage 3 ships (Q7). |
| Third-party CAPTCHA | Off by default. An operator can set `PUBLIC_CAPTCHA=turnstile` or `hcaptcha` with a site key and a secret. The widget page's CSP then adds that vendor's hosts. It is an instance setting, not a venue setting, because the secret belongs to the operator. |

The proof of work costs an honest guest about a second and a bot farm about a second of CPU per booking. It stops cheap scripted floods, not a determined attacker with compute. A CAPTCHA stops more, at the price of a third party that sees every guest. The project does not make that choice for every operator.

A failed challenge returns `invalid_request`. A new code would tell a bot which layer caught it.

### Slot hoarding

- **Open bookings per contact.** `maxOpenBookingsPerContact` (default 2, null turns it off) counts the guest's future `booked` reservations in the venue that were created online (`booked_via = 'widget'`). It runs in the create transaction under an advisory lock keyed by venue and normalized contact, the ADR-0013 pattern. Over the cap the create fails with a new `409 online_booking_limit`. Bookings staff made are not counted, so a regular who books by phone is never blocked online.
- **The ADR-0013 per-day cap** applies to public creates as to any create.
- **Online lead time and horizon.** `leadTimeMinutes` and `maxAdvanceDays` in the online settings tighten the venue's own values and never relax them. The effective value is the stricter of the two.
- **No overbooking.** See section 2.

The caps key on the contact, and the engine does not verify contacts. A hoarder who types a new email each time is not counted. Rate limits and the proof of work bound that hoarder. Verifying the email before a booking counts would close the gap, and it needs email to be on, which it is not by default until legal review. Q8 asks whether to add it later.

### Enumeration

- The booking key reveals one venue, by design. Unknown keys all answer the same `404`.
- The self-service token holds 256 bits of secret. Lookups compare in constant time, and every failure answers the same way.
- Availability takes no contact, so it cannot reveal whether a contact has bookings (the reason ADR-0013 gives).
- The resend route answers `202` whether or not a booking matches.
- The create response for `online_booking_limit` and `guest_booking_limit` says the contact is at a cap. That reveals that a contact holds bookings at this venue to someone who types it. The alternative, a generic failure, leaves an honest guest unable to understand why the booking failed. The record accepts this leak, limited by `public_booking`. Q9 lets the maintainer choose the generic answer instead.

## 4. Guest data and privacy

### What the widget collects

| Field | Rule |
| --- | --- |
| Name | Required. Trimmed, 1 to 100 characters. |
| Contact | Required. One email or one phone, as today. Normalized for the guest record (ADR-0003). |
| Party size | Required. Within the online limits. |
| Date and time | Required. A time from the availability response. |
| Note | Optional. Up to 500 characters (REQ-N6). The widget shows, next to the field, that it is not for allergies or health information. |
| Consent | Only when the venue sets `askConsent`. Then one checkbox, unticked by default. Ticked sends `granted`. Unticked sends `unknown`, not `denied`, because an untouched box is not a refusal. With `askConsent` off the widget sends nothing and the reservation reads `unknown`. |

The widget does not collect allergies, diet, occasion as a field, birthday, address, or marketing preferences. Allergies stay out until the legal review that ADR-0003 and REQ-N6 already wait for. The consent checkbox stays off by default because its text and legal basis wait for the same review (REQ-N4). The public create refuses `rating`, `reconfirmation`, `tables` and `zone`.

### What the widget and the link show back

- Availability: times. Nothing about other bookings.
- The guest view: venue display name, date, time, party size, status, the guest's name, the contact masked to its first character and domain or last two digits, the note, and consent. It omits tables, zone, the reservation id, the version history, `bookedVia` and other attribution.
- No route under `/v1/public/` returns any other guest's data, any staff data, or any key.

### Erasure and retention

Erasure and retention already blank the reservation. They also revoke and delete the reservation's self-service link in the same transaction, so a link to an erased booking answers `self_service_link_invalid`. The link row holds no personal value, but deleting it leaves nothing to explain. Erasure counts do not change. A guest cancel through the link is not an erasure and keeps the data the venue's retention period allows.

A guest request to erase through the link is out of scope. It would let anyone holding a forwarded link delete a booking's data, and the venue may need the record. Q10 asks the legal review to decide.

## 5. Per-venue configuration

A new resource, `GET` and `PUT /v1/venues/{venueId}/online-booking`, with the usual venue auth. `GET` is open to any role. `PUT` and `POST .../online-booking/rotate-key` are admin only, as for `config`. It is separate from `config`, which mixes secrets with settings, and from the public profile, which is about crawlers. It is stored in one table, `venue_online_booking`, one row per venue, so the online settings do not add a dozen columns to `venues`.

| Field | Rule | Default |
| --- | --- | --- |
| `enabled` | boolean. Enabling needs a venue name and at least one bookable service, otherwise `409 online_booking_incomplete`. | `false` |
| `bookingKey` | read only. Created on first enable, replaced by `rotate-key`. | none |
| `allowedOrigins` | at most 10 origins, each `https://host` or `https://host:port`, no path, no wildcard, no credentials. Exact match. An empty list allows only top-level use. | `[]` |
| `services` | service names bookable online, or null for all. An unknown name fails with `invalid_request`. | `null` |
| `weekdays` | weekdays bookable online, a subset of each service's own `days` (ADR-0015), or null for all. | `null` |
| `minPartySize`, `maxPartySize` | 1 to 100, within the service limits. A larger party sees the venue's phone, when set. | `1`, `8` |
| `leadTimeMinutes` | 0 to 10080. Stricter of this and the venue's. | `0` |
| `maxAdvanceDays` | null or 0 to 1000. Stricter of this and the venue's, and 365 when both are null (amendment of 2026-11-17). | `null` |
| `selfServiceCutoffMinutes` | 0 to 10080. | `120` |
| `maxOpenBookingsPerContact` | null or 1 to 20. | `2` |
| `confirmationMode` | `auto` only (Q2). The contract names `approval` as reserved, and a write of it fails with `invalid_request` until stage 14, so adding it later does not rename the field. | `auto` |
| `askConsent` | boolean | `false` |
| `locale` | a supported widget locale: `es`, `en`, `ca`, `fr`, `de`, `it` or `pt` (stage 15). | `es` |
| `theme` | see below | built-in defaults |

### Theme tokens as data

A theme is a JSON object with a closed set of keys, validated on write. No key takes CSS, HTML, script or a template.

| Key | Rule |
| --- | --- |
| `colors.primary`, `colors.onPrimary`, `colors.background`, `colors.surface`, `colors.text`, `colors.muted`, `colors.border` | `#rrggbb` hex only |
| `radius` | integer 0 to 24, in pixels |
| `font` | one of a fixed list of font stacks shipped with the widget, such as `system`, `serif`, `rounded`. No font URLs. |
| `logoUrl` | `https` only, no credentials, up to 2048 characters. The widget shows it as `<img>`, so the image cannot run code. |

The widget sets each value as a CSS custom property from the validated value. A save warns, without refusing, when text and background contrast is below WCAG AA (4.5:1). The same token set is what the Phase 11 theme packages and the staff app theme will use, so packages become a named, reviewed set of these values and nothing more.

### Localization hooks

The widget keeps every string in a message catalog keyed by id, one file per locale in `apps/widget`. It chooses the locale in this order: a `lang` query parameter that matches a supported locale, then the venue's `locale`. It formats dates and times with `Intl` in the venue's time zone. A venue cannot edit the strings in the first release. The staff app localization item in Phase 11 can reuse the catalog format.

## 6. Attribution, events and email

### Attribution

The public create sets `bookedVia: "widget"`, `ownerPrincipal: "widget"` and `basis: "service"` in the route, as the staff route sets them from the principal (REQ-G3, C12). A body that sends them is ignored. A self-service modify or cancel does not change attribution, which records how a booking was made.

`ownerPrincipal: "widget"` means an erasure by principal `widget` erases every online booking of the venue. Erasure is admin-only and venue-scoped, so that is a deliberate bulk action. A per-key principal was rejected because rotating the key would split a venue's online bookings across principals.

Whether `basis: "service"` is the right legal basis for a guest booking directly is for the legal review (Q11).

### Events and webhooks

No new event type. A public create emits `created`, a guest modify emits `modified`, a guest cancel emits `cancelled`, as the staff paths do. Webhook payloads stay free of guest data. A consumer that needs the channel reads the reservation, which carries `bookedVia`.

Events do not say who made a change, so a consumer cannot tell a guest cancel from a staff cancel. Adding an `actor` field to events is a contract change for every write path, and Q12 asks for it as its own decision.

### Email

- A public create sends `confirmation` to the guest and `notice` to the venue, through `notifyReservation`, only when `notificationsEnabled` is on. The confirmation gains the self-service link when the contact is an email.
- `notifyReservation` reads the reservation from the database, which holds no token. The create route passes the plaintext token to it in memory for that one send. A later confirmation for a new version, after a staff or guest modify, carries no link, because the engine cannot rebuild the token. The email says to use the link from the first message.
- A rotation sends one email of a new kind, `self_service_link`, once per link id.
- A guest cancel sends `cancellation` to the guest and a `notice` to the venue. The cancellation carries no link, because the cancel revoked it and mints none (Q3).
- With `notificationsEnabled` off, the widget's confirmation screen is the only place the guest sees the link. The screen says to save it.
- The email text waits for the same legal review as every other email (REQ-N2).

## 7. Staged delivery

Each stage is one pull request, sized S or M, and each starts from the contract. A stage marked with a gate does not start until its gate is answered.

| Stage | Flag | Size | Depends on | Gate |
| --- | --- | --- | --- | --- |
| 0 | This ADR, accepted. Done: accepted 2026-11-17, with Q1 to Q4 answered. | S | none | none |
| 1 | Contract and conformance only: `/v1/public/*` routes, the `online-booking` resource, new error codes (`reservation_changed`, `self_service_closed`, `self_service_link_invalid`, `online_booking_limit`, `online_booking_incomplete`), conformance cases for each rule in sections 2 to 6 marked pending in `conformance-status.md`, and the public-channel requirements in `docs/requirements.md`. | M | 0 | none |
| 2 | API: the `online-booking` resource, booking key and rotation, migration for `venue_online_booking`. No public route yet. | M | 1 | none |
| 3 | API: public config, availability and create. Channel input on `createReservation` with overbooking off, online limits in the reason functions, open-bookings cap, attribution, honeypot and form challenge, the four rate-limit rules. | M | 2 | Q7 (proof-of-work difficulty measured). |
| 4 | API: self-service links. Table, mint in the create transaction, read, modify with version check, cancel with revocation of the link, cutoff, rotation on replay, the staff reissue route, revocation on erasure and retention. | M | 3 | none |
| 5 | Widget app (`apps/widget`): booking flow, the `/w/{bookingKey}` HTML shell served by the API with per-venue `frame-ancestors`, the widget site block in the Caddyfile and `compose.prod.yaml`, the `/w/*` proxy in the staff app's dev server for local development only, `docs/deploy.md`. | M | 3 | none |
| 6 | Widget: self-service page at `/r`, reading the token from the fragment. | S | 4, 5 | none |
| 7 | Staff app: an Online booking card in Setup with the settings, allowed origins, the snippet to copy, and key rotation. | M | 2, 5 | none |
| 8 | Email: self-service link in the confirmation, `self_service_link` kind, guest-cancel notice. | S | 4 | Legal review of email text and of the link in email (REQ-N2). |
| 9 | Theme tokens: validation, widget rendering, contrast warning, Setup form. | M | 5, 7 | none |
| 10 | `embed.js` resize script. Done (see the stage 10 amendment). | S | 5 | none |
| 11 | Consent question in the widget (`askConsent`). | S | 5 | Legal review of the consent text and basis (REQ-N4). |
| 12 | Lost-link resend route and form. Built ahead of stage 8 with placeholder email text (see the stage 12 amendment). | S | 8 | Email on, Q8. |
| 13 | Optional CAPTCHA (`PUBLIC_CAPTCHA`). | S | 3, 5 | none |
| 14 | Pending approval mode: a `pending` status that holds tables, and `confirmationMode: approval`. | M | 3, 7 | Deferred by Q2. Needs a new decision before it starts. |
| 15 | Widget localization beyond `es` and `en`. Done for `ca`, `fr`, `de`, `it` and `pt` (see the stage 15 amendment). | S each | 5 | Native review of the five catalogs. |

Stages 2 to 4 are the API. Stages 5 and 6 make the exit criterion reachable with auto-confirm and no email. Stages 8 and 11 need legal, and nothing before them does, because the widget collects no consent and sends no email until they land.

## Consequences

**Easier.** A venue takes bookings on its own site with a pasted snippet, and the guest's data stays out of the host page's reach. Every public route is under one prefix, so the guest surface can be audited by reading one block of `app.ts`. The booking rules are the same functions staff bookings use, so staff and guest bookings cannot drift.

**Harder.** A second origin, a second Caddy site block and a second front-end build to deploy in production. Local development runs on one origin, so there the widget is kept from the staff cookie by code, not by the browser. The widget page is served by the API, not as a static file, so it is one more HTML response the API must get right. A new table for links and one for settings. The limiter gains its first rule keyed by venue, and its first limit on `GET`. Every new write path must remember the channel input, or it could reach the overbooking path from the public channel. A test must pin that.

**Accepted.** Proof of work and rate limits stop casual abuse, not a funded attacker. Contacts are not verified, so per-contact caps are weak against a hoarder who types new contacts. The per-venue limit can be spent by an attacker to stop online bookings for an hour. A replayed create, a staff reissue or a lost-link resend leaves a dead link in an earlier email. A guest cancel ends the link for good. A venue cannot require approval of online bookings in the first release. A guest cannot move a booking, only cancel and book again. The iframe has a fixed height until `embed.js` ships.

## Alternatives considered

- **Script injection with shadow DOM, or a web component.** Rejected for the first release. The host page's scripts could read the guest's contact as typed. It could return later as an option for venues that accept that, rendering the same widget.
- **Serve the widget from the staff origin under a path.** Rejected for production (Q1). Allowed in local development only, under the rules in section 1. In production it would put the staff session cookie on the widget's origin and would need path exceptions in the staff app's framing headers.
- **A static Caddy CSP for the widget, `frame-ancestors *`.** Rejected. It lets any site frame any venue's widget, which invites clickjacking and look-alike pages. Per-venue origins cost one dynamic header.
- **Public routes under `/v1/venues/{venueId}/` above the middleware.** Rejected. It depends on registration order, the risk ADR-0012 already noted for one route.
- **A JWT or other signed, stateless self-service token.** Rejected. It cannot be revoked without a deny list, which is a table anyway, and it would put the reservation id in a readable payload.
- **An HMAC-derived token (secret = HMAC of the link id under a server key).** It would let the engine rebuild a link for any email and for an idempotent replay, so no email would hold a dead link. Rejected (Q4). Whoever holds the server key could rebuild every link, and a database leak plus that key yields every live link, while a hash-only table yields none. A re-send therefore always issues a new token.
- **A mandatory CAPTCHA.** Rejected. It makes every instance depend on a vendor that sees every guest.
- **Email verification before a booking counts.** Deferred. It needs email on, which waits for legal review, and it adds a pending state to every booking (Q8).
- **A `pending` status in the first release.** Deferred to stage 14 (Q2). It changes REQ-B6, every status transition, the agenda, the event feed and the tables a pending booking holds.
- **An approval flag on `booked`.** Rejected (Q2). The booking would hold its table and look unapproved, but nothing would stop staff from seating it. It gives the appearance of control without the control.
- **Online settings on `PUT /config`.** Rejected, for the reason ADR-0012 gives for the public profile.
- **A structured allergy field in the widget.** Rejected until the legal review of health data.

## Open questions for the maintainer

David Cabeza answered Q1 to Q4 on 2026-11-17. The others have a gate in the stage table.

- **Q1. Widget origin.** Is a separate origin (`WIDGET_ADDRESS`, a second domain or subdomain and certificate) acceptable for a self-hoster, or should the first release allow the same domain on a separate path with its own headers, accepting the cookie exposure? This record recommends the separate origin.
  Answered 2026-11-17: option A. A separate origin (`WIDGET_ADDRESS`) is required in production. Local development alone may use the staff app's origin on a separate path (option B), under the rules in section 1. The exception never ships in `compose.prod.yaml`.
- **Q2. Pending approval.** Should a venue be able to require staff approval of online bookings? If yes: a new `pending` status that holds tables (so the exclusion constraint still guards them) and expires after a set time if nobody acts, or a flag on `booked`? Either changes REQ-B6 and the contract. `approval_required` already exists in the error vocabulary.
  Answered 2026-11-17: no approval mode in the first release. Every online booking is `booked` at once when there is room. `confirmationMode` accepts only `auto`, and `approval` stays reserved. The `pending` status that holds tables is deferred to stage 14. The flag on `booked` is rejected.
- **Q3. Rotation on change.** This record rotates the link on replay, reissue and resend, not on every guest modify. Do you want rotation on every change made through the link, accepting that each one kills the emailed link and sends a new email?
  Answered 2026-11-17: no rotation on a guest modify. The link rotates on a create replay, a staff reissue and a lost-link resend, as proposed. A guest cancel also revokes the link and issues no new one. Rebooking creates a new reservation with its own link.
- **Q4. Token storage.** Hash only, as ADR-0006 (recommended), or HMAC-derived so links can be re-sent and a replay returns the same link?
  Answered 2026-11-17: hash only, SHA-256 with a constant-time compare, as ADR-0006. HMAC-derived tokens are rejected, because a master key could rebuild every link. A re-send always issues a new token.
- **Q5. Moving a booking.** Is "cancel and book again" enough for Phase 11, or should a modify that changes date and time, re-running the time rules, come before the self-service link ships?
- **Q6. Per-venue public limit.** Should `public_venue` be a per-venue setting, so a large venue can raise it, or stay an instance variable?
- **Q7. Proof-of-work difficulty.** Measure the default on a low-end phone before stage 3. Should proof of work be on by default at all, given that it slows older devices?
- **Q8. Contact verification.** After email is on, should online bookings stay unconfirmed until the guest clicks a link sent to the email?
- **Q9. Cap errors.** Keep the specific `online_booking_limit` and `guest_booking_limit` answers, which reveal that a contact holds bookings, or return a generic refusal?
- **Q10. Guest-initiated erasure.** Legal review. May a guest erase a booking's data through the link?
- **Q11. Legal basis.** Legal review. Is `basis: "service"` right for a booking a guest makes directly, and what text must the widget show before submit (venue identity, privacy notice link)?
- **Q12. Actor in events.** Should events record who made a change (staff, key, guest link), as a separate contract change?
- **Q13. Default online party maximum.** This record proposes 8. Confirm or change.

## Amendment 2026-11-17: cancel replay and an open confirmation mode

David Cabeza made two decisions while the stage 1 contract was written. The status above does not change. The contract encodes both (cases C50 and C39).

- **A replayed guest cancel returns its result.** A guest cancel still revokes the link and issues no new one. A repeat of that same cancel, with the same `Idempotency-Key` and the same, now revoked, token, returns the stored cancel result, the cancelled guest view, and changes nothing. It does not return `self_service_link_invalid`. Any other call with the revoked token, a read, a modify, or a cancel with another key, gets the generic `self_service_link_invalid`. This keeps the idempotency rule for a guest whose cancel response was lost.
- **`confirmationMode` is an open set of values.** Only `auto` is accepted on write. `approval`, and any other value, fails with `invalid_request` until stage 14. Clients must treat any value other than `auto` as not automatic confirmation. `openapi.yaml` marks the field as an extensible enum, not a closed one, so adding `approval` later does not break a client that validates responses.

## Amendment 2026-11-17: proof of work and stage 3

David Cabeza answered Q7 before stage 3: proof of work is on by default, at a low difficulty that an operator can change. Stage 3 builds the public config, availability and create with these choices. The status above does not change.

- **Q7. On by default, low, and configurable.** `PUBLIC_POW_DIFFICULTY` sets the number of leading zero bits, 0 to 32, default 12, which is 4,096 tries on average. In Node, `crypto.subtle` hashes about 11,000 times a second on a laptop, so 12 bits takes well under a second there. That is a reference, not the phone measurement Q7 asked for, which waits for the widget (stage 5). `0` turns the proof of work off for local development and scripts, and the signed challenge and the 3-second minimum still apply. A bad value stops the API at startup.
- **The signing key.** `PUBLIC_CHALLENGE_SECRET`, at least 32 characters, signs the challenges with HMAC-SHA256. Unset, each process signs with a random key of its own, which is enough for the one API process of `compose.prod.yaml`. A restart then voids open challenges, and a guest reloads the form.
- **What "seen" means for a nonce.** The API remembers each accepted nonce for its 30-minute life, in memory like the rate limiter, together with the `Idempotency-Key` that first presented it. The same submit retried with the same key passes the check and replays through idempotency. Any other key with that nonce is refused, also after a create that failed on its own rules. The memory holds at most 100,000 nonces and drops the earliest accepted beyond that, a bound the public limits keep far away. Two API processes would each keep their own, as for the limiter.
- **The token waits for stage 4.** The create answers with the guest view and `selfServiceToken: null`, because stage 4 mints links. `PublicReservationCreated` allows `null`, so the shape holds. C43 and C44 stay partial until stage 4.
- **No CORS.** As section 1 says, the widget calls `/v1/public/*` from its own origin through the widget site block, so the routes send no CORS header and no other route's CORS changes.
- **`online_booking_incomplete` stays a settings error.** A venue whose online services were all deleted after it was enabled answers `outside_hours` and empty availability, as the contract says. The public routes do not emit `online_booking_incomplete`.

## Amendment 2026-11-17: the widget page and its assets (stage 5)

Stage 5 builds `apps/widget` and the page. Three details of section 1 change, and the contract (`widget.page`, C41) says so. The status above does not change.

- **The API serves the assets too, under `/w/assets/`.** The table in section 1 has Caddy serve `/assets/*` from the widget site block. The API writes the page from the widget build's manifest, so it must hold the same build. Serving the assets from that build keeps the page and the files it names in one image, and one `/w/*` rule reaches both, in Caddy and in the staff app's dev proxy. `/assets/` at the root would also collide with the staff app's own build in development. The widget site block now proxies `/w/*` and `/v1/public/*` and answers everything else with `404`. Assets are served by file name only, from the build's `assets` folder, with `Cache-Control: public, max-age=31536000, immutable`.
- **How production refuses the staff origin.** The staff site block answers `/w/*` with `404` itself. The API also checks: with `WIDGET_ADDRESS` set it serves the page only for requests to that host, and answers any other host with the unknown-key page. A production API (`NODE_ENV=production`) without `WIDGET_ADDRESS` serves no widget page. An API whose `WIDGET_ADDRESS` has the host name of `BETTER_AUTH_URL` or of a `TRUSTED_ORIGINS` entry refuses to start, whatever the port, because cookies ignore the port. Outside production, with no `WIDGET_ADDRESS`, the API serves the page on any host, which is the local development exception.
- **The widget origin needs HTTPS.** Browsers offer `crypto.subtle`, which the proof of work uses, only in a secure context: HTTPS, or `localhost`. On plain HTTP on another host the widget cannot solve the challenge and tells the guest to contact the venue. Caddy's automatic HTTPS covers a real `WIDGET_ADDRESS`.

Q7 stays open. Desktop Chrome 157 on a laptop solves 12 bits in the widget's Web Worker in about 25 ms on average (90th percentile about 50 ms, 40 solves). A 6x CPU throttle through the DevTools protocol cuts the main thread from about 250,000 to about 50,000 digests a second, about 80 ms for 12 bits on average, but it does not throttle the worker and is not a phone. The phone measurement is still to do.

## Amendment 2026-11-17: the self-service page (stage 6)

Stage 6 builds the page at `/r`. These details are not in the sections above, and the contract (`widget.selfServicePage`, C41) says so. The status above does not change.

- **The API serves `/r`, from the widget build.** The page is the same for every booking, because the token never reaches the server, so it is the shell of `widget.page` with a fixed title. It loads its files from `/w/assets/`. It answers only on the hosts `/w/*` answers on, and other hosts get the unknown-key `404`. Caddy's widget site block proxies `/r`, the staff site block answers `/r` with `404`, and the staff app's dev server proxies exactly `/r` in local development.
- **No site frames `/r`.** It holds a capability token, so it sends `frame-ancestors 'none'` and `X-Frame-Options: DENY` whatever a venue's `allowedOrigins` say, with `Referrer-Policy: no-referrer`, `noindex` and `Cache-Control: no-store`.
- **The token lives in memory only.** The page reads it from the fragment once and removes the fragment from the address bar and the history entry with `history.replaceState`, so it does not stay on screen, in a bookmark or in a screenshot. The widget uses no browser storage (section 1), so a reload of `/r` has no token and shows the one message every link that does not work shows, which tells the guest to open the link again. Opening a link in the same tab changes only the fragment, so the page loads itself again to read it.
- **The locale travels in the link.** The confirmation links to `/r?lang=<locale>#<token>`, so the guest keeps the language they booked in. Without `lang` the page uses the venue's `locale` from the guest view. Only the locale goes in the query.
- **What the page offers.** The party size and the note, a cancel with a confirmation step, and a note that the day and time cannot change online (Q5). The guest view does not carry the online party limits, so the page offers 1 to 100 and explains `party_size_too_small` and `party_size_too_large` with the venue's phone. Consent is not offered through the page, although the route accepts it (C55): its text waits for the legal review of stage 11, as the widget's own question does. `changeableUntil` is shown on the guest's clock.

## Amendment 2026-11-17: limits from the security review of the public channel

A security review of the public booking flow at `3b9a386` found four ways a stranger could misuse it. David Cabeza decided the first two. The contract encodes all four in C61, and the status above does not change.

- **Guest-modify email is limited, not removed.** Anyone holding a link could change the party back and forth and send a `confirmation` to the booking's contact on every change, with a name the booker typed in its text. A guest's own party change now sends at most 3 confirmations per reservation, at least 15 minutes apart (`GUEST_MODIFY_EMAILS` in `apps/api/src/lib/notifications.ts`, constants rather than settings). The limit is claimed in the database under a per-reservation lock before the send, so concurrent modifies cannot pass it together. A modify that changes nothing sends nothing, and a change back inside the 15 minutes is covered by the interval. The modify answers the same whether an email went out, so the limit is not an oracle. The booking's first confirmation, the cancellation and the venue's notice are not counted. A staff party change still sends its confirmation every time, and that confirmation counts toward the guest's 3, so the guest's total stays bounded. Emails to the guest no longer carry the guest name, which whoever books chooses. That is a structural change to the placeholder templates only: their wording still waits for the legal review of REQ-N2.
- **The public channel has a default horizon of 365 days.** With `maxAdvanceDays` null on both the venue and the online settings, the public channel takes no date more than 365 days ahead. The stricter of the two settings still wins when either is set, and the default never loosens a value the venue chose, so an online horizon of 500 still allows 500 days. The config answer shows the effective value. Staff channels keep their own rules.
- **A future booking does not move retention.** `lastVisitAt` was the start of the guest's latest booking, so a stranger who booked year 9999 with a guest's contact and cancelled kept that guest, and the cancelled booking, out of retention for good. `linkGuest` now stores the earlier of the start and now, so a booking that has not happened counts from when it was made, and retention ignores cancelled bookings when it looks for a guest's live ones. A booking that is not cancelled still keeps its guest until it ends plus the period. Migration `0037` sets every `last_visit_at` later than now to now, which is what the new rule would have stored, so guests already frozen by such a booking expire on schedule.
- **Dates have a range.** Every route that takes a date accepts real calendar dates from `1900-01-01` to `9998-12-31` and answers `invalid_request` otherwise. A booking on `9999-12-31` overflowed the link expiry and time-zone arithmetic into year 10000 and answered `500`, and several staff queries did the same for malformed or extreme dates.
- **An erased booking cannot come back through a replay.** A repeat of a public create key returned a fresh link for a booking that erasure had blanked, because erasure leaves the reservation `booked` and the key in place. `rotateLink` and the staff reissue now refuse an erased booking, and a public repeat of its create key answers `invalid_request`, like any malformed body, and shows nothing of it. The key row stays, so the repeat cannot book again either. Staff keys are unchanged.
- **`allowedOrigins` are plain origins.** The old check allowed `;`, `,` and quotes in the host, which reached the `Content-Security-Policy` header as extra directives or sources. An entry is now accepted only when it equals the origin of the URL it names, with a host of letters, digits, hyphens and dots. The widget page also leaves out any stored entry that fails that check, so a value saved under the old rule never reaches the header.

## Amendment 2026-11-17: `embed.js` and the height message (stage 10)

Stage 10 builds the optional script that section 1 announces. These details are not in the sections above, and the contract (`widget.embedScript`, C41) says so. The status above does not change.

- **The snippet.** `<script src="https://book.example.com/w/embed.js" data-key="pk_..." async></script>`. The script adds an iframe right after its own tag, with `title` from `data-title` (default `Reservas`), `loading="lazy"`, no border, full width and 640 pixels high until the first message. Its `src` is the origin of the script's own URL plus `/w/` and the key. The page names nothing else: a `data-key` outside `pk_` and 16 to 64 base64url characters adds nothing. Each tag handles its own iframe, so several tags work on one page, and a tag that runs again adds nothing. The plain `<iframe>` snippet stays the default for site builders that refuse scripts.
- **The message.** The widget, when framed and only on `/w/{bookingKey}`, posts `{ "type": "opencovers:height", "height": <whole pixels> }` on load and whenever its document changes size, at most once per frame and only when the height changed. The message is built from a number, so no guest data can reach it. The widget cannot know its parent's origin, so it posts with the target `*`. `ancestorOrigins` and `document.referrer` would only be hints, and a height reveals nothing a framing page could not measure. Who may frame the page at all is still the venue's `frame-ancestors`. `/r` is never framed and posts nothing.
- **What `embed.js` accepts.** A message whose `origin` is the script's origin, whose `source` is its own iframe's window, and whose data is an object with exactly the keys `type` and `height`, `type` equal to `opencovers:height` and `height` a finite number not below 0. Anything else is ignored. The height is rounded up and kept between 100 and 6000 pixels, so neither a bug nor a hostile widget build can stretch the host page without bound. The script reads nothing from the host page but its own tag, writes nothing but its iframe, and uses no `eval` or HTML strings.
- **How it is served.** The API serves `GET /w/embed.js` from the widget build (`apps/widget/public/embed.js`, which Vite copies to `dist/`), under the host rules of `/w/*`. The URL has no version, so it sends `Cache-Control: public, max-age=300` and an `ETag` from the content, and answers a matching `If-None-Match` with `304`. It sends `Content-Type: text/javascript`, `nosniff` and `Cross-Origin-Resource-Policy: cross-origin`, so a host page with `Cross-Origin-Embedder-Policy: require-corp` can load it. It sends no CORS header: a plain `<script>` does not need one. Caddy's `/w/*` rules already reach it, and nothing in the Caddyfile or the compose file changes.

## Amendment 2026-11-17: theme tokens (stage 9)

Stage 9 renders the theme in the widget and edits it in Setup. The key set and its rules in section 5 do not change. These details are not in the sections above, and the contract (C39) says so. The status above does not change.

- **The contrast warning uses the built-in color for a missing one.** Section 5 warns when text and background contrast is below 4.5:1. A theme that sets only one of the two is now checked against the widget's built-in other one (text `#1c1b19`, background `#ffffff`), because that is the pair a guest sees. A dark background alone, with the built-in dark text, now warns. A test reads the widget's stylesheet so the API's two built-in colors cannot drift from it. The warning stays advice: the save succeeds and the widget shows the colors the venue chose. Only text against background is checked, not button text against the button color.
- **A logo URL holds no whitespace or control character.** The URL parser ignores leading and trailing spaces and removes tabs and newlines, so it accepted such strings, and the API stored them as sent. Such a value now fails with `invalid_request`, so what is stored is what the image loads.
- **The widget checks the theme again and sets it property by property.** `apps/widget/src/theme.ts` maps each key to a CSS custom property only when its value passes the same rules, and sets it with `style.setProperty` on the root element, so a venue string is never parsed as CSS, markup or script. A key that is absent or fails keeps the built-in value from `styles.css`. Fonts are names that map to font stacks shipped in the widget. The logo is an `<img>` with the venue name as alt text and `referrerPolicy="no-referrer"`, on `/w/{bookingKey}` and on `/r`.
- **The widget page's CSP does not change.** Its `img-src 'self' https: data:` (section 1) already allows an `https` logo from any host, which section 5 intends. Narrowing it to the logo's host would put a venue value into the header, which C61 keeps out for `allowedOrigins`. The cost is privacy, not code: the logo's host sees each guest's IP address and the time of the visit, without a referrer. Setup says so next to the field. A venue that wants none of that leaves the logo empty.
- **The staff app does not load the logo.** The staff site's CSP allows images from its own origin only, and loading a venue-typed address in an admin's browser would tell that host when admins are in Setup. The Setup preview shows a placeholder where the logo goes. The preview is a small likeness drawn with the chosen colors, radius and font, not the widget in a frame.
- **Setup sends only what differs from the built-in look.** A key equal to its built-in value is left out of the saved theme, and a theme with nothing left saves as `theme: null`. "Reset look to defaults" clears the form to the built-in look, and the next save stores that.

## Amendment 2026-11-17: the lost-link resend (stage 12)

David Cabeza asked for stage 12 before stage 8, whose gate, the legal review of email text and of a link in an email (REQ-N2), is still open. Stage 12 therefore builds only the email it needs. Stage 8 (the link in the confirmation, the email on a create replay and a staff reissue, the guest-cancel notice) and its review stay open. Q8 is unanswered, so contacts are still not verified. The contract (C51 and `PublicConfig.linkResend`) says what follows. The status above does not change.

- **Placeholder email text.** The `self_service_link` email is `buildLinkEmail` in `apps/api/src/lib/mailer.ts`, beside the other templates, with the same status: placeholder wording pending the review of REQ-N2, sent only when `notificationsEnabled` is on, which is off by default. It holds dates, times, party sizes and the links, and says that earlier links no longer work. No guest name, note or other text a guest typed. It is in Spanish, like the other templates.
- **Caps, so the route is not a mail relay.** Anyone can type an address, so `LINK_RESEND` in `apps/api/src/lib/link-resend.ts` limits what one address can cause, as constants: at most one email per address and venue every 15 minutes, a reservation in at most 3 resend emails ever, and at most 5 bookings in one email, the earliest first. The caps are claimed in one transaction under an advisory lock on the venue and the normalized address, so concurrent resends send one email. A booking left out by a cap is not rotated, so its link keeps working. Past the caps the route answers the same `202`.
- **The record reuses `sent_emails`.** No new table. Each booking in a resend email gets a row of kind `self_service_link_resend` whose `version` counts that reservation's resends, 1 to 3, so the table's unique index also stops a fourth. The interval is read from the rows of the bookings the address matches. No row holds a token.
- **Matching.** The address is normalized as REQ-G2 normalizes a contact, and it matches a booking whose stored contact normalizes to the same value: future, `booked`, not erased, in the key's venue, made by any channel. The email goes to the address stored on the earliest matched booking, never to the one in the request.
- **Timing.** The route resolves the key and parses the body, answers, and starts the work on a later turn of the event loop. The answer is sent before any lookup of the address, so its time does not depend on a match. The work after it, a transaction and a call to the email provider, competes for the same process, so a sender who measures later requests could still see a small effect. Rate limits bound how often anyone can try.
- **A failed send.** The rotation commits before the email goes out, so a provider failure leaves the old link dead with no new one delivered. The guest can ask again after 15 minutes. Sending inside the transaction would hold the reservation's row lock across a network call. The failure is logged with the provider's status only, because its answer could quote the email.
- **The widget origin.** Links are built server side on `WIDGET_ADDRESS`. Outside production without it, they use `BETTER_AUTH_URL` (default `http://localhost:3000`), because the API then serves `/r` on any host. A production API without `WIDGET_ADDRESS` serves no widget, so the resend sends nothing. The request's `Host` is never used, because the sender chooses it. The link is `<origin>/r?lang=<venue locale>#<token>`: the request carries only the address, so the locale is the venue's.
- **`linkResend` in the config.** With email off the route can never send, and a form that says "we sent a link" would mislead the guest. The config answer says `linkResend: true` only with email on, a way to send it (an API key and a from address), and a widget origin. It reveals nothing about any guest. The widget offers the form only when it is true.
- **The widget form.** A "Lost the link to your booking?" button under the booking form on `/w/{bookingKey}` opens one email field. `/r` has no booking key, so it cannot offer the form. There is no challenge or proof of work, because the contract does not ask for one on this route. Every answer reads "If there is a booking with that email, we have sent you a new link", except a failed connection and `429`, which get the widget's usual messages.

## Amendment 2026-11-17: widget locales beyond `es` and `en` (stage 15)

Stage 15 adds five widget locales: `ca` (Catalan), `fr`, `de`, `it` and `pt`. The set is a proposal; any other locale is one more catalog and one more entry in each list below.

- **One list, four places.** The supported locales are `es`, `en`, `ca`, `fr`, `de`, `it`, `pt`. They are `LOCALES` in `apps/api/src/lib/online-booking.ts` (validation of the venue's `locale`, and of `lang` on `/w`), `SELF_SERVICE_TITLES` in `apps/api/src/lib/widget-page.ts` (`lang` on `/r`), `CATALOGS` in `apps/widget/src/messages.ts`, and `LOCALES` in the staff app, which shows each language by its own name. A test fails when the API list, the `/r` titles and the widget catalogs differ.
- **Same ids and slots.** Every catalog has exactly the keys of `es`, typed as `Record<MessageId, string>`, and a test checks that every `{slot}` matches. Dates go through `Intl.DateTimeFormat` with the locale, so `de`, `fr` and the rest get their own weekday and month names.
- **Fallback order.** An unsupported `lang` is ignored, then the venue's `locale` applies, and the widget falls back to `es` when `<html lang>` is not a supported locale. Matching is exact on `/w` and `/r` (lower case), and the widget reads the base subtag of `<html lang>` (`pt-BR` reads as `pt`).
- **Migration `0038`.** The `venue_online_booking_locale` check constraint listed `es` and `en`, so it is dropped and added again with the new list. No data changes.
- **Machine-assisted text.** The `ca`, `fr`, `de`, `it` and `pt` catalogs were written with machine assistance and have not had a native-speaker review. A native review of each is open before a venue relies on them. The guest-facing tone is informal `tu` in `ca`, `it` and `de` (`du`), and formal in `fr` and `pt`, which a reviewer may change.
- **Not changed.** The email templates stay as they are (stages 8 and 11 and their legal gate), so an email is not localized by this stage. `formatInstant` still formats `changeableUntil` on the guest's own clock, because the guest view carries no venue time zone; moving it to the venue's zone needs a contract change and stays open.

## Amendment 2026-11-17: the public channel never takes a start in the past

A walkthrough found that `GET /v1/public/{bookingKey}/availability?date=2020-01-01` listed every time and that a public create for 2020-01-01 09:00 succeeded. With the default lead time of 0 the lead-time rule was off, so nothing compared the start with now. C62 closes it.

- **One rule in the shared path.** `applyChannel` marks the public venue `refusePast`. `timeReasons`, which the create, the availability grid and the explanation share, then refuses a start before now plus the effective lead time even when the lead time is 0. The staff channel and the walk-in never get the flag, so staff can still enter a past or walk-in booking.
- **No new error code.** A refused create fails with the existing `lead_time_violation` (`details.earliest` is the next bookable moment). The check compares with the server clock before the booking transaction, as every other time rule does. Overlap is still decided by the exclusion constraint inside the transaction, so concurrency is not weakened.
- **Past date on availability.** The answer stays `200` with an empty `times`, as for a blocked date or a date past the horizon, so the route does not become a probe of the calendar. A new `reason` field says why when the date is the cause: `past_date` or `beyond_horizon`, otherwise `null`. The widget words these as "choose a date from today" and "too far ahead", and keeps "no free times" for the rest. The field is additive and always present.
- **Guest modify.** It cannot change date or time (C49) and is closed from the cutoff on, so it needs no change.
- **Data exposure.** The venue phone is already in the public config (`venue.phone`, the venue's `publicPhone`) and the widget shows it; nothing new is exposed.
- **Self-service view.** `PublicReservation` gains `maxPartySize`, the online maximum already in the public config, so the change screen on `/r` stops there instead of at 100. The engine still decides, and a service with a narrower maximum still answers `party_size_too_large`. A "make a new booking" link on the cancelled page is not added: `/r` holds only the token, and putting the booking key in the view or the link would hand a key to anyone with a link.
- **Widget header and embed.** Both pages show the venue name and, when the public profile has one, its phone. `embed.js` titles the iframe from `data-title`, otherwise `Book a table`; the iframe snippet in Setup says the same.

## Amendment 2026-11-19: dark mode

The widget gets dark built-in colors. The key set of the theme in section 5 does not change, and the contract (C39) says so.

- **Where.** On the widget's own pages, `/w/{bookingKey}` and `/r` opened directly, for a visitor whose system asks for dark mode. A page inside an iframe stays light. The visitor's system setting says nothing about the venue's site, and a dark box on a light page would be a regression for every existing embed.
- **When.** Only while the venue's theme sets no color. A theme with any valid color keeps the light built-in colors for the colors it leaves out. Mixing a venue's `background` with a dark built-in `text` would make unreadable text, and the contrast warning in section 5 compares against the light built-in pair.
- **How.** `styles.css` holds the dark values under `@media (prefers-color-scheme: dark)` for `:root[data-scheme="system"]`. `main.tsx` sets `data-scheme` at once when the page is not framed, so the first paint is already right. When the theme arrives and sets a color, `applyThemeToDocument` removes the attribute. That is one flash to light for a venue with a colored theme and none for the default theme.
- **Not done.** A venue cannot ask for dark in an embedded widget, or choose a dark palette in Setup. Either would be a new theme key or an `embed.js` option, which is a contract change of its own.

## Amendment 2026-11-19: dark mode for an embedded widget (opt-in)

The dark mode of the amendment above stays off inside an iframe by default. An embedding site can now ask for it.

- **How.** `embed.js` reads `data-scheme="auto"` on its tag and adds `?scheme=auto` to the iframe address. A plain iframe snippet can carry the same query. The widget page reads that query and, when it is exactly `scheme=auto`, follows the visitor's setting as it does on its own page. Any other value, or none, keeps the widget light.
- **Why a query and not a theme key.** The choice belongs to the website that embeds the widget, which knows whether its own page is dark or light, and not to the venue's stored theme. A theme key would change the closed key set of section 5, the API validation and every client. The query changes none of them.
- **What stays.** A theme with any color still wins: the dark colors apply only while the theme sets none. The query is read by the widget script only, as a fixed comparison. `embed.js` sends the fixed string `?scheme=auto` and never copies the attribute's text into the address.
- **Setup.** The embed section has a switch, "Follow my visitors' dark mode", that adds the option to both embed codes. It is not stored: it only changes the code shown.
- **Not done.** A dark palette chosen by the venue in Setup, which would need a theme key.

## Amendment 2026-11-19: a dark palette in the theme

Section 5's key set grows by one: `darkColors`. A venue can now choose the colors a visitor sees in dark mode.

- **Shape.** `darkColors` has the same seven keys and the same `#rrggbb` rule as `colors`, and is validated the same way. It is optional. `{}` is valid and means something: the venue wants the widget's dark look next to its own light `colors`.
- **Why a second set and not a flag.** The dark built-in colors are chosen as a pair. A venue's light `colors` cannot be reused in dark mode, and a built-in dark `text` over a venue's light `background` would be unreadable. Two separate sets mean each palette is complete on its own: a key left out in `darkColors` falls to the dark built-in value, never to `colors`.
- **What changes in the widget.** A page that follows the visitor's setting (its own page, or an embed with `?scheme=auto`) shows `darkColors` to a visitor in dark mode and `colors` in light mode, and applies the other palette again when the visitor changes the setting. A theme with `colors` and no `darkColors` still keeps the widget light, as in the first dark-mode amendment, so no venue changes without choosing to. A page that does not follow the setting ignores `darkColors`.
- **Contrast.** Each saved warning now has a `palette` of `light` or `dark`. The dark pair is checked only when the theme has `darkColors`, against the dark built-in text `#f1eee8` and background `#181715` for a key it leaves out. A test ties those two values to the stylesheet, like the light pair.
- **How.** The widget still sets one custom property at a time from a checked value. In dark mode it removes the color properties first, then sets the dark ones, so no light value stays behind.
- **Setup.** The look editor has a switch for the dark palette, with its own colors, preview and contrast warning.
- **Not done.** A palette that follows the venue's own site toggle instead of the visitor's system setting, and a radius, font or logo per palette.

