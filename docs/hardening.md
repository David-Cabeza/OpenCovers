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

Caddy is the only proxy in front of the API. Its `reverse_proxy` directive passes the client address in `X-Forwarded-For`. The API does not read `X-Forwarded-For` or any other forwarded header. It makes no decision from the client address, so there is no trusted proxy setting to configure.

If you put another proxy or CDN in front of Caddy, nothing in OpenCovers depends on the client IP. Be aware that Caddy then sees the proxy's address, not the guest's.

## Authentication and access

- Staff sign in with email and password through Better Auth. Sessions are cookies signed with `BETTER_AUTH_SECRET`.
- Agents and integrations use API keys sent in the `apikey` header. The API stores only the SHA-256 hash of each key.
- Roles are `read`, `write` and `admin`. A `read` key cannot call a write method. Configuration, tables, services, keys, guest merges and the floor plan require `admin`.
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

- Rate limiting on `/v1/*` or on sign-in.
- Request body size limits.
- Security headers such as HSTS or a content security policy. The Caddyfile sets only `encode gzip`.
- Account lockout or two-factor sign-in.

What the code does provide:

- Webhook targets are checked before delivery. Plain `http` and private addresses are rejected unless `WEBHOOK_ALLOW_INSECURE=true`. Never set that variable in production. The API logs a warning at startup when it is on.
- Every write needs an idempotency key, so a retried request does not double-book.
- The database rejects overlapping bookings with an exclusion constraint.
- Retention runs hourly and blanks personal fields on records older than each venue's retention period.

## Known gaps

Close these before you serve real guests, or accept the risk knowingly.

1. **Open sign-up.** Email and password sign-up is enabled and there is no switch to close it. Anyone who can reach the staff app can create an account and a venue of their own. Venue data stays isolated, but the instance is not private. Restrict access at the network layer, for example with Caddy `basic_auth` or an IP allowlist, until the project adds a sign-up control.
2. **No rate limiting in OpenCovers.** Sign-in and the API can be hit as fast as the machine allows. Add limits at your edge (a CDN, a firewall, or a Caddy rate-limit module). The API itself configures none. Better Auth may apply its own defaults to sign-in. This repository does not set or test them.
3. **No security headers.** Add them in a Caddyfile `header` block if you maintain your own copy of `apps/web/Caddyfile`.
4. **No built-in backups.** Backups, restores and off-site copies are your job. The commands above are manual.
5. **Single instance.** Compose runs one API process. There is no high availability and no health check on the `api` or `web` containers. `GET /health` exists in the API, but Caddy does not route it. A request to `/health` through the stack returns the staff app page, not the API answer. Monitor `https://your-domain/` or add a `/health` route to your own Caddyfile.
6. **No audit log of staff sign-ins.** Guest merges keep an audit trail. Sign-ins and key changes do not.
7. **Operator-side items.** Private vulnerability reporting and a monitored code of conduct contact are not code. They are tracked in the roadmap, Phase 0.

## Checklist before the first real venue

- [ ] `.env.prod` has a random `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`, mode 600, not in git.
- [ ] `SITE_ADDRESS` and `PUBLIC_URL` use your real domain, and `https://` loads with a valid certificate.
- [ ] `oc ps` shows only `web` with published ports.
- [ ] Sign-up is restricted at the network layer, or you accept that it is open.
- [ ] A backup ran, the dump left the machine, and you restored it on a spare machine.
- [ ] `WEBHOOK_ALLOW_INSECURE` is unset.
- [ ] Each agent key has the lowest role it needs and a named `principal`.
- [ ] The venue's retention period is set and the guest consent text is reviewed with your legal advisor.
