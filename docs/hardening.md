# Hardening guide for self-hosters

This guide covers the stack in `compose.prod.yaml`. It states what the code does today and lists what it does not do. OpenCovers is pre-alpha. Read the known gaps before you take real guest data.

All commands run from the repository root. Define a shorthand first:

```sh
alias oc='docker compose -f compose.prod.yaml --env-file .env.prod'
```

## What the stack exposes

| Service | Published to the host | Notes |
| --- | --- | --- |
| `web` (Caddy) | `HTTP_PORT` (80) and `HTTPS_PORT` (443) | The only public entry point. Two site blocks: the staff host (`SITE_ADDRESS`) serves the staff app and proxies `/api/*`, `/v1/*` and `/health` to the API, and the widget host (`WIDGET_ADDRESS`) serves the guest booking channel. See The public booking channel. |
| `api` | nothing | Listens on port 3000 inside the compose network only. |
| `db` (PostgreSQL 16) | nothing | Reachable only by the `api` service. Data lives in the `pgdata` volume. |

Keep it that way. Do not add `ports:` to `api` or `db`. If you need a database shell, use `oc exec db psql -U opencovers opencovers`.

Open only 80 and 443 on the machine firewall. Port 80 is needed for certificate issuance and the redirect to HTTPS.

### The public booking channel

The guest booking widget has an origin of its own, set by `WIDGET_ADDRESS` (for example `book.example.com`). It is off until you set it. With it unset, the production API serves no widget page and Caddy's widget block listens for `widget.invalid`, a name that never resolves. It must not share a host name with the staff app. The API refuses to start if it does. See [Booking widget](deploy.md#booking-widget) and [ADR-0017](adr/0017-booking-widget-and-self-service-link.md).

What the widget host exposes, with no credentials:

- `/w/{bookingKey}`, the booking page, and `/w/assets/*` and `/w/embed.js`, the widget build. A guest or a bot that knows a booking key can open the page.
- `/r`, the self-service page. The guest's token travels in the URL fragment, so the server never sees it. Self-service calls under `/v1/public/self-service` take that token.
- `/v1/public/*`, the guest API: the widget config, availability, creating a booking, joining the waitlist, resending a lost link, and self-service changes. Every create needs a signed challenge and a proof of work, see Secrets.
- `/favicon.ico`. Every other path answers `404`.

What it does not expose: the staff app, `/api/*` and `/health`. The staff host answers `/w/*` and `/r` with `404`.

Two limits you should know:

- `/v1/public/*` is not host-gated. The staff host's `/v1/*` rule also forwards it to the API, so the same guest routes answer there too. The staff origin's session cookie does not authorize them, and the same rate limits apply. If you want them reachable only on the widget host, block the path on the staff host in your own Caddyfile. This is inferred from `apps/web/Caddyfile` and `apps/api/src/app.ts` and has not been tested.
- The 404 pages, the widget `Content-Security-Policy` and the frame rules differ per host. See Security headers.

### The one public venue route

`GET /v1/venues/{venueId}/public.jsonld` answers without credentials, and only for a venue whose admin turned the public profile on (off by default). It exposes the venue name, the public address, phone, website, cuisine, price range, optional coordinates, the opening hours from the venue's services (per weekday), and a booking URL. It never exposes `noticeAddress`, emails, keys or guest data. An unknown venue and a venue with the profile off give the same `404`, so the route does not tell a visitor which venue ids exist. It is a `GET`, so ADR-0007 does not rate limit it. It costs two small queries and is cacheable (`ETag`, `max-age=300`), so put a CDN or a server-side cache in front of it if the site is busy. CORS allows any origin for `GET`. Turn the profile off to withdraw the data. See [ADR-0012](adr/0012-public-profile-jsonld.md) and [public-profile.md](public-profile.md).

## Secrets

Put secrets in `.env.prod` and nothing else. `.env.prod` is git-ignored and excluded from the Docker build context. Never commit it. Restrict it with `chmod 600 .env.prod`.

| Variable | What it protects | Rule |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Staff sessions | Generate with `openssl rand -base64 32`. Compose refuses to start without it. |
| `BLOCKLIST_KEY` | The guest blocklist | Generate with `openssl rand -base64 32`, a different value from `BETTER_AUTH_SECRET`. Compose refuses to start without it. Never store it with a database dump. A dump restored under another key leaves the list inactive. During a rotation, set the old value as `BLOCKLIST_KEY_PREVIOUS`. See [ADR-0018](adr/0018-guest-blocklist.md). |
| `POSTGRES_PASSWORD` | The database | Letters and digits only, because it goes inside the database URL. Compose refuses to start without it. Use a long random value. |
| `PUBLIC_CHALLENGE_SECRET` | The signed challenge every public booking create carries | At least 32 characters, for example `openssl rand -base64 32`. Optional, but set it. Without it each API process signs with a random key, so a restart voids open challenges and a guest mid-form fails once. The API logs a warning under `NODE_ENV=production` when it is unset. `compose.prod.yaml` passes it through, but `.env.prod.example` does not list it, so add the line yourself. A shorter value stops the API at startup. |
| `RESEND_API_KEY` | Outgoing email | Optional. Create a key limited to sending. |

