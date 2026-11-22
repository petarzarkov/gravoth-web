# The Gravoth API as an image (docs/online-plan.md, step 1). It runs from source, the shape dunx documents: Bun transpiles on the
# fly and `@dunx/transform/preload` (bunfig.toml) records constructor types at load time, so bunfig.toml sits in the WORKDIR.
FROM oven/bun:1.4.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.3-slim
WORKDIR /app
# curl for the healthcheck; the Postgres 17 client (Debian trixie's) for the nightly pg_dump to R2, the same major version as
# the database in compose.prod.yml.
RUN apt-get update && apt-get install -y --no-install-recommends curl postgresql-client && rm -rf /var/lib/apt/lists/*
ARG COMMIT_SHA=dev
ENV NODE_ENV=production TZ=UTC PORT=3000 LOG_FORMAT=json TRUST_PROXY=true COMMIT_SHA=${COMMIT_SHA}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY src ./src
# The migrations the app applies at boot (src/database/migrations.ts).
COPY drizzle ./drizzle
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["bun", "src/main.ts"]
