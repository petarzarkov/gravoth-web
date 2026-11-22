# Gravoth Online in one image: the API (apps/server) serving the website (apps/web, built here) over the contracts both
# import (packages/contracts). Runs from source, the shape dunx documents: Bun transpiles on the fly and
# `@dunx/transform/preload` (apps/server/bunfig.toml) records constructor types at load time, so the server's folder is
# the WORKDIR. Built on the Raspberry Pi (arm64) by deploy-pi.sh, or anywhere with `docker build .`.
ARG BUN_IMAGE=oven/bun:1.4.5-slim

# The website: every workspace's dependencies, then `bun run build` into apps/web/dist.
FROM ${BUN_IMAGE} AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN cd apps/web && bun run build

# The server's production dependencies only (no React DOM tooling, no TypeScript, no lint).
FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @gravoth/server

FROM ${BUN_IMAGE}
WORKDIR /app
# curl for the healthcheck; the Postgres 17 client (Debian trixie's) for the nightly pg_dump to R2, the same major
# version as the database in compose.prod.yml.
RUN apt-get update && apt-get install -y --no-install-recommends curl postgresql-client && rm -rf /var/lib/apt/lists/*
ARG COMMIT_SHA=dev
ENV NODE_ENV=production TZ=UTC PORT=3000 LOG_FORMAT=json TRUST_PROXY=true COMMIT_SHA=${COMMIT_SHA} \
    WEB_ROOT=/app/apps/web/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
COPY apps/server/package.json apps/server/bunfig.toml apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
# The migrations the app applies at boot (src/database/migrations.ts).
COPY apps/server/drizzle apps/server/drizzle
COPY --from=web /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["bun", "src/main.ts"]
