# Deployment

OpenCovers does not depend on a hosting vendor. The engine needs PostgreSQL and a Node.js process. Whoever forks it for a venue chooses where the database and the processes live.

## What you run

| Part | What it is | Needs |
| --- | --- | --- |
| API (`apps/api`) | Node.js process (Hono) | PostgreSQL 16 or newer, Node.js 22 |
| Staff app (`apps/web`) | Static Vite build | Any static host or web server |
| MCP server (`apps/mcp`) | stdio process that talks to the API over HTTPS | Node.js 22, an API key |
| Site (`apps/site`) | Static Vite build | Any static host. The project's own copy is on GitHub Pages at opencovers.dev. |

## Database

Any PostgreSQL 16+ works: self-hosted, a container, or a managed service. The no-double-booking rule is a GiST exclusion constraint, so the database must be a real PostgreSQL. Set `DATABASE_URL` and run the migrations:

```sh
pnpm db:migrate
```

`compose.yaml` starts a local PostgreSQL for development.

## Quick start with Docker Compose

`compose.prod.yaml` runs the whole engine on any machine with Docker. It starts PostgreSQL, the API, and Caddy, which serves the staff app and forwards `/api/*` and `/v1/*` to the API. Everything shares one origin.

```sh
cp .env.prod.example .env.prod
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET
docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
```

Set `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` in `.env.prod`. The stack refuses to start without them. Use only letters and digits in the database password, because it goes inside the database URL. Open `http://localhost` and sign up. The first account is the owner. See [Sign-up control](#sign-up-control).

To serve a real domain, set `SITE_ADDRESS=app.example.com` and `PUBLIC_URL=https://app.example.com`. Caddy then gets a certificate on its own. Ports 80 and 443 must reach the machine. Use `HTTP_PORT` and `HTTPS_PORT` to publish other ports.

The API image applies migrations on boot. PostgreSQL is not published to the host.

Before you serve real guests, read the [hardening guide](hardening.md). It covers secrets, backups, key rotation, updates and the known gaps.

To use an external PostgreSQL instead, remove the `db` service and its `depends_on` entry, and set `DATABASE_URL` on the `api` service to your connection string.

Without Docker, build the staff app with `pnpm --filter @opencovers/web build`, serve `apps/web/dist` from any static host, and forward `/api/*` and `/v1/*` to the API. Add the staff app's origin to `TRUSTED_ORIGINS`.

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

An admin creates and revokes invitations on the Team screen of the staff app, or through the API with a signed-in session. Redeeming still goes through the API. Invitations are created through a staff session. An API key, an `admin` key included, is refused.

1. The admin signs in and creates the invitation. Give an `email` to hold it for one address, or leave it out for an open link. It expires after 72 hours unless `expiresInHours` says otherwise, up to 336.

   ```sh
   curl -X POST https://your-domain/v1/venues/VENUE_ID/invitations \
     -H 'Cookie: SESSION_COOKIE' -H 'Content-Type: application/json' \
     -d '{"role":"write","email":"maria@example.com"}'
   ```

2. The response holds a `token`. It is shown once, because the API stores only a hash. Send it to the person over a private channel. The API sends no email.
3. A person who already has an account signs in and sends `POST /v1/invitations/redeem` with `{"token": "..."}`.
4. A person with no account signs up with the token in the `X-Invitation-Token` header on `POST /api/auth/sign-up/email`. A sign-up with a valid token works even when `SIGNUP=closed`. A sign-up without one is still refused with `SIGNUP_CLOSED`.

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

## Rate limiting

The API limits sign-in, sign-up and invitation redemption per client address. It keeps the counters in memory. A refused call returns `429` with the code `rate_limited` and a `Retry-After` header. [ADR-0007](adr/0007-rate-limiting.md) has the design and the measured behavior of Better Auth's own limiter.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT` | `on` when `NODE_ENV=production`, otherwise `off` | `on` or `off`. An explicit value always wins. |
| `TRUST_PROXY` | `false`, `true` in `compose.prod.yaml` | Read the client address from the last `X-Forwarded-For` entry. Turn it on only when a reverse proxy is the sole way to reach the API. |
| `RATE_LIMIT_AUTH` | `30/15m` | Sign-in and every other write under `/api/auth` except sign-up. |
| `RATE_LIMIT_SIGNUP` | `5/1h` | Sign-up. |
| `RATE_LIMIT_INVITATION` | `10/15m` | `POST /v1/invitations/redeem` and a sign-up that carries `X-Invitation-Token`. |

A budget is `max/window`, with a window in `s`, `m` or `h`. An unknown value stops the API at startup and names the variable. An empty value means the default.

- The compose stack sets `TRUST_PROXY=true`. Caddy replaces any client `X-Forwarded-For` with the address it sees, so a client cannot pick its own address. Do not publish the `api` port.
- With `TRUST_PROXY=false` behind a proxy, every client shares the proxy's address, so one abuser refuses everyone. The API logs a warning when it sees the header in that state.
- A CDN or second proxy in front of Caddy is not supported. All clients behind one edge address share a budget. Limit at the CDN, or accept that.
- Counters live in the API process. A restart clears them, and two API instances count separately.
- Staff in one venue usually share one public address. The defaults allow a shift change. Raise `RATE_LIMIT_AUTH` if a venue is large.
- Behind a venue's shared network, one abusive device can spend the budget for everyone there until the window ends.
- The limiter is off unless `NODE_ENV=production` or `RATE_LIMIT=on`, so `pnpm dev` needs no setting. The image and `compose.prod.yaml` set both. Outside Docker, set `NODE_ENV=production` or `RATE_LIMIT=on`, or the API runs with no limits. It logs one line at startup that says which.

### Seeing and removing staff

A venue `admin` with a staff session lists who has access and removes someone. An API key is refused, an `admin` key included. The Team screen of the staff app does both. See [ADR-0009](adr/0009-venue-members.md).

```sh
curl https://your-domain/v1/venues/VENUE_ID/members -H 'Cookie: SESSION_COOKIE'
curl -X DELETE https://your-domain/v1/venues/VENUE_ID/members/USER_ID -H 'Cookie: SESSION_COOKIE'
```

- The list shows each member's `userId`, `name`, `email` and `role`. `userId` is the handle for removal.
- The person loses access to that venue on their next request. Their account stays, and so do their other venues.
- A venue keeps at least one `admin`. Removing the last one, yourself included, fails with `last_admin`. Invite another admin first.
- There is no role change. Remove the person and invite them again at the new role.
- Removal does not revoke API keys or webhook endpoints the person created, because they belong to the venue and not to a user. After a leaver who handled keys, review `GET /v1/venues/VENUE_ID/keys` and revoke what they held.
- Nothing records who removed whom. Keep your own note if you need one.

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
| `TRUSTED_ORIGINS` | yes | Comma-separated origins allowed to call auth (the staff app origin). |
| `SIGNUP` | no | `open` (default), `first-user` or `closed`. See Sign-up control. |
| `RATE_LIMIT` | no | `on` or `off`. Default `on` in `compose.prod.yaml`. See Rate limiting. |
| `TRUST_PROXY` | no | `false` (default) or `true`. See Rate limiting. |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_SIGNUP`, `RATE_LIMIT_INVITATION` | no | Budgets as `max/window`, such as `30/15m`. See Rate limiting. |
