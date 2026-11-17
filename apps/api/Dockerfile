FROM node:22-slim AS widget

RUN corepack enable
WORKDIR /app

COPY .pnpmfile.cjs pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/widget/package.json apps/widget/package.json

RUN pnpm install --filter @opencovers/widget --frozen-lockfile

COPY apps/widget apps/widget

RUN pnpm --filter @opencovers/widget build

FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY .pnpmfile.cjs pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @opencovers/api --prod --frozen-lockfile

COPY apps/api apps/api
# The API writes the widget page and serves its assets under /w/ (ADR-0017 section 1).
COPY --from=widget /app/apps/widget/dist apps/widget/dist

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
