# Hardening guide for self-hosters

This guide covers the stack in `compose.prod.yaml`. It states what the code does today and lists what it does not do. OpenCovers is pre-alpha. Read the known gaps before you take real guest data.

All commands run from the repository root. Define a shorthand first:

```sh
alias oc='docker compose -f compose.prod.yaml --env-file .env.prod'
```

## What the stack exposes

| Service | Published to the host | Notes |
| --- | --- | --- |
| `web` (Caddy) | `HTTP_PORT` (80) and `HTTPS_PORT` (443) | The only public entry point. Serves the staff app and proxies `/api/*` and `/v1/*` to the API. |
| `api` | nothing | Listens on port 3000 inside the compose network only. |
| `db` (PostgreSQL 16) | nothing | Reachable only by the `api` service. Data lives in the `pgdata` volume. |

Keep it that way. Do not add `ports:` to `api` or `db`. If you need a database shell, use `oc exec db psql -U opencovers opencovers`.

Open only 80 and 443 on the machine firewall. Port 80 is needed for certificate issuance and the redirect to HTTPS.

## Secrets

Put secrets in `.env.prod` and nothing else. `.env.prod` is git-ignored and excluded from the Docker build context. Never commit it. Restrict it with `chmod 600 .env.prod`.

| Variable | What it protects | Rule |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Staff sessions | Generate with `openssl rand -base64 32`. Compose refuses to start without it. |
| `POSTGRES_PASSWORD` | The database | Letters and digits only, because it goes inside the database URL. Compose refuses to start without it. Use a long random value. |
| `RESEND_API_KEY` | Outgoing email | Optional. Create a key limited to sending. |

If you run the API without Docker, `BETTER_AUTH_SECRET` falls back to a fixed development value that is public in the source. Anyone can forge sessions if it is left in place. Always set it.

Webhook signing secrets are generated per endpoint by the API. They are returned once, when the endpoint is created.

## Domain and HTTPS

Set `SITE_ADDRESS=app.example.com` and `PUBLIC_URL=https://app.example.com` in `.env.prod`. Caddy then requests and renews a certificate on its own. Certificates are stored in the `caddy_data` volume, so keep that volume across restarts.

`PUBLIC_URL` feeds both `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`. Auth requests from any other origin are refused. Set it to the exact `https://` origin users type.

The project has not yet verified automatic HTTPS on a real domain. Check it yourself after the first deploy, see the checklist at the end.

## Reverse proxy and client IP

