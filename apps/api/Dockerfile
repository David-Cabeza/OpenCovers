FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @opencovers/api --frozen-lockfile

COPY apps/api apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
