FROM node:22-slim AS build

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @opencovers/web --frozen-lockfile

COPY apps/web apps/web

RUN pnpm --filter @opencovers/web build

FROM caddy:2-alpine

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

EXPOSE 80 443
