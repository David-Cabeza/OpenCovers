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

The API is ready. The staff app screen is not built yet, so for now an admin calls the API with a signed-in session. Invitations are created through a staff session. An API key, an `admin` key included, is refused.

1. The admin signs in and creates the invitation. Give an `email` to hold it for one address, or leave it out for an open link. It expires after 72 hours unless `expiresInHours` says otherwise, up to 336.

   ```sh
   curl -X POST https://your-domain/v1/venues/VENUE_ID/invitations \
     -H 'Cookie: SESSION_COOKIE' -H 'Content-Type: application/json' \
     -d '{"role":"write","email":"maria@example.com"}'
   ```

2. The response holds a `token`. It is shown once, because the API stores only a hash. Send it to the person over a private channel. The API sends no email.
3. A person who already has an account signs in and sends `POST /v1/invitations/redeem` with `{"token": "..."}`.
4. A person with no account signs up with the token in the `X-Invitation-Token` header on `POST /api/auth/sign-up/email`. A sign-up with a valid token works even when `SIGNUP=closed`. A sign-up without one is still refused with `SIGNUP_CLOSED`.

Each invitation works once. The invitee gets the invited role in that one venue, and redeeming never creates a venue. `GET /v1/venues/VENUE_ID/invitations` lists them, and `DELETE /v1/venues/VENUE_ID/invitations/INVITATION_ID` revokes a pending one. Revoking does not remove a member who already redeemed, and there is no endpoint for that yet. To remove one, delete their `venue_memberships` row.

An invited account can still create a venue of its own with `POST /v1/venues`, as any account can. See the hardening guide, known gaps. The API has no rate limiting, so keep invitation tokens private and short lived.

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
