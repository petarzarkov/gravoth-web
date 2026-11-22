# @gravoth/server

Gravoth Online's API, a [dunx](https://github.com/petarzarkov/dunx) app in the
gravoth-web monorepo. Its request and response shapes come from
`@gravoth/contracts` (`packages/contracts`), and it serves the website
(`apps/web`'s build) at `/`. The plan is in the game's repository
(`docs/online-plan.md`).

```bash
bun install
docker compose up -d   # Postgres and Redis for development (compose.yml)
bun run dev            # restarts on a change
bun run start
bun run test           # starts its own Postgres from compose.yml, runs every suite, removes it
bun run typecheck
bun run db:generate    # the next migration, from a schema change (drizzle-kit)
bun run mail:preview   # the mail templates at http://localhost:3035
```

## What is wired up

- **gravoth** - `/api/health` (the Compose healthcheck; says whether Postgres and the rules checker answer) and `/api/meta`, plus the client for `dotnet/Gravoth.Validator`.
- **openapi** - OpenAPI 3.1 from the routes' own schemas, with better-auth's endpoints merged in, and the Swagger UI page at `/api/docs`.
- **http** - CORS for the website, the cross-site request check, request logging, and the WebSocket relay for the chat of step 6.
- **database** - Postgres through `Bun.SQL` (`@dunx/infra/db`'s `SqlOptions`, drizzle). The migrations in `drizzle/` are drizzle-kit's, applied at boot. `DATABASE_URL`, or built from `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`.
- **backup** - `pg_dump` every night at 03:30 UTC, streamed to the Cloudflare R2 bucket in `R2_BUCKET` (`@dunx/infra/files` over `Bun.S3Client`), kept `BACKUP_KEEP_DAYS` days; skipped with a log line while the R2 variables are unset.
- **auth** - better-auth mounted at `/api/auth`: guests, our own email and password accounts, Google (an ID token from Android or a browser redirect) and Discord (a browser redirect), each provider only while its client is set; accounts join by an address both sides have confirmed. `/api/account` is the caller, the sign-in methods, deletion and the mail-link pages.
- **mail** - Resend (`@dunx/infra/email/resend`) from `MAIL_FROM`, with React Email templates in `src/mail/templates` (`@dunx/infra/email/react`): confirm the address, reset the password, the account is deleted, a friend request. No `RESEND_API_KEY`: mails are logged.
- **players / social** - `/api/profile` (the display name and the privacy flags), `/api/friends` (requests by display name, accept, decline, cancel, remove, lists both ways) and `/api/blocks`.
- **heroes / boards** - `/api/heroes` (register a hero, list mine), `/api/builds/:id` (a build card), `/api/leaderboards` (the boards, a board's top with each row's build, `/:key/me` for the caller's rank and neighbours, `?view=friends`, the hardcore twins, `POST /:key/scores`).
- **cache** - Bun.RedisClient and a two-tier Cache in front of it.
- **throttle** - A fixed-window rate limit per caller, with the counter in Redis.
- **web** - the website's build (`WEB_ROOT`, default `apps/web/dist`): `SpaShell` answers its page for the paths it owns, with a strict content security policy, and `StaticFiles` its hashed assets.
- **schedule** - @Cron, @Interval and @OnceOnBoot on Bun.cron, armed at boot.

## Services

- **Postgres** is required: the app does not boot without it (`compose.yml` runs one for development).
- **cache** and **throttle** need Redis or Valkey, and degrade rather than fail without it
- the WebSocket relay needs Redis or Valkey, for multi-node fan-out only
- `/api/health` reports Postgres and the rules checker `down` when they do not answer

## Layout

- `src/main.ts` - exports `createApp`, and serves it when run directly
- `src/app.module.ts` - the root module, importing every feature
- `src/config.ts` - one validation function, flat env in and a shaped object out
- `src/database/` - the schema (one file per area), the `Db` handle, the migration runner; `drizzle/` holds the migrations
- `src/auth/`, `src/players/`, `src/social/`, `src/heroes/`, `src/boards/` - the features
- `src/mail/` - the mailer and its templates; `src/backup/` - the nightly dump
- `src/gravoth/` - health, meta and the validator client
- `src/web/` - the website's page and assets
- `src/http/`, `src/cache/`, `src/throttle/`, `src/schedule/` - the scaffold's infrastructure
- `src/*.test.ts` - the suites; `src/testing/` gives each booted app a Postgres database of its own

## Constructor injection

`bunfig.toml` preloads `@dunx/transform`, which records each class's constructor
parameter types so the container can resolve them. Without that line providers are
built with no arguments and boot fails saying so.

## Deploying

The image (the repository's `Dockerfile`) is this app serving the built
website; `compose.prod.yml` and `deploy-pi.sh` are at the repository's root.
See `docs/deploy.md` there.