Caddy is the only proxy in front of the API. Its `reverse_proxy` directive replaces any client `X-Forwarded-For` with the address it sees (measured with Caddy 2.11 and `apps/web/Caddyfile`). The API reads that header for one decision, the rate limits, and only when `TRUST_PROXY=true`. `compose.prod.yaml` sets it. See [Rate limiting](deploy.md#rate-limiting) and [ADR-0007](adr/0007-rate-limiting.md).

- Keep `TRUST_PROXY=true` with the stack as shipped. With it off, every client shares Caddy's address, so one abuser can refuse everyone's sign-in until the window ends. The API logs a warning when it sees the header in that state.
- If the API is ever reachable without Caddy, `TRUST_PROXY=true` lets a client pick its own address. It can dodge its limit, or spend another address's budget. Do not publish the `api` port.
- A proxy or CDN in front of Caddy is not supported. Caddy then sees the proxy's address, so all clients behind one edge share a budget. Limit at the edge instead.

## Authentication and access

- Staff sign in with email and password through Better Auth. Sessions are cookies signed with `BETTER_AUTH_SECRET`.
- The `SIGNUP` variable decides who can create a staff account. The API enforces it for every client of `/api/auth/*`. A refused attempt returns `403` with the code `SIGNUP_CLOSED`.
  - `open`: anyone can sign up. This is the default when `SIGNUP` is unset, so `pnpm dev` needs no environment.
  - `first-user`: only the first account can sign up. After that every attempt is refused.
  - `closed`: nobody can sign up.
- `compose.prod.yaml` defaults to `first-user`. Any other value stops the API at startup. See [Sign-up control](deploy.md#sign-up-control) and [ADR-0005](adr/0005-signup-control.md).
- Agents and integrations use API keys sent in the `apikey` header. The API stores only the SHA-256 hash of each key.
- Roles are `read`, `write` and `admin`. A `read` key cannot call a write method. Configuration, tables, services, keys, guest merges and the floor plan require `admin`.
- `POST /v1/venues` follows `SIGNUP`. Under `first-user` and `closed` only the owner can create a venue, and an invited account cannot. API keys never can. See [Who can create a venue](deploy.md#who-can-create-a-venue).
- Staff are added with invitations. An invitation is single use, expires, and its token is shown once and stored only as a hash. Only a venue `admin` with a staff session creates one. Redemption attempts are rate limited per address (see known gap 2), and the staff app has no invitation screen yet.
- A venue `admin` with a staff session lists the venue's members and removes one. A key does not, whatever its role. A removed person loses access to that venue on their next request. A venue always keeps one `admin`, under concurrent requests too, enforced by a row lock in the API. Direct SQL on `venue_memberships` is not covered by that rule. Removal does not revoke API keys or webhooks, which belong to the venue. See [Seeing and removing staff](deploy.md#seeing-and-removing-staff) and [ADR-0009](adr/0009-venue-members.md).
- A key is granted to specific venues. A request for a venue the key does not hold returns not found.
- Give each agent the lowest role that works. The venue keys endpoint accepts only `read` and `write`.

### Rotate an API key

1. Create the new key in the staff app under Setup, API keys. It is the same as `POST /v1/venues/{venueId}/keys` with a `key`, a `principal` and a `role`.
2. Switch the integration to the new key.
3. Revoke the old one in the same screen. It is the same as `DELETE /v1/venues/{venueId}/keys` with the old key's `hash`.

Generate keys with at least 32 random bytes, for example `openssl rand -base64 32`.

### Rotate `BETTER_AUTH_SECRET`

1. Back up the database.
2. Put a new value in `.env.prod`.
3. Run `oc up -d api`.

Sessions signed with the old secret stop validating, so every staff member signs in again. This follows from how signed cookies work. It has not been tested in this repository.

### Rotate the database password

The `postgres` image reads `POSTGRES_PASSWORD` only when it first creates the data directory. Changing `.env.prod` alone does not change the password. Do both:

```sh
oc exec db psql -U opencovers -d opencovers -c "ALTER USER opencovers PASSWORD 'NEWPASSWORD'"
# edit POSTGRES_PASSWORD in .env.prod to the same value
oc up -d api
```

## Backups

The database holds everything. Back it up on a schedule and copy the dump off the machine.

```sh
oc exec -T db pg_dump -U opencovers -Fc opencovers > "opencovers-$(date +%F).dump"
```

Example nightly cron entry (adjust the path):

```
0 3 * * * cd /srv/opencovers && docker compose -f compose.prod.yaml --env-file .env.prod exec -T db pg_dump -U opencovers -Fc opencovers > /var/backups/opencovers-$(date +\%F).dump
```

Dumps hold guest data. Encrypt them and apply the same retention rules you apply to the database. Erasure and retention in the API do not reach into old dumps.

Also back up `.env.prod` separately, in a password manager or secret store. Without `BETTER_AUTH_SECRET` the restored stack still works, but all sessions are invalid. Without `POSTGRES_PASSWORD` a fresh database must be initialized.

The `caddy_data` volume holds certificates. Caddy can issue new ones, so backing it up is optional.

### Restore

Test this on a spare machine before you need it.

```sh
oc stop api web
oc exec db psql -U opencovers -d postgres -c "DROP DATABASE opencovers WITH (FORCE)"
oc exec db psql -U opencovers -d postgres -c "CREATE DATABASE opencovers OWNER opencovers"
oc exec -T db pg_restore -U opencovers -d opencovers --no-owner < opencovers-2026-01-01.dump
oc up -d
```

The API applies any missing migrations on boot, so a dump taken on an older version restores onto a newer image.

## Updating

```sh
git pull
oc exec -T db pg_dump -U opencovers -Fc opencovers > "pre-update-$(date +%F).dump"
oc up -d --build
oc logs api --tail 50
```

The API image runs `pnpm db:migrate` before it starts. The repository has forward migrations only and no down migrations. To roll back, restore the pre-update dump and check out the previous version.

Read the commit log or release notes before you update. A pre-alpha release can change the schema.

## Limits and abuse controls

The API code adds none of the following. See known gaps.

- Rate limiting on `/v1/*`.
- Request body size limits.
- Account lockout or two-factor sign-in.

What the code does provide:

- Rate limits per client address on sign-in and other writes under `/api/auth`, on sign-up, and on invitation redemption, kept in memory. They are on when `NODE_ENV=production` or `RATE_LIMIT=on`, and the compose stack sets both. Outside Docker the operator must set one of them. See known gap 2.
- Security headers, set by `apps/web/Caddyfile` on every response from the `web` service. See Security headers below.

- Webhook targets are checked before delivery. Plain `http` and private addresses are rejected unless `WEBHOOK_ALLOW_INSECURE=true`. Never set that variable in production. The API logs a warning at startup when it is on.
- Every write needs an idempotency key, so a retried request does not double-book.
- The database rejects overlapping bookings with an exclusion constraint.
- Retention runs hourly and blanks personal fields on records older than each venue's retention period.

## Security headers

`apps/web/Caddyfile` sets these headers on every response, including the proxied API routes:

- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Frame-Options: DENY`.
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`.
- `Strict-Transport-Security: max-age=31536000`, only on HTTPS requests. It has no `includeSubDomains` and no `preload`.
- The `Server` header is removed.

The staff app cannot be embedded in a frame. Scripts must come from the same origin, with no inline script and no `eval`. The two Google Fonts hosts are allowed because `apps/web/index.html` loads the Inter font from them.

`style-src` allows `'unsafe-inline'` on purpose. The toast library injects `<style>` tags at runtime and supports no nonce, so a run without it blocked two inline style tags at load. Scripts stay strict.

If you maintain your own copy of the Caddyfile or add a third-party script, style or connection, update the policy or the browser will block it.

## Known gaps

Close these before you serve real guests, or accept the risk knowingly.

1. **Sign-up and staff access.** The production stack defaults to `SIGNUP=first-user`, so a fork that changes nothing is private after the first account exists. Dev and any run outside compose default to `open`, where anyone who can reach the staff app can create an account and a venue. Venue data stays isolated, but that instance is not private. Five limits remain.
   - The first visitor to a fresh `first-user` instance becomes the owner. Register your own account before you publish the address.
   - Upgrading changes the compose default from open to `first-user`. An instance that already has accounts closes to new sign-ups on its next `up`. An instance with no accounts stays claimable. If you relied on open sign-up, set `SIGNUP=open` in `.env.prod`.
   - Staff are added with an invitation through the API, with no SQL. The Team screen of the staff app creates and revokes invitations, and lists and removes members. Redeeming an invitation still goes through the API, see [Adding staff](deploy.md#adding-staff). The API can list and revoke invitations, and list and remove members. Removing a person does not revoke API keys they created. See [ADR-0006](adr/0006-staff-invitations.md) and [ADR-0009](adr/0009-venue-members.md).
   - Venue creation follows `SIGNUP`. Under `first-user` and `closed`, only the owner, the account that claimed the instance, can create a venue. Any other account, an invited `admin` included, gets `403 venue_creation_closed` and keeps its own venues. API keys never create venues. Under `open` any account can, so only `first-user` and `closed` limit it. This does not stop an invited `admin` from running the venue it holds, which includes keys and more invitations. An instance whose accounts were created under `open` has no owner, so nobody can create a venue under `first-user` or `closed` until you mark one, see [Who can create a venue](deploy.md#who-can-create-a-venue). The rate limits in gap 2 do not cover `POST /v1/venues`, so venue creation is not rate limited. See [ADR-0008](adr/0008-venue-creation-limit.md).
   - If two first sign-ups arrive at the same moment, the database lets one commit. The loser gets a generic failure from the database error, not the `SIGNUP_CLOSED` message. Sign-up is rate limited per address. See gap 2.
2. **Rate limiting covers credentials only.** The API limits three kinds of call per client address, in memory. Defaults are in brackets. See [ADR-0007](adr/0007-rate-limiting.md) and [Rate limiting](deploy.md#rate-limiting).
   - Sign-in and every other write under `/api/auth` except sign-up (30 per 15 minutes).
   - Sign-up (5 per hour).
   - `POST /v1/invitations/redeem` and a sign-up that carries `X-Invitation-Token` (10 per 15 minutes).

   A refused call returns `429` with `rate_limited` and `Retry-After`, the same whatever the request names. Reads, `/health` and CORS preflights are never limited. What is **not** covered:
   - Every other `/v1` route, including reservation writes, key creation, webhooks and `POST /v1/venues`.
   - An attacker with many addresses. The key is the address. There is no account lockout, no CAPTCHA and no second factor.
   - Several API instances and restarts. Counters live in the process, so a restart clears them and two instances count separately. Compose runs one.
   - A shared address. People behind one venue network share a budget.
   - A CDN or second proxy in front of Caddy. See Reverse proxy and client IP.
   - Visibility. Refusals are not logged or counted.

   Better Auth's own limiter is replaced. Measured on 1.7.18, it was on only with `NODE_ENV=production` (so in the compose stack, not in `pnpm dev`), allowed 3 sign-ins or sign-ups per 10 seconds per address, kept its state in memory, covered only `/api/auth`, and answered `429` with `X-Retry-After` and no error code. Add a CDN, a firewall or a Caddy rate-limit module for the rest.
3. **No built-in backups.** Backups, restores and off-site copies are your job. The commands above are manual.
4. **Single instance.** Compose runs one API process. There is no high availability. Compose runs a health check on `api` (`GET /health` on port 3000) and on `web` (the Caddy admin endpoint at `127.0.0.1:2019`), and `docker compose ps` shows the result. Nothing restarts or alerts on `unhealthy`. Caddy routes `GET /health` to the API, so you can monitor `https://your-domain/health` from outside.
5. **No audit log of staff sign-ins.** Guest merges keep an audit trail. Sign-ins, key changes, invitations and member removals do not. Nothing records who removed whom.
6. **Operator-side items.** Private vulnerability reporting and a monitored code of conduct contact are not code. They are tracked in the roadmap, Phase 0.

## Checklist before the first real venue

- [ ] `.env.prod` has a random `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`, mode 600, not in git.
- [ ] `SITE_ADDRESS` and `PUBLIC_URL` use your real domain, and `https://` loads with a valid certificate.
- [ ] `oc ps` shows only `web` with published ports, and all three services report `healthy`.
- [ ] `curl -I https://your-domain/` shows the headers listed under Security headers, and `curl https://your-domain/health` returns `{"ok":true,"service":"opencovers"}`.
- [ ] `oc exec api printenv TRUST_PROXY` prints `true`, and 31 wrong sign-ins from one machine to `/api/auth/sign-in/email` end in `429` with a `Retry-After` header. Wait 15 minutes before you sign in yourself.
- [ ] `SIGNUP` is `first-user` or `closed` (check `oc exec api printenv SIGNUP`), you registered your own account before publishing the address, you know how you will add staff, and you know which account is the owner who can create venues.
- [ ] A backup ran, the dump left the machine, and you restored it on a spare machine.
- [ ] `WEBHOOK_ALLOW_INSECURE` is unset.
- [ ] Each agent key has the lowest role it needs and a named `principal`.
- [ ] The venue's retention period is set and the guest consent text is reviewed with your legal advisor.