If you run the API without Docker, `BETTER_AUTH_SECRET` and `BLOCKLIST_KEY` fall back to fixed development values that are public in the source. Anyone can forge sessions, or test contacts against a dump of the blocklist, if they are left in place. Always set both.

`PUBLIC_POW_DIFFICULTY` is not a secret. It sets the proof of work on a public booking create, in leading zero bits from 0 to 32 (default 12). Do not set it to `0` in production. The API logs a warning when it is `0`, and only the signature and a 3-second minimum fill time remain.

Webhook signing secrets are generated per endpoint by the API. They are returned once, when the endpoint is created.

## Domain and HTTPS

Set `SITE_ADDRESS=app.example.com` and `PUBLIC_URL=https://app.example.com` in `.env.prod`. Caddy then requests and renews a certificate on its own. Certificates are stored in the `caddy_data` volume, so keep that volume across restarts.

`PUBLIC_URL` feeds both `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`. Auth requests from any other origin are refused. Set it to the exact `https://` origin users type.

To serve guests, also set `WIDGET_ADDRESS=book.example.com`, a second real domain with its own DNS record. Caddy gets a certificate for it the same way. Browsers run the widget's proof of work only over HTTPS (or on `localhost`), so on plain HTTP the widget cannot book. A venue's own site must be in that venue's `allowedOrigins` to frame the widget.

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
- Staff are added with invitations. An invitation is single use, expires, and its token is shown once and stored only as a hash. Only a venue `admin` with a staff session creates one. Redemption attempts are rate limited per address (see known gap 2), and the staff app redeems from an invite link whose token sits in the URL fragment, so no server log sees it.
- A venue `admin` with a staff session lists the venue's members and removes one. A key does not, whatever its role. A removed person loses access to that venue on their next request. A venue always keeps one `admin`, under concurrent requests too, enforced by a row lock in the API. Direct SQL on `venue_memberships` is not covered by that rule. In the same transaction, removal revokes the API keys the person made in that venue, revokes their sessions when it was their last membership, and flags the webhook endpoints they made without deleting them. An `admin` session also changes a member's role (never a key), under the same lock, and the venue creator can hand the creator mark to another account with no SQL. Invitations, removals, role changes and creator transfers are written to an id-only audit log that an `admin` reads. See [Seeing and removing staff](deploy.md#seeing-and-removing-staff), [ADR-0009](adr/0009-venue-members.md), [ADR-0010](adr/0010-membership-audit.md), [ADR-0011](adr/0011-member-removal-revocation.md) and [ADR-0016](adr/0016-member-roles-and-creator-transfer.md).
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

- Rate limiting on keyed `/v1/*` writes. Only `POST /v1/venues`, invitation redemption and the guest routes under `/v1/public` are limited. A key can write reservations, tables, config, keys and webhooks as fast as the API answers.
- Account lockout or two-factor sign-in.

What the code does provide:

- Request body limits. The API refuses a body over 16 KB under `/v1/public` and over 256 KB elsewhere with `400 invalid_request`. The shipped Caddyfile caps bodies at 64 KiB on the widget host and 1 MiB on the staff host, and answers `413` beyond. A body over the limit still spends the sender's rate budget.
- Rate limits per client address on sign-in and other writes under `/api/auth`, on sign-up, on invitation redemption, on venue creation, and on the guest routes under `/v1/public`, kept in memory. They are on when `NODE_ENV=production` or `RATE_LIMIT=on`, and the compose stack sets both. Outside Docker the operator must set one of them. See known gap 2.
- Security headers, set by `apps/web/Caddyfile` on every response from the `web` service. See Security headers below.
- Bot checks on a public booking create: a signed challenge, a proof of work and a 3-second minimum fill time.
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

The widget host has its own set: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, the same HSTS and no `Server` header. It sends no `X-Frame-Options` and no `Content-Security-Policy` of its own on `/w/*` and `/r`. The API writes the page's policy per venue, with `frame-ancestors 'self'` plus that venue's `allowedOrigins`, or `'none'` when the list is empty. `/r` cannot be framed. `/v1/public/*` gets `default-src 'none'; frame-ancestors 'none'` and `Cache-Control: no-store`.

The staff app cannot be embedded in a frame. Scripts must come from the same origin, with no inline script and no `eval`. The two Google Fonts hosts are allowed because `apps/web/index.html` loads the Inter font from them.

`style-src` allows `'unsafe-inline'` on purpose. The toast library injects `<style>` tags at runtime and supports no nonce, so a run without it blocked two inline style tags at load. Scripts stay strict.

If you maintain your own copy of the Caddyfile or add a third-party script, style or connection, update the policy or the browser will block it.

## Known gaps

Close these before you serve real guests, or accept the risk knowingly.

1. **Sign-up and staff access.** The production stack defaults to `SIGNUP=first-user`, so a fork that changes nothing is private after the first account exists. Dev and any run outside compose default to `open`, where anyone who can reach the staff app can create an account and a venue. Venue data stays isolated, but that instance is not private. Five limits remain.
   - The first visitor to a fresh `first-user` instance becomes the owner. Register your own account before you publish the address.
   - Upgrading changes the compose default from open to `first-user`. An instance that already has accounts closes to new sign-ups on its next `up`. An instance with no accounts stays claimable. If you relied on open sign-up, set `SIGNUP=open` in `.env.prod`.
   - Staff are added with an invitation through the API, with no SQL. The Team screen of the staff app creates and revokes invitations, lists and removes members, and changes their roles. An invitee redeems from the invite link in the staff app, see [Adding staff](deploy.md#adding-staff). The API can list and revoke invitations, list and remove members, and change roles. Removing a person revokes the keys they made, with the limits in gap 5. See [ADR-0006](adr/0006-staff-invitations.md), [ADR-0009](adr/0009-venue-members.md) and [ADR-0011](adr/0011-member-removal-revocation.md).
   - Venue creation follows `SIGNUP`. Under `first-user` and `closed`, only the owner, the account that claimed the instance, can create a venue. Any other account, an invited `admin` included, gets `403 venue_creation_closed` and keeps its own venues. API keys never create venues. Under `open` any account can, so only `first-user` and `closed` limit it. This does not stop an invited `admin` from running the venue it holds, which includes keys and more invitations. An instance whose accounts were created under `open` has no owner, so nobody can create a venue under `first-user` or `closed` until you mark one with the one SQL step in [Who can create a venue](deploy.md#who-can-create-a-venue). Once an owner exists, they hand the role over through the API, see [ADR-0016](adr/0016-member-roles-and-creator-transfer.md). Venue creation is rate limited per client address by gap 2 (10 per hour). See [ADR-0008](adr/0008-venue-creation-limit.md).
   - If two first sign-ups arrive at the same moment, the database lets one commit. The loser gets a generic failure from the database error, not the `SIGNUP_CLOSED` message. Sign-up is rate limited per address. See gap 2.
2. **Rate limiting covers credentials, venue creation and the guest routes only.** The API limits these calls per client address, in memory. Defaults are in brackets. See [ADR-0007](adr/0007-rate-limiting.md), [ADR-0017](adr/0017-booking-widget-and-self-service-link.md) and [Rate limiting](deploy.md#rate-limiting).
   - Sign-in and every other write under `/api/auth` except sign-up (30 per 15 minutes).
   - Sign-up (5 per hour).
   - `POST /v1/invitations/redeem`, `POST /v1/invitations/check` and a sign-up that carries `X-Invitation-Token` (10 per 15 minutes).
   - `POST /v1/venues` (10 per hour). Every call counts, a refused one included.
   - Every `GET` under `/v1/public` (300 per 15 minutes).
   - `GET /v1/public/{bookingKey}/days` (60 per 15 minutes, on top of the read budget).
   - Public creates, waitlist joins and link resends (10 per hour per address).
   - The same calls per booking key, all addresses together (100 per hour). Whoever spends it stops online booking in that venue until the window ends. Staff bookings are untouched.
   - Every `/v1/public/self-service` and waitlist-entry request (60 per 15 minutes).
   - With `MCP_REMOTE=on`, the OAuth authorize (30 per 15 minutes) and token (60 per 15 minutes) calls.

   A refused call returns `429` with `rate_limited` and `Retry-After`, the same whatever the request names. Reads outside `/v1/public`, `/health` and CORS preflights are never limited. What is **not** covered:
   - Every other `/v1` route, including reservation writes made with a key, key creation and webhooks. A leaked key is not slowed down.
   - An attacker with many addresses. The key is the address. There is no account lockout, no CAPTCHA and no second factor. The public create has a proof of work, which raises the cost but is not a CAPTCHA.
   - The per-booking-key budget. One attacker who spends it denies online booking to everyone at that venue.
   - Several API instances and restarts. Counters live in the process, so a restart clears them and two instances count separately. Compose runs one.
   - A shared address. People behind one venue network share a budget.
   - A CDN or second proxy in front of Caddy. See Reverse proxy and client IP.
   - Visibility. Refusals are not logged or counted.

   Better Auth's own limiter is replaced. Measured on 1.7.18, it was on only with `NODE_ENV=production` (so in the compose stack, not in `pnpm dev`), allowed 3 sign-ins or sign-ups per 10 seconds per address, kept its state in memory, covered only `/api/auth`, and answered `429` with `X-Retry-After` and no error code. Add a CDN, a firewall or a Caddy rate-limit module for the rest.
3. **No built-in backups.** Backups, restores and off-site copies are your job. The commands above are manual.
4. **Single instance.** Compose runs one API process. There is no high availability. Compose runs a health check on `api` (`GET /health` on port 3000) and on `web` (the Caddy admin endpoint at `127.0.0.1:2019`), and `docker compose ps` shows the result. `restart: unless-stopped` restarts a container that exits, but nothing restarts or alerts on `unhealthy`, and the stack ships no uptime check. Caddy routes `GET /health` to the API, so you can monitor `https://your-domain/health` from outside.
5. **The audit log is narrow, and old credentials have no known creator.** Guest merges, invitations (created, revoked, redeemed), member removals, role changes and creator transfers keep an audit trail. Sign-ins, key creation and revocation, webhook changes and config changes do not. The membership log holds ids and a role, not the counts of what a removal revoked, and anyone with SQL access can edit it. Two limits on removal, from [ADR-0011](adr/0011-member-removal-revocation.md):
   - API keys and webhook endpoints created before that change, keys made with an `admin` key, and webhooks made with a key have no recorded creator. Removing a person does not reach them. After a leaver, review the key list and the webhook list.
   - A removed person keeps their sessions when they still belong to another venue. Sessions belong to the account, so they cannot be revoked per venue. Their access to the venue they left ends at once, because it is checked on every request.
6. **Operator-side items.** Private vulnerability reporting is on for this repository, see [SECURITY.md](../SECURITY.md). If you fork, turn it on in your own repository settings. A monitored code of conduct contact is not code. It is tracked in the roadmap, Phase 0.
7. **The API container runs as root.** `apps/api/Dockerfile` has no `USER`, so the Node process runs as root inside the container. A bug in the API or a dependency then has root in the container. Mitigation until the image changes: keep `api` off published ports, and add `read_only: true` and `cap_drop: [ALL]` to `api` in your own compose override, after you check that it still starts.
8. **Guest-facing surface.** The widget host is open to the internet by design. Anyone with a booking key can read a venue's widget config and availability and try to book, within the limits in gap 2. Treat a booking key as public. An admin can rotate the key or turn online booking off in the venue settings. The proof of work and the signed challenge slow bots down. They do not stop a determined one.

## Checklist before the first real venue

- [ ] `.env.prod` has a random `BETTER_AUTH_SECRET`, `BLOCKLIST_KEY` and `POSTGRES_PASSWORD`, mode 600, not in git.
- [ ] If you serve guests: `WIDGET_ADDRESS` is a real domain, not the staff host, and `https://your-widget-domain/w/BOOKING_KEY` loads. `PUBLIC_CHALLENGE_SECRET` is at least 32 random characters, and `PUBLIC_POW_DIFFICULTY` is unset or above `0`. If you do not serve guests, `WIDGET_ADDRESS` is unset.
- [ ] `curl -I https://your-widget-domain/` answers `404`, and `curl -I https://your-domain/w/BOOKING_KEY` on the staff host answers `404`.
- [ ] `SITE_ADDRESS` and `PUBLIC_URL` use your real domain, and `https://` loads with a valid certificate.
- [ ] `oc ps` shows only `web` with published ports, and all three services report `healthy`.
- [ ] `curl -I https://your-domain/` shows the headers listed under Security headers, and `curl https://your-domain/health` returns `{"ok":true,"service":"opencovers"}`.
- [ ] `oc exec api printenv TRUST_PROXY` prints `true`, and 31 wrong sign-ins from one machine to `/api/auth/sign-in/email` end in `429` with a `Retry-After` header. Wait 15 minutes before you sign in yourself.
- [ ] `SIGNUP` is `first-user` or `closed` (check `oc exec api printenv SIGNUP`), you registered your own account before publishing the address, you know how you will add staff, and you know which account is the owner who can create venues.
- [ ] A backup ran, the dump left the machine, and you restored it on a spare machine.
- [ ] `WEBHOOK_ALLOW_INSECURE` is unset.
- [ ] Each agent key has the lowest role it needs and a named `principal`.
- [ ] The venue's retention period is set and the guest consent text is reviewed with your legal advisor.
