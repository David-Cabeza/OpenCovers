# Deployment

OpenCovers runs on Cloudflare.

## What goes where

| Part | Where | How |
| --- | --- | --- |
| Site (`apps/site`) | GitHub Pages | Static Vite build at **opencovers.dev** (`.github/workflows/deploy-site.yml`). |
| Staff app (`apps/web`) | Cloudflare Pages | Static Vite build; proxies `/api` and `/v1` to the API. |
| API (`apps/api`) | Cloudflare Workers (planned) or a container | See below. |
| MCP server (`apps/mcp`) | Not deployed | Runs locally, talks to the API over HTTPS. |

## Public site — opencovers.dev

The marketing site is served from GitHub Pages at `opencovers.dev`. The workflow in `.github/workflows/deploy-site.yml` builds `apps/site` and publishes `apps/site/dist` on every push to `main`. The `CNAME` file in `apps/site/public/` pins the custom domain.

DNS at the registrar (apex domain, `.dev` forces HTTPS):

- `opencovers.dev` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (A records)
- `www.opencovers.dev` → `David-Cabeza.github.io` (CNAME)

GitHub issues the HTTPS certificate automatically once the custom domain is verified in **Settings → Pages**.

## Frontends — Cloudflare Pages

The site ships on GitHub Pages (see above); Cloudflare Pages is the alternative host for it, and the host for the staff app.

```sh
pnpm --filter @opencovers/site build   # → apps/site/dist
pnpm --filter @opencovers/web build    # → apps/web/dist
wrangler pages deploy apps/site/dist
wrangler pages deploy apps/web/dist
```

The staff app calls `/api/*` (Better Auth) and `/v1/*` (the API) relative to its own origin. On Pages, add a rewrite or a Pages Function that forwards those two paths to the API origin, and add the staff app's origin to `TRUSTED_ORIGINS` on the API.

## API

The API is Node.js + `pg` + Better Auth today, which does not run on Cloudflare Workers as-is. Two options:

1. **Cloudflare Workers + Hyperdrive + Postgres** (Cloudflare-native). Requires porting the database layer from the `pg` driver to a Worker-compatible one (Drizzle over Hyperdrive), plus serving the Hono app as a Worker instead of `@hono/node-server`. This keeps the PostgreSQL decision and moves everything onto Cloudflare.
2. **Keep the Node.js API on a container or VPS** and put it behind Cloudflare for DNS and proxying. The `apps/api/Dockerfile` is ready for this; it applies migrations on boot.

Option 1 is the Cloudflare-native path and is the recommended next step. It is a code change, not just configuration.

## Environment

The API reads these variables regardless of host:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://…` connection string. |
| `BETTER_AUTH_SECRET` | yes | `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public base URL of the API. |
| `TRUSTED_ORIGINS` | yes | Comma-separated origins allowed to call auth (the staff app origin). |
