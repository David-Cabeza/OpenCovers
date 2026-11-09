# Deployment

OpenCovers is three deployables:

- **API** — Node.js + Hono, needs PostgreSQL. Deployed as a Docker image (`apps/api/Dockerfile`).
- **Staff app** (`apps/web`) and **site** (`apps/site`) — static Vite builds, any static host.
- **MCP server** — not deployed; it runs locally and talks to the API over HTTP.

## What you need

- A PostgreSQL instance (managed or self-hosted).
- A Node.js host for the API (Railway, Fly, Render, a VPS, …).
- A static host for the two frontends (or serve them from the API — see below).

## Environment

The API reads these variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://…` connection string. |
| `BETTER_AUTH_SECRET` | yes | Generate with `openssl rand -base64 32`. Never use the dev default. |
| `BETTER_AUTH_URL` | yes | The public base URL of the API, e.g. `https://api.example.com`. |
| `TRUSTED_ORIGINS` | yes | Comma-separated origins that may call auth (the deployed staff app origin). |
| `PORT` | no | Defaults to `3000`. |

## Railway

The repo ships `apps/api/Dockerfile` and `railway.json`.

```sh
railway login
railway init          # create or pick a project
railway add --plugin postgresql   # provision Postgres
railway variables --set DATABASE_URL=${{Postgres.DATABASE_URL}}
railway variables --set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
railway variables --set BETTER_AUTH_URL=https://<your-domain>
railway variables --set TRUSTED_ORIGINS=https://<staff-app-domain>
railway up            # build and deploy the API
```

The container runs `pnpm db:migrate` before starting, so the schema is applied on deploy. The healthcheck hits `/health`.

## Any Docker host

```sh
docker build -t opencovers-api -f apps/api/Dockerfile .
docker run -p 3000:3000 \
  -e DATABASE_URL=... \
  -e BETTER_AUTH_SECRET=... \
  -e BETTER_AUTH_URL=... \
  -e TRUSTED_ORIGINS=... \
  opencovers-api
```

## Static frontends

```sh
pnpm --filter @opencovers/web build   # → apps/web/dist
pnpm --filter @opencovers/site build  # → apps/site/dist
```

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, …). Point the staff app's `/api` and `/v1` at the API via a rewrite/proxy, and add the staff app's origin to `TRUSTED_ORIGINS` on the API.

The staff app calls `/api/*` (Better Auth) and `/v1/*` (the API) relative to its own origin, so it works unmodified if served from the same origin as the API or behind a proxy that forwards those two paths.
