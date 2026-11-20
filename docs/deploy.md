# Deployment

OpenCovers does not depend on a hosting vendor. The engine needs PostgreSQL and a Node.js process. Whoever forks it for a venue chooses where the database and the processes live.

## What you run

| Part | What it is | Needs |
| --- | --- | --- |
| API (`apps/api`) | Node.js process (Hono) | PostgreSQL 16 or newer, Node.js 22 |
| Staff app (`apps/web`) | Static Vite build | Any static host or web server |
| Booking widget (`apps/widget`) | Vite build that the API serves at `/w/{bookingKey}` | A second host name with HTTPS (`WIDGET_ADDRESS`) |
| MCP server (`apps/mcp`) | stdio process that talks to the API over HTTPS | Node.js 22, an API key |
| Site (`apps/site`) | Static Vite build | Any static host. The project's own copy is on GitHub Pages at opencovers.dev. |

## Database

Any PostgreSQL 16+ works: self-hosted, a container, or a managed service. The no-double-booking rule is a GiST exclusion constraint, so the database must be a real PostgreSQL. Set `DATABASE_URL` and run the migrations:

```sh
pnpm db:migrate
```

`compose.yaml` starts a local PostgreSQL for development.

## Quick start with Docker Compose

`compose.prod.yaml` runs the whole engine on any machine with Docker. It starts PostgreSQL, the API, and Caddy, which serves the staff app and forwards `/api/*` and `/v1/*` to the API. The staff app and the API share one origin. The guest booking widget has a second one, see [Booking widget](#booking-widget).

```sh
cp .env.prod.example .env.prod
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET
docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
```

Set `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` in `.env.prod`. The stack refuses to start without them. Use only letters and digits in the database password, because it goes inside the database URL. Open `http://localhost` and sign up. The first account is the owner. See [Sign-up control](#sign-up-control).

To serve a real domain, set `SITE_ADDRESS=app.example.com` and `PUBLIC_URL=https://app.example.com`. Caddy then gets a certificate on its own. Ports 80 and 443 must reach the machine. Use `HTTP_PORT` and `HTTPS_PORT` to publish other ports.

The API image applies migrations on boot. PostgreSQL is not published to the host.

The API image installs production dependencies only (`pnpm install --prod`), so the test runner, the bundler, `drizzle-kit` and `typescript` are not in it. The image still runs the API from source with `tsx`, which is why `tsx` is a production dependency of `apps/api`. We chose that over compiling the API to JavaScript because it is a smaller change and the one remaining `esbuild` is `tsx`'s own. Compiling would also drop `tsx` and `esbuild`, at the cost of a build stage and a compiled migrate script. `.pnpmfile.cjs` removes `drizzle-kit` and `vitest` from `better-auth`'s optional peer dependencies, because pnpm otherwise links them into the image through `better-auth`.

Before you serve real guests, read the [hardening guide](hardening.md). It covers secrets, backups, key rotation, updates and the known gaps.

To use an external PostgreSQL instead, remove the `db` service and its `depends_on` entry, and set `DATABASE_URL` on the `api` service to your connection string.

Without Docker, build the staff app with `pnpm --filter @opencovers/web build`, serve `apps/web/dist` from any static host, and forward `/api/*` and `/v1/*` to the API. Add the staff app's origin to `TRUSTED_ORIGINS`. For the widget, build it with `pnpm --filter @opencovers/widget build` where the API runs, and follow [Booking widget](#booking-widget).

## Booking widget

Guests book through a page that venues embed with an `<iframe>`, or link to: `https://book.example.com/w/BOOKING_KEY`. A venue admin turns online booking on and gets the booking key in the staff app or through `PUT /v1/venues/VENUE_ID/online-booking`. See [ADR-0017](adr/0017-booking-widget-and-self-service-link.md).

The widget must live on a host name of its own, never the staff app's, so the staff session cookie stays out of its reach.

1. Point a second name, such as `book.example.com`, at the same machine.
2. Set `WIDGET_ADDRESS=book.example.com` in `.env.prod` and restart the stack. Caddy gets a certificate for it as it does for `SITE_ADDRESS`. Use a real domain: browsers run the widget's proof of work only over HTTPS (or on `localhost`), so on plain HTTP the widget cannot book.
3. Open `https://book.example.com/w/BOOKING_KEY`.

What each part does:

- Caddy's widget site block forwards `/w/*`, `/r`, `/favicon.ico` (the API answers `204` there, only on the widget host) and `/v1/public/*` to the API and answers everything else with `404`. The staff site block answers `/w/*` and `/r` with `404` and keeps `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path.
- The API writes the page per venue, because the page's `Content-Security-Policy` lists the origins allowed to frame it: `frame-ancestors 'self'` and the venue's `allowedOrigins`, or `'none'` when the list is empty, which allows only top-level use. It sends no `X-Frame-Options`. It also serves the widget's built files under `/w/assets/`. The guest's self-service link, `https://book.example.com/r#TOKEN`, opens the same build at `/r`, which no site may frame. The token stays in the fragment, so it never reaches Caddy, the API or their logs. The API image builds the widget, so nothing else needs copying.
- The API serves the page only for requests to the `WIDGET_ADDRESS` host. Without `WIDGET_ADDRESS`, a production API (`NODE_ENV=production`, as in the image) serves no widget page, and Caddy's widget block listens for `widget.invalid`, a name that never resolves. An API whose `WIDGET_ADDRESS` has the host name of `BETTER_AUTH_URL` or of a `TRUSTED_ORIGINS` entry refuses to start, whatever the port.
- A venue's site that sends its own `Content-Security-Policy` must allow the widget origin in `frame-src`.

### Automatic height with `embed.js`

A plain `<iframe>` keeps the height it is given. A venue that can paste a script tag gets an iframe that takes the widget's height instead:

```html
<script src="https://book.example.com/w/embed.js" data-key="BOOKING_KEY" async></script>
```

The script adds the iframe right after its own tag, loads `https://book.example.com/w/BOOKING_KEY` (the origin the script came from), and sets the iframe's height as the widget's content changes. `data-title` sets the iframe's accessible title (default `Book a table`). A `data-key` that is not a booking key (`pk_...`) adds nothing and logs a warning. Several tags on one page each get their own iframe.

Language: the script reads the `lang` of the host page's `<html>` element, keeps the part before the first `-` or `_` (`en-GB` reads as `en`) and passes it as `?lang=` when it is one of the widget's languages (`es`, `en`, `ca`, `fr`, `de`, `it`, `pt`). `data-lang="fr"` on the tag overrides the page and forces that language. When neither gives a supported code, no `lang` is sent and the venue's `locale` applies. Only a fixed code from the script's own list reaches the URL, never the page's text. A plain `<iframe>` can add `?lang=xx` to the booking page address to do the same.

`embed.js` creates the iframe with `loading="lazy"`, so the browser fetches the widget only when the iframe is near the viewport and it does not compete with the venue page for the first screen. The plain `<iframe>` snippet from Setup, Online booking carries the same attribute.

Put the tag where the widget should appear, because the iframe is inserted right after it: in the booking section of the page, usually below the first screen. A widget placed at the very top of the page is in view at once, so lazy loading gives no saving there and can delay it slightly. In that case paste the plain `<iframe>` snippet and change `loading="lazy"` to `loading="eager"` (or remove the attribute). `embed.js` has no option to load eagerly.

- The framed widget posts `{"type": "opencovers:height", "height": <pixels>}` to its parent, and nothing else. `embed.js` uses a message only when it comes from the widget origin and from its own iframe and has exactly those two keys, and keeps the height between 100 and 6000 pixels. No guest data crosses `postMessage`.
- The API serves `/w/embed.js` from the widget build with `Content-Type: text/javascript`, `nosniff`, `Cross-Origin-Resource-Policy: cross-origin` and `Cache-Control: public, max-age=300` with an `ETag`, because the URL has no version. It follows the rules of the page: only on the `WIDGET_ADDRESS` host, never on the staff host, and not at all from a production API without `WIDGET_ADDRESS`. Caddy's existing `/w/*` rules cover it.
- The venue's site still needs its origin in `allowedOrigins`, and with a `Content-Security-Policy` of its own it must allow the widget origin in both `script-src` and `frame-src`.

`bash scripts/check-caddy-widget.sh` runs the shipped Caddyfile in Caddy with Docker and checks the headers of both site blocks.

Upgrading an existing stack: nothing changes until you set `WIDGET_ADDRESS`. The API image is now built in two stages, the first of which builds the widget, so the first `--build` takes longer.

In local development there is no second origin. The staff app's dev server proxies `/w/*` and `/r` to the API, the widget opens at `http://localhost:5173/w/BOOKING_KEY`, and its confirmation links to `http://localhost:5173/r#TOKEN`. `pnpm dev` rebuilds the widget on change.

## Sign-up control

`SIGNUP` decides who can create an account. The API enforces it, so it holds for every client of `/api/auth/*`.

| Value | Behavior |
| --- | --- |
| `open` | Anyone can sign up. This is the default when `SIGNUP` is unset, which keeps `pnpm dev` friction free. |
| `first-user` | Only the first account can sign up. After that every attempt is refused with `403` and the code `SIGNUP_CLOSED`. |
| `closed` | No one can sign up. |

`compose.prod.yaml` defaults to `first-user`, and `.env.prod.example` sets it. Create your own account before you publish the address, because the first visitor becomes the owner. Any other value stops the API at startup.

Upgrading an existing stack:

- An instance that already has accounts is closed under `first-user` with no extra step.
- The default for `compose.prod.yaml` changed from open to `first-user`. If you relied on open sign-up, set `SIGNUP=open` in `.env.prod`.
- The release adds a column and an index to the `user` table. The API applies the migration on boot.

### Adding staff

A venue `admin` adds staff with an invitation, with no change to `SIGNUP` and no SQL. It works under `open`, `first-user` and `closed`. See [ADR-0006](adr/0006-staff-invitations.md).

An admin creates and revokes invitations on the Team screen of the staff app, or through the API with a signed-in session. The invitee redeems in the staff app too, from the invite link the dialog shows. Invitations are created through a staff session. An API key, an `admin` key included, is refused.

1. The admin signs in and creates the invitation. Give an `email` to hold it for one address, or leave it out for an open link. It expires after 72 hours unless `expiresInHours` says otherwise, up to 336.

   ```sh
   curl -X POST https://your-domain/v1/venues/VENUE_ID/invitations \
     -H 'Cookie: SESSION_COOKIE' -H 'Content-Type: application/json' \
     -d '{"role":"write","email":"maria@example.com"}'
   ```

2. The response holds a `token`. It is shown once, because the API stores only a hash. The Team dialog shows it with a ready-to-copy link, `https://your-domain/#/invite?token=TOKEN`. Send the link or the token to the person over a private channel. The API sends no email. The token sits in the URL fragment, so it never reaches Caddy or its logs, and the staff app removes it from the address bar as soon as it reads it.
3. A person who already has an account opens the link, signs in if needed, and presses Join. Through the API, they send `POST /v1/invitations/redeem` with `{"token": "..."}`.
4. A person with no account opens the link and signs up on that page, which sends the token in the `X-Invitation-Token` header on `POST /api/auth/sign-up/email`. Without the app, send that header yourself. A sign-up with a valid token works even when `SIGNUP=closed`. A sign-up without one is still refused with `SIGNUP_CLOSED`.

Each invitation works once. The invitee gets the invited role in that one venue, and redeeming never creates a venue. `GET /v1/venues/VENUE_ID/invitations` lists them, and `DELETE /v1/venues/VENUE_ID/invitations/INVITATION_ID` revokes a pending one. Revoking does not remove a member who already redeemed. Use the members routes for that, below.

An invited account cannot create a venue of its own under `first-user` or `closed`. See [Who can create a venue](#who-can-create-a-venue). Redemption is rate limited per address, see [Rate limiting](#rate-limiting), but keep invitation tokens private and short lived.

### Who can create a venue

`POST /v1/venues` follows `SIGNUP`. See [ADR-0008](adr/0008-venue-creation-limit.md).

| Mode | Who creates venues |
| --- | --- |
| `open` | Any signed-in account. |
| `first-user` | Only the owner, the account that claimed the instance. The owner may create several venues. |
| `closed` | Only the owner, if an account is marked as one. |

Any other account gets `403` with the code `venue_creation_closed`, an invited `admin` included. It keeps full access to the venues it belongs to. API keys never create venues.

- **New instance.** Run under `first-user`, sign up, and create your first venue. That account is the owner. Then add staff with invitations. To close the instance for good, set `SIGNUP=closed` and restart. The owner keeps the right to create venues. `closed` cannot start an instance with no account, because nobody can sign up.
- **Upgrading an instance that ran under `open`.** No account is marked as owner, so under `first-user` or `closed` nobody can create a venue until you mark one. Existing venues, staff and keys keep working. Mark your own account, once:

  ```sh
  oc exec db psql -U opencovers opencovers -c "UPDATE \"user\" SET first_signup = true WHERE email = 'you@example.com'"
  ```

  Only one account can hold the mark. If it fails, an account already holds it. Or set `SIGNUP=open` for as long as you need, which also lets anyone sign up, then set it back.
- **Upgrading an instance that ran under `first-user`.** Its first account is already the owner. Nothing to do.
- **Handing the owner to someone else.** The owner makes another account the creator with no SQL: `POST /v1/account/transfer-creator` with `{"userId": "..."}`, or the crown button next to a member on the Team screen. The target must be a member of a venue the owner administers. The owner loses the right to create venues and keeps every venue and role. Only the new owner can hand it back. The swap is one transaction, so there is always exactly one owner, and it is written to the audit log of the venues the two share. The SQL step above remains only for an instance that has no owner at all. See [ADR-0016](adr/0016-member-roles-and-creator-transfer.md).

## Rate limiting

The API limits sign-in, sign-up, invitation redemption and venue creation per client address, and the guest booking routes under `/v1/public` by address and by booking key. It keeps the counters in memory. A refused call returns `429` with the code `rate_limited` and a `Retry-After` header. [ADR-0007](adr/0007-rate-limiting.md) has the design and the measured behavior of Better Auth's own limiter.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT` | `on` when `NODE_ENV=production`, otherwise `off` | `on` or `off`. An explicit value always wins. |
| `TRUST_PROXY` | `false`, `true` in `compose.prod.yaml` | Read the client address from the last `X-Forwarded-For` entry. Turn it on only when a reverse proxy is the sole way to reach the API. |
| `RATE_LIMIT_AUTH` | `30/15m` | Sign-in and every other write under `/api/auth` except sign-up. |
| `RATE_LIMIT_SIGNUP` | `5/1h` | Sign-up. |
| `RATE_LIMIT_INVITATION` | `10/15m` | `POST /v1/invitations/redeem` and a sign-up that carries `X-Invitation-Token`. |
| `RATE_LIMIT_VENUE_CREATION` | `10/1h` | `POST /v1/venues`. Every call counts, including one refused with `401`, `403` or `400`. |
| `RATE_LIMIT_PUBLIC_READ` | `300/15m` | Every `GET` under `/v1/public`: the widget config and public availability. |
| `RATE_LIMIT_PUBLIC_BOOKING` | `10/1h` | Public creates and link resends, per client address. |
| `RATE_LIMIT_PUBLIC_VENUE` | `100/1h` | The same routes, per booking key, all addresses together. Whoever spends it stops online booking in that venue until the window ends. Staff bookings are untouched. |
| `RATE_LIMIT_PUBLIC_SELF_SERVICE` | `60/15m` | Every `/v1/public/self-service` request, per client address. |
| `RATE_LIMIT_PUBLIC_DAYS` | `60/15m` | `GET /v1/public/{bookingKey}/days`, per client address. It also spends `RATE_LIMIT_PUBLIC_READ`. |

A budget is `max/window`, with a window in `s`, `m` or `h`. An unknown value stops the API at startup and names the variable. An empty value means the default.

- The compose stack sets `TRUST_PROXY=true`. Caddy replaces any client `X-Forwarded-For` with the address it sees, so a client cannot pick its own address. Do not publish the `api` port.
- With `TRUST_PROXY=false` behind a proxy, every client shares the proxy's address, so one abuser refuses everyone. The API logs a warning when it sees the header in that state.
- A CDN or second proxy in front of Caddy is not supported. All clients behind one edge address share a budget. Limit at the CDN, or accept that.
- Counters live in the API process. A restart clears them, and two API instances count separately.
- Each rule tracks at most 10,000 clients. When one is full, new clients of that rule get `429` until the oldest window ends, and the API logs a warning naming the rule. Spent budgets are never dropped to make room.
- An IPv6 client is counted by its `/48`, so clients that share one, such as some mobile carriers, share a budget.
- A public create that fails with `400` or `404` (a malformed body, a failed challenge, an unknown key) does not spend `RATE_LIMIT_PUBLIC_VENUE`. It still spends the sender's `RATE_LIMIT_PUBLIC_BOOKING`.

### Request size and cross-site writes

- The API refuses a request body over 16 KB under `/v1/public` and over 256 KB elsewhere with `400 invalid_request`. The shipped Caddyfile caps bodies at 64 KiB on the widget site and 1 MiB on the staff site (`request_body { max_size ... }`) and answers `413` beyond. Another proxy should set a similar cap.
- A staff write made with the session cookie must come from `BETTER_AUTH_URL` or a `TRUSTED_ORIGINS` entry, when the browser sends an `Origin`, and carry `Content-Type: application/json` when it has a body. Otherwise it fails with `403 forbidden` or `400 invalid_request`. The staff app does this already. If the staff app is served from an origin missing from both, its writes fail. API keys and the MCP server are unaffected.
- Staff in one venue usually share one public address. The defaults allow a shift change. Raise `RATE_LIMIT_AUTH` if a venue is large.
- Behind a venue's shared network, one abusive device can spend the budget for everyone there until the window ends.
- The limiter is off unless `NODE_ENV=production` or `RATE_LIMIT=on`, so `pnpm dev` needs no setting. The image and `compose.prod.yaml` set both. Outside Docker, set `NODE_ENV=production` or `RATE_LIMIT=on`, or the API runs with no limits. It logs one line at startup that says which.

### Seeing and removing staff

A venue `admin` with a staff session lists who has access and removes someone. An API key is refused, an `admin` key included. The Team screen of the staff app does both. See [ADR-0009](adr/0009-venue-members.md) and [ADR-0011](adr/0011-member-removal-revocation.md).

```sh
curl https://your-domain/v1/venues/VENUE_ID/members -H 'Cookie: SESSION_COOKIE'
curl -X DELETE https://your-domain/v1/venues/VENUE_ID/members/USER_ID -H 'Cookie: SESSION_COOKIE'
```

- The list shows each member's `userId`, `name`, `email` and `role`. `userId` is the handle for removal.
- The person loses access to that venue on their next request. Their account stays, and so do their other venues. When this was their last membership, their sessions are revoked too, so they must sign in again and then see no venue. When they still belong to another venue, their sessions are kept, because a session belongs to the account and not to a venue.
- A venue keeps at least one `admin`. Removing the last one, yourself included, fails with `last_admin`. Invite another admin first.
- To change a role, an `admin` sets it with `PATCH /v1/venues/VENUE_ID/members/USER_ID` and `{"role": "read"}` (or `write`, `admin`), or with the role selector on the Team screen. It applies on the person's next request. A change that would leave no `admin` fails with `last_admin`. A demotion does not revoke the keys the person made, so review `GET /v1/venues/VENUE_ID/keys` after demoting an admin. See [ADR-0016](adr/0016-member-roles-and-creator-transfer.md).
- Removal revokes the API keys the person made in this venue, and the response counts them under `revoked`. Keys made before ADR-0011, and keys made with an `admin` key, have no known creator and are not touched. After a leaver who handled keys, review `GET /v1/venues/VENUE_ID/keys` and revoke what they held.
- Webhook endpoints the person made keep delivering. They are not deleted or disabled. `GET /v1/venues/VENUE_ID/webhooks` shows `creatorDepartedAt` on them, so review each and delete any you do not trust. Endpoints made before ADR-0011 have no known creator.
- Invitations created, revoked and redeemed, removals, role changes and creator transfers, are recorded ([ADR-0010](adr/0010-membership-audit.md)). `GET /v1/venues/VENUE_ID/audit` (an `admin` session or key) lists them, newest first, with `limit` and `cursor`. It holds ids and a role only, no emails or tokens. The Team screen of the staff app shows the log to admins, newest first with a Load more button, and names the people who are still members. Former members show as a shortened id. The remove-member toast reports how many keys, sessions and webhooks the removal revoked or flagged.

## Hosted demo

Most instances never need this. `DEMO_MODE=1` turns one deployment into the public demo described in [ADR-0022](adr/0022-hosted-demo-sandbox.md): each visitor signs in with a magic link or Google and gets a sandbox restaurant of their own. Run it on its own host and its own database, never next to real data. With `DEMO_MODE` unset or `0` nothing below applies and the instance behaves as before. Any other value stops the API at startup.

What changes under `DEMO_MODE=1`:

- **Startup guard.** The API refuses to start if any venue has no `demo_sandbox` row (a venue the demo did not create) or any account has a password (`credential`) login: the demo turns password sign-up off, so such an account belongs to a real instance, and `demo:cleanup` deletes accounts. With `DEMO_MODE` off the API refuses to start if `demo_sandbox` has rows, so a sandbox never loses its restrictions to an unset variable. A venue is a sandbox because it has that row, not because of the flag.
- Password sign-up is off. `POST /api/auth/sign-in/magic-link` mails a link (Resend, so `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are required when `NODE_ENV=production`; without them nothing is delivered, and the link is never logged). The link token is stored hashed. Disposable addresses are refused: about 10,400 domains in `apps/api/src/demo/disposable-domains.txt`, vendored from the CC0 list `disposable-email-domains` (commit and date in the file header, with the refresh command), matched by suffix so `a.mailinator.com` is refused too. The request needs a solved proof-of-work challenge (ADR-0022, decision 8a); the flow is below.
- **Magic link limits** (`/api/auth` limits apply as well): per normalized address 1 a minute (`RATE_LIMIT_MAGIC_LINK`) and 5 a day (`RATE_LIMIT_MAGIC_LINK_DAY`), per client address 10 an hour (`RATE_LIMIT_MAGIC_LINK_IP`), and challenge requests per client address 60 an hour (`RATE_LIMIT_DEMO_CHALLENGE`). One normalization serves the limits, the challenge and the one-sandbox-per-address rule: Unicode NFKC and lower case, the domain in its ASCII (punycode) form without a trailing dot; for `gmail.com` and `googlemail.com` the dots and the `+tag` are removed. A `+tag` on other domains is kept, because providers differ. A body that is missing, over 4 KB, not JSON or whose address has whitespace, a comma or a control character is refused with `400`, never counted against the client address instead. A request the API refuses (`400`, `403`, `404`, `429` from the sign-in itself) does not spend the address's or the IP's link budget. The counters are per process and in memory: a restart resets them, and a second API process has its own. This is a known limit.
- **One sandbox per normalized address**, enforced by a unique value in `demo_sandbox` and checked before an account is created, for the magic link and for Google. Another spelling of an address that has a sandbox answers `403 DEMO_ADDRESS_IN_USE`. `DEMO_MAX_SANDBOXES` (default 500) caps live sandboxes and `DEMO_MAX_NEW_PER_DAY` (default 100) caps sandboxes created in the last 24 hours. At either cap the answer is `403 DEMO_FULL`, no account is created, and the sign-in page is meant to say the demo is full for now. These codes live under `/api/auth`, outside `docs/contract/`.
- Google sign-in turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set. The account must report a verified email. Set both or neither.
- The first verified sign-in builds a sandbox from `apps/api/src/demo/template.ts` and makes the visitor its `admin`, with online booking on, so `/w/{bookingKey}` works at once. Venue, membership, template and the sandbox row are one database transaction, so an interrupted build leaves nothing. At most `DEMO_PROVISION_CONCURRENCY` (default 3) sandboxes build at once; up to `DEMO_PROVISION_QUEUE` (50) wait, and further sign-ins get `DEMO_BUSY`. Keep the concurrency at least 3 below `DATABASE_POOL_MAX` (default 10). `DATABASE_CONNECTION_TIMEOUT_MS` (default 10000) makes a request that cannot get a connection fail instead of hanging. A later sign-in returns the same sandbox. `POST /v1/venues` is refused: a visitor has the one.
- **Sandbox caps**, per sandbox, counted inside the write's transaction under a per-venue lock: reservations 150 and guests 100 (`DEMO_MAX_RESERVATIONS`, `DEMO_MAX_GUESTS`; a booking over them answers `guest_booking_limit`), and waitlist entries 60, tables 40, services 8, floor items 40, invitations 20, API keys 10, blocklist entries 50 (`DEMO_MAX_WAITLIST`, `DEMO_MAX_TABLES`, `DEMO_MAX_SERVICES`, `DEMO_MAX_FLOOR_ITEMS`, `DEMO_MAX_INVITATIONS`, `DEMO_MAX_API_KEYS`, `DEMO_MAX_BLOCKLIST`). Over them the API answers `409 demo_limit_reached` (the blocklist keeps its `blocklist_limit_reached`). A sandbox cannot create webhooks, its widget's allowed origins are fixed when it is built (the demo host's origin when `BETTER_AUTH_URL` is https, otherwise none), and its mail always uses the operator's `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, whatever the visitor stores in the venue config. Email goes only to the verified address of the account that owns the sandbox (the `demo_sandbox` row), whatever a guest types in a booking, the lost-link form or the notice address, and not to another admin who joined through an invitation. An invitation made in a sandbox is not mailed. Webhook deliveries are also skipped for a sandbox, and an endpoint found on one is switched off.
- **Leads and consent.** Signing in creates no lead. A signed-in visitor who ticked the contact box makes the sign-in form call `POST /api/demo/consent` with their session cookie and `{ "version": "v1", "locale": "es", "name": "optional" }`. `version` must equal the current consent text version, `locale` one of `es en ca fr de it pt`, `name` at most 120 characters, and nothing else is accepted. The row is written for the verified address of the signed-in account, so nobody can consent for another inbox. The old `X-Demo-Consent` and `X-Demo-Locale` headers and the claim cookie are gone. No HTTP route returns leads. The unsubscribe route is a later change.

Asking for a magic link, as a sign-in form does it (outside `docs/contract`, demo mode only; with `DEMO_MODE` off both routes answer 404):

1. `POST /api/demo/magic-link-challenge` with `{ "email": "visitor@example.com" }`. Public, limited to 60 per IP per hour. It answers `200 { "challenge": { "nonce", "issuedAt", "difficulty", "signature" }, "expiresAt": "<ISO time>" }` and says nothing about whether the address has an account. The challenge is bound to that address (normalized as above, so `A.B+x@gmail.com` and `ab@googlemail.com` are one address), is good for one request and expires after 5 minutes.
2. Find a decimal `solution` (a string of 1 to 16 digits, counting from `0`) such that `SHA-256("<nonce>:<solution>")` starts with at least `difficulty` zero bits. This is the booking widget's scheme (ADR-0017); the difficulty is `PUBLIC_POW_DIFFICULTY`, 12 by default. A browser solves it in well under a second in a Web Worker.
3. `POST /api/auth/sign-in/magic-link` with `{ "email": ... }` (the same address) and two extra headers: `X-Demo-Challenge: <the challenge object from step 1, as JSON>` and `X-Demo-Solution: <solution>`.

Refusals, all `400` with a body `{ "code", "message" }` and no email sent: `CHALLENGE_REQUIRED` (a header is missing), `CHALLENGE_INVALID` (wrong solution, bad signature, expired, already used, issued for another address or for a booking), `DISPOSABLE_EMAIL`. A refused request does not spend the address's or the IP's link budget, so a bot cannot lock a visitor out by posting without a challenge. A body with no usable address answers `400 invalid_request` before any limit is charged. `429` with `Retry-After` means a limit tripped: ask again with a new challenge once the wait is over. The answer to a valid request for an address is the same whether or not it already has an account. Another spelling of an address that already has a sandbox answers `403 DEMO_ADDRESS_IN_USE`. Whoever solves a challenge for an address can still send that address up to 5 links a day, by design of decision 8a.

Housekeeping, run both from the repository root with the API's `DATABASE_URL`:

```sh
pnpm demo:cleanup             # needs DEMO_MODE=1 and passes the startup guard; see below
pnpm demo:leads               # print consented, not withdrawn visitors, as CSV
pnpm demo:leads --erase EMAIL # delete one person's lead row, under any spelling of the address (an erasure request)
```

`demo:cleanup` deletes sandboxes whose owner last signed in over 14 days ago, with their accounts, one transaction per sandbox, so a failure is retried by the next run. It also deletes accounts with no sandbox that are older than 14 days with no recent session (a refused or failed first sign-in), and consented leads 12 months after `last_seen_at`. It never keeps a lead row without consent. It never deletes a venue that has no `demo_sandbox` row, nor an account that is a member of such a venue, and it refuses to run unless `DEMO_MODE=1` and the database passes the startup guard. Schedule it daily; `compose.demo.yaml` does (see the runbook below). Both commands also run inside the API container with `pnpm --filter @opencovers/api demo:cleanup`.

### Runbook: put the demo online

The repository ships the pieces. The project's own demo is `demo.opencovers.dev`, with the booking widget at `book.demo.opencovers.dev`, on one VPS with Docker. These are defaults. Change them in `.env.demo` and in the repository variables below.

| File | What it is |
| --- | --- |
| `compose.demo.yaml` | The stack: `db`, `api` (`DEMO_MODE=1`, `NODE_ENV=production`, `SIGNUP=closed`), `cleanup` and `web` (Caddy plus the staff app build). Project name `opencovers-demo`, so its volumes are `opencovers-demo_pgdata` and `opencovers-demo_caddy_data`, never those of `compose.prod.yaml`. |
| `.env.demo.example` | Every variable, with comments. Copy it to `.env.demo` on the server. `.env.demo` is git-ignored. |
| `apps/web/Caddyfile` | The same Caddyfile as production. The staff host serves the app, `/api`, `/v1` and `/health`, and answers 404 on `/w/*` and `/r`. The widget host serves only `/w/*`, `/r`, `/favicon.ico` and `/v1/public/*`. |
| `.github/workflows/deploy-demo.yml` | Redeploys the demo over SSH on every push to `main` that touches the API, web, widget, database, lockfile or the compose file. |
| `apps/site/demo.json` | The site's "Probar la demo" and "Try the demo" button. Empty means no button. |

**1. DNS.** Two records at your DNS provider, both pointing at the server (`A`, plus `AAAA` if it has IPv6): `demo.opencovers.dev` and `book.demo.opencovers.dev`. Caddy gets the TLS certificates from Let's Encrypt on the first request, so the records must resolve and ports 80 and 443 must be open before you start the stack. Open no other port. Never publish the `api` port.

**2. Resend.** Add a sending domain in Resend (the project suggests `opencovers.dev`), publish the DKIM, SPF and return-path records it lists, and wait for it to verify. Create an API key with sending access. `RESEND_FROM_EMAIL` must be an address on that domain, such as `OpenCovers <demo@opencovers.dev>`. The API refuses to start in production demo mode without both values, and so does `pnpm demo:cleanup`.

**3. Google sign-in (optional).** In Google Cloud, create an OAuth client of type Web application and a consent screen. Add the authorized redirect URI `https://demo.opencovers.dev/api/auth/callback/google`. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set both or neither. The consent screen needs the privacy policy link and, before it leaves testing mode, Google's own verification.

**4. The server.** Any VPS with Docker Engine and the Compose plugin. 2 vCPU and 2 GB of RAM are a reasonable start for the default caps (a guess, not measured). A deploy rebuilds the images on the server, and the build plus PostgreSQL can run out of memory on 2 GB, so use 4 GB or add swap. Docker keeps container logs without a size limit by default: set `log-driver` `json-file` with `max-size` and `max-file` in `/etc/docker/daemon.json` so they cannot fill the disk. Create a user for the deploy, let it use Docker, and clone the repository once:

```sh
git clone https://github.com/David-Cabeza/OpenCovers.git opencovers   # in the deploy user's home
cd opencovers
cp .env.demo.example .env.demo
chmod 600 .env.demo
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # BLOCKLIST_KEY, a different value
openssl rand -base64 32   # PUBLIC_CHALLENGE_SECRET (optional, recommended)
openssl rand -hex 16      # POSTGRES_PASSWORD, letters and digits only
```

Paste the values into `.env.demo` and fill the Resend (and Google) values. `PUBLIC_CHALLENGE_SECRET` is optional with one API process, which is how the stack runs. Without it the API signs challenges with a key made at start, so a restart voids the ones open at that moment (they last 5 minutes) and the API logs a warning. Set it to avoid that.

**5. First deploy.** By hand, to see it work before the workflow does it for you:

```sh
docker compose --env-file .env.demo -f compose.demo.yaml up -d --build --wait
curl -fsS https://demo.opencovers.dev/health
```

The API migrates the database when it starts. Never point `.env.demo` at a database that holds real data: the startup guard refuses a database that has venues the demo did not create.

**6. Deploys on every push to `main`.** In the repository settings, create an environment named `demo` and add these secrets to it:

| Secret | Value |
| --- | --- |
| `DEMO_SSH_HOST` | The server's address. While it is empty the workflow skips every step and the run is green. |
| `DEMO_SSH_USER` | The deploy user. |
| `DEMO_SSH_KEY` | A private key (ed25519) whose public half is in the user's `authorized_keys`. Use a key made for this, with no other access. |
| `DEMO_SSH_PORT` | Optional. Default 22. |
| `DEMO_SSH_KNOWN_HOSTS` | Optional but recommended: the output of `ssh-keyscan -p PORT HOST`, taken from a network you trust. Without it the workflow trusts the host key it sees on first contact, and warns. |

Optional repository variables: `DEMO_DIR` (the clone's path under the user's home, default `opencovers`) and `DEMO_URL` (default `https://demo.opencovers.dev`). A deploy fetches `main`, checks out the pushed commit, runs `docker compose ... up -d --build --wait --remove-orphans` and `pnpm db:migrate`, then checks the staff app, `/health` and `/api/demo/status` (it reports `enabled:true` only under `DEMO_MODE=1`) from the runner. Deploys never overlap. Run one by hand from Actions, `deploy-demo`, Run workflow. Add a required reviewer to the `demo` environment if you want a pause before each deploy.

**7. Read the leads.** On the server, in the clone (`$dc` stands for this Compose command in the steps that follow):

```sh
dc="docker compose --env-file .env.demo -f compose.demo.yaml"
$dc exec -T api pnpm --silent demo:leads > leads.csv
$dc exec -T api pnpm --silent demo:leads --erase visitor@example.com
```

The CSV has `email,name,source,locale,created_at,last_seen_at,consent_text_version`, only for visitors who ticked the contact box and have not withdrawn. Handle it as personal data: keep it off shared drives and delete it when you are done. The `--erase` form answers an erasure request.

**8. Housekeeping.** The `cleanup` service runs `pnpm demo:cleanup` when the stack starts and every 24 hours after. To run it now: `$dc exec -T api pnpm demo:cleanup`. Its log is `$dc logs cleanup`.

**9. Reset the demo.** This deletes every sandbox, account and lead. Export the leads first if you want them.

```sh
$dc down -v
$dc up -d --build --wait
```

`down -v` removes only this project's volumes. To drop sandboxes and keep the leads, there is no shortcut: let `demo:cleanup` age the sandboxes out.

**10. Take the demo down.** Set `url` in `apps/site/demo.json` back to `""` and merge, so the site stops linking to it. Then on the server `$dc down` stops it and keeps the data, and `$dc down -v` deletes the data too. To stop automatic deploys, remove `DEMO_SSH_HOST` from the `demo` environment.

**Backups.** The stack does not back up the database. A demo can be rebuilt and sandboxes expire in 14 days. The exception is the leads: export them (step 7) on a schedule you choose. A `pg_dump` cron on the host is the next step if you want more.

**What the repository checks do not cover.** A real deploy to a server, Let's Encrypt, Resend delivery and Google sign-in need your accounts. The repository checks cover the compose file, the Caddy host rules (`STAFF_HOST=demo.opencovers.dev WIDGET_HOST=book.demo.opencovers.dev bash scripts/check-caddy-widget.sh`) and the workflow's syntax.

#### Privacy notice wording for the demo

`apps/site/public/privacidad.html` does not mention the demo yet, and the demo stores visitor data. Before opening the demo, add wording like this and have it reviewed. It is a draft, not legal advice.

> **Demo alojada.** Si pruebas la demo en demo.opencovers.dev guardamos tu dirección de correo (o la que verifica Google) para crear tu restaurante de prueba y enviarte el enlace de acceso. Tu restaurante de prueba y tu cuenta se borran tras 14 días sin acceso. Si marcas la casilla de contacto, guardamos además tu correo, tu nombre si lo das, el idioma y la fecha, para escribirte sobre OpenCovers, durante un máximo de 12 meses desde tu último acceso. Puedes retirar el consentimiento o pedir el borrado escribiendo a [contacto].
>
> **Hosted demo.** If you try the demo at demo.opencovers.dev we store your email address (or the one Google verifies) to create your sandbox restaurant and send you the sign-in link. The sandbox and your account are deleted after 14 days without sign-in. If you tick the contact box we also keep your email, your name if you give one, the language and the date, to write to you about OpenCovers, for at most 12 months after your last sign-in. You can withdraw consent or ask for erasure by writing to [contact].

Resend (email) and Google (sign-in) process that data, so the privacy page should name them. The consent text version is `v1` (`CONSENT_TEXT_VERSION` in `apps/api/src/demo/settings.ts`). A new wording needs a new version, which the sign-in form and `POST /api/demo/consent` must send together.

#### Launch checklist

- [ ] Legal review of the consent text (`v1`) and of the privacy notice above, including the legal basis for storing leads and for sending news, and who the controller is. Do not open the demo to the public before this.
- [ ] `privacidad.html` carries the demo wording, with a real contact address.
- [ ] DNS records resolve, and ports 80 and 443 are open on the server and nothing else.
- [ ] Resend domain verified, and a test magic link reaches a real inbox (check spam too).
- [ ] Google client created, its redirect URI added, and a test sign-in works (or both Google variables left empty).
- [x] The sign-in screens (the staff app's demo UI) are on `main` (PR #216), so the demo has a way in.
- [ ] `https://demo.opencovers.dev/health` answers, and a new visitor reaches a sandbox whose `/w/{bookingKey}` page opens on `book.demo.opencovers.dev`.
- [ ] The caps (`DEMO_MAX_SANDBOXES`, `DEMO_MAX_NEW_PER_DAY`) fit the server and your email plan.
- [ ] `DEMO_SSH_*` secrets set on the `demo` environment, and one manual run of `deploy-demo` is green.
- [ ] Last: set `url` in `apps/site/demo.json` to `https://demo.opencovers.dev` and merge. Ship the button only once the demo is live. The site then links to it from the Spanish hero, the English page and `llms.txt`.

## Public site

The project's site is built by `.github/workflows/deploy-site.yml` and published to GitHub Pages at **opencovers.dev**. The `CNAME` file in `apps/site/public/` pins the custom domain. A fork has no need for this workflow. Build with `pnpm --filter @opencovers/site build` and serve `apps/site/dist` wherever you like.

DNS for the project's apex domain, for reference:

- `opencovers.dev` has four A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
- `www.opencovers.dev` is a CNAME to `David-Cabeza.github.io`.

## Environment

The API reads these variables regardless of host:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://…` connection string. |
| `BETTER_AUTH_SECRET` | yes | `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public base URL of the API. |
| `TRUSTED_ORIGINS` | yes | Comma-separated origins allowed to call auth and to send cookie-authenticated writes (the staff app origin). |
| `SIGNUP` | no | `open` (default), `first-user` or `closed`. See Sign-up control. |
| `RATE_LIMIT` | no | `on` or `off`. Default `on` in `compose.prod.yaml`. See Rate limiting. |
| `TRUST_PROXY` | no | `false` (default) or `true`. See Rate limiting. |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_SIGNUP`, `RATE_LIMIT_INVITATION`, `RATE_LIMIT_VENUE_CREATION`, `RATE_LIMIT_PUBLIC_READ`, `RATE_LIMIT_PUBLIC_BOOKING`, `RATE_LIMIT_PUBLIC_VENUE`, `RATE_LIMIT_PUBLIC_SELF_SERVICE`, `RATE_LIMIT_PUBLIC_DAYS` | no | Budgets as `max/window`, such as `30/15m`. See Rate limiting. |
| `DEMO_MODE` | no | `1` runs the hosted demo, `0` or unset does not. See Hosted demo. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Demo mode only. Both or neither. See Hosted demo. |
| `DEMO_MAX_RESERVATIONS`, `DEMO_MAX_GUESTS`, `DEMO_MAX_WAITLIST`, `DEMO_MAX_TABLES`, `DEMO_MAX_SERVICES`, `DEMO_MAX_FLOOR_ITEMS`, `DEMO_MAX_INVITATIONS`, `DEMO_MAX_API_KEYS`, `DEMO_MAX_BLOCKLIST` | no | Demo mode only. Caps per sandbox, defaults 150, 100, 60, 40, 8, 40, 20, 10, 50. |
| `DEMO_MAX_SANDBOXES`, `DEMO_MAX_NEW_PER_DAY` | no | Demo mode only. Live sandboxes (default 500) and new sandboxes per 24 hours (default 100). |
| `DEMO_PROVISION_CONCURRENCY`, `DEMO_PROVISION_QUEUE` | no | Demo mode only. Builds at once (default 3, at least 3 below the pool) and sign-ins waiting (default 50). |
| `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT_MS` | no | Database pool size (default 10) and the wait for a free connection before a request fails (default 10000). |
| `RATE_LIMIT_MAGIC_LINK`, `RATE_LIMIT_MAGIC_LINK_DAY`, `RATE_LIMIT_MAGIC_LINK_IP`, `RATE_LIMIT_DEMO_CHALLENGE` | no | Demo mode only. Magic links per address (default `1/1m`), per address per day (`5/24h`) and per IP (`10/1h`); challenge requests per IP (`60/1h`). Same `max/window` form as the other `RATE_LIMIT_*` variables. |
| `PUBLIC_POW_DIFFICULTY` | no | Proof-of-work bits for a public booking, 0 to 32. Default `12`. `0` turns the proof of work off and keeps the signed challenge. The API logs the effective difficulty at startup, and a warning when it is `0` with `NODE_ENV=production`. See ADR-0017. |
| `PUBLIC_CHALLENGE_SECRET` | no | Signs the public form challenge, at least 32 characters. Default: a random key per process, which is enough for one API process. Set it when several serve the widget. With `NODE_ENV=production` and no value, the API logs a warning at startup. |
| `WIDGET_ADDRESS` | no | The booking widget's host, such as `book.example.com`. Caddy and the API both read it. Unset, a production API serves no widget page. It must not share the staff app's host name. See Booking widget. |
| `WIDGET_DIST` | no | The widget build the API serves. Default: `apps/widget/dist` in the repository, which the image fills. |
