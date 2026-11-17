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

- Caddy's widget site block forwards `/w/*`, `/r` and `/v1/public/*` to the API and answers everything else with `404`. The staff site block answers `/w/*` and `/r` with `404` and keeps `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path.
- The API writes the page per venue, because the page's `Content-Security-Policy` lists the origins allowed to frame it: `frame-ancestors 'self'` and the venue's `allowedOrigins`, or `'none'` when the list is empty, which allows only top-level use. It sends no `X-Frame-Options`. It also serves the widget's built files under `/w/assets/`. The guest's self-service link, `https://book.example.com/r#TOKEN`, opens the same build at `/r`, which no site may frame. The token stays in the fragment, so it never reaches Caddy, the API or their logs. The API image builds the widget, so nothing else needs copying.
- The API serves the page only for requests to the `WIDGET_ADDRESS` host. Without `WIDGET_ADDRESS`, a production API (`NODE_ENV=production`, as in the image) serves no widget page, and Caddy's widget block listens for `widget.invalid`, a name that never resolves. An API whose `WIDGET_ADDRESS` has the host name of `BETTER_AUTH_URL` or of a `TRUSTED_ORIGINS` entry refuses to start, whatever the port.
- A venue's site that sends its own `Content-Security-Policy` must allow the widget origin in `frame-src`.

### Automatic height with `embed.js`

A plain `<iframe>` keeps the height it is given. A venue that can paste a script tag gets an iframe that takes the widget's height instead:

```html
<script src="https://book.example.com/w/embed.js" data-key="BOOKING_KEY" async></script>
```

The script adds the iframe right after its own tag, loads `https://book.example.com/w/BOOKING_KEY` (the origin the script came from), and sets the iframe's height as the widget's content changes. `data-title` sets the iframe's accessible title (default `Book a table`). A `data-key` that is not a booking key (`pk_...`) adds nothing and logs a warning. Several tags on one page each get their own iframe.

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
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_SIGNUP`, `RATE_LIMIT_INVITATION`, `RATE_LIMIT_VENUE_CREATION`, `RATE_LIMIT_PUBLIC_READ`, `RATE_LIMIT_PUBLIC_BOOKING`, `RATE_LIMIT_PUBLIC_VENUE`, `RATE_LIMIT_PUBLIC_SELF_SERVICE` | no | Budgets as `max/window`, such as `30/15m`. See Rate limiting. |
| `PUBLIC_POW_DIFFICULTY` | no | Proof-of-work bits for a public booking, 0 to 32. Default `12`. `0` turns the proof of work off and keeps the signed challenge. The API logs the effective difficulty at startup, and a warning when it is `0` with `NODE_ENV=production`. See ADR-0017. |
| `PUBLIC_CHALLENGE_SECRET` | no | Signs the public form challenge, at least 32 characters. Default: a random key per process, which is enough for one API process. Set it when several serve the widget. With `NODE_ENV=production` and no value, the API logs a warning at startup. |
| `WIDGET_ADDRESS` | no | The booking widget's host, such as `book.example.com`. Caddy and the API both read it. Unset, a production API serves no widget page. It must not share the staff app's host name. See Booking widget. |
| `WIDGET_DIST` | no | The widget build the API serves. Default: `apps/widget/dist` in the repository, which the image fills. |
