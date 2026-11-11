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

Set `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` in `.env.prod`. The stack refuses to start without them. Use only letters and digits in the database password, because it goes inside the database URL. Open `http://localhost` and sign up.

To serve a real domain, set `SITE_ADDRESS=app.example.com` and `PUBLIC_URL=https://app.example.com`. Caddy then gets a certificate on its own. Ports 80 and 443 must reach the machine. Use `HTTP_PORT` and `HTTPS_PORT` to publish other ports.

The API image applies migrations on boot. PostgreSQL is not published to the host.

To use an external PostgreSQL instead, remove the `db` service and its `depends_on` entry, and set `DATABASE_URL` on the `api` service to your connection string.

Without Docker, build the staff app with `pnpm --filter @opencovers/web build`, serve `apps/web/dist` from any static host, and forward `/api/*` and `/v1/*` to the API. Add the staff app's origin to `TRUSTED_ORIGINS`.

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
