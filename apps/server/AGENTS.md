# @gravoth/server

Notes for an agent working in this application, the API of the gravoth-web
monorepo (the repository's `AGENTS.md` has the developer's rules). It is a
[dunx](https://github.com/petarzarkov/dunx) app, scaffolded by
`bunx @dunx/create-app`.

**Shapes come from `@gravoth/contracts`.** A request schema or a response shape
a client reads is declared in `packages/contracts` and imported here; a service
re-exports the type at most. `src/contracts.test.ts` checks that every error
code thrown here is in the contracts' `ERROR_CODES`.

## Commands

```bash
bun install
docker compose up -d   # Postgres and Redis for development
bun run dev            # http://localhost:3000, restarting on a change
bun run start
bun run test           # its own Postgres from compose.yml (port 55432), every suite, then removed
bun run typecheck
bun run db:generate    # a migration from a schema change; never edit a committed one
bun run mail:preview   # the mail templates
bun run admin:grant <displayName>   # chat's moderator role (admin:revoke takes it back)
```

`bun test` alone needs `TEST_DATABASE_URL` (a Postgres the suites may create databases in); `bun run test` sets it.

## Layout

- `src/main.ts` - exports `createApp`, and serves it when run directly
- `src/app.module.ts` - the root module, importing every feature
- `src/config.ts` - one validation function, flat env in and a shaped object out
- `src/gravoth/` - the game's own routes (health, meta) and the validator client
- `src/http/` - http settings, the WebSocket relay, the page query
- `src/database/` - the schema (auth, social, heroes, boards, saves), the `Db` handle, the migration runner, Postgres errors
- `drizzle/` - the migrations (drizzle-kit's; `0001` is hand-written: the trigger that keeps builds immutable)
- `src/auth/` - better-auth and `/api/account`; `src/players/` - profiles, display names, the guest upgrade
- `src/social/` - profile, friends, friend suggestions and their dismissals' clean-up, blocks; `src/heroes/` - heroes, builds and player pages; `src/boards/` - the boards; `src/saves/` - the cloud save; `src/realm/` - the online realm; `src/chat/` - chat, its filter, moderation and retention
- `src/mail/` - the mailer and its React Email templates; `src/backup/` - the nightly dump to R2
- `src/cache/`, `src/throttle/`, `src/schedule/` - the scaffold's infrastructure
- `src/web/` - the website's page (`SpaShell`) and the static options
- `src/*.test.ts` - the suites; `src/testing/` boots the app over a fresh database; `src/test.preload.ts` quiets the logs
- `scripts/test.ts` - what `bun run test` runs; `scripts/admin-role.ts` - `bun run admin:grant|revoke <displayName>` (in the image too); `scripts/backup-now.ts` - a backup now
- `bunfig.toml` - the preload line constructor injection needs

`main.ts`, `app.module.ts` and `config.ts` were generated for the features chosen
at scaffold time; the scaffold's example routes and `*.demo.ts` walkthroughs are
removed, so every route here is one the game or the website uses.

A test imports `createApp` from `./main.js`; the `import.meta.main` block at the
bottom is what stops that starting a server.

## What is wired up

- **gravoth** - `/api/health`, `/api/meta` and the client for `dotnet/Gravoth.Validator`.
- **openapi** - OpenAPI 3.1 from the routes own schemas, plus the Swagger UI page.
- **http** - CORS, the cross-site request check, request logging and error mapping.
- **database** - Postgres through `Bun.SQL` (`@dunx/infra/db`'s `SqlOptions`, drizzle), migrations applied in `onBeforeInit`. drizzle's own `jsonb()` stores a string over `Bun.SQL`; use `database/columns.ts`'s, and its `bytea` for bytes.
- **backup** - `pg_dump` at 03:30 to R2 (`@dunx/infra/files`), skipped with a log line without the R2 variables.
- **guest clean-up** - at 04:15 (`players/guest-cleanup.ts`), deleting guests with no heroes and no use in 30 days (a session's `updated_at`; `GET /api/account` marks a game session used, since better-auth never renews one).
- **chat** - `/api/chat` (decision 228): the global channel and friends' direct messages by polling, the rules, the filter (`chat/chat-filter.ts`, the display names' lists), ten sends a minute per player (counted in Postgres under an advisory lock, since `@Throttle` keys by address), repeats, mutes, blocks, reports; `/api/admin/chat` for the `admin` role (`@Roles('admin')`); `chat/chat-retention.ts` at 04:45 (messages 30 days unless an open report holds them, closed reports 180 days, ended mutes).
- **auth** - better-auth mounted at `/api/auth` (guests, email and password, Google, Discord; its `admin` plugin's `role`), and `/api/account` (the caller with `admin`, the sign-in methods, deletion, the mail-link pages).
- **mail** - Resend with React Email templates; logged without `RESEND_API_KEY`.
- **social, heroes, boards** - `/api/profile`, `/api/friends` (with its suggestions, below), `/api/blocks`, `/api/heroes` (with every hero's build, decision 226), `/api/builds/:id`, `/api/players/:userId`, `/api/leaderboards` (online heroes only, decision 227).
- **realm** - `/api/realm`: the online realm (decision 227), one save of online heroes per account, its one-device lease and revisions; `realm/realm-sync.ts` lands the rules checker's read of each upload on the heroes, builds and boards after the reply.
- **saves** - `/api/saves/me`: the game's cloud save, one copy per account (not a guest's), stored as `bytea` (`database/columns.ts`'s, since drizzle-orm 0.45 has none).
- **friend suggestions** - `GET /api/friends/suggestions` (decision 229, `social/suggestions.service.ts`): up to 20 players from friends of friends, five places either side on the boards (`boards/shown.ts`'s rule), the global chat and, to fill, a session used this week, in one query; 60 an hour; cached five minutes per caller (`SuggestionCache`, dropped by Friends, Blocks and a dismissal). `POST /api/friends/suggestions/:userId/dismiss` (204, 30 days, `suggestion_dismissals`); `social/suggestion-cleanup.ts` at 04:50 deletes the dismissals past 30 days.
- **cache** - Bun.RedisClient and a two-tier Cache in front of it (a caller's friend suggestions).
- **throttle** - A fixed-window rate limit per caller, with the counter in Redis.
- **web** - the website's build at `/` (`src/web/`): the page for the paths it owns, then its hashed assets. Never under `/api`.
- **schedule** - @Cron, @Interval and @OnceOnBoot on Bun.cron, armed at boot.

## Services

Postgres is required: the app does not boot without it. Each of the others reports
itself degraded rather than failing the boot, so the app starts without them.

- **cache** and **throttle** need Redis or Valkey
- the WebSocket relay needs Redis or Valkey, for multi-node fan-out only

## Rules that produce a boot error when broken

- **Constructor injection needs the preload.** Add `preload = ["@dunx/transform/preload"]` to bunfig.toml, and again under `[test]`. It records each class's constructor parameter types at load time. Without it a class with constructor parameters is a boot error naming the preload.
- **No `@Injectable()`, and no `@Inject()`.** Listing a class in a module's `providers` is what makes it injectable. dunx uses TC39 standard decorators, which have no parameter decorators. For a value with no constructor parameter to hang off, use `inject(Token)` in a field initializer.
- **Do not add `reflect-metadata`, `experimentalDecorators` or `emitDecoratorMetadata`.** `@dunx/transform` records the constructor parameter types instead, and it needs none of them. Adding them does not make injection work; removing the preload line breaks it.
- **A constructor parameter whose type is erased fails at boot, naming the parameter.** An interface, a primitive, a union, a class type parameter, or an `import type` at an injection site all record as `unresolved`. Inject a class, and drop `type` from the import.
- **Relative imports carry a .js extension.** `import { UsersService } from './users.service.js'`. The manifest is `"type": "module"` and resolution is nodenext, so an extensionless relative specifier does not resolve.
- **A module's `exports` is its public surface.** The container is scoped per module, so a provider another module injects has to be exported by the module that declares it. Absent `exports` means nothing is exported, and `global: true` publishes them app-wide.
- **`bun` only.** No `npm`, `npx`, `yarn` or `pnpm`. Run tools with `bunx` and scripts with `bun run <script>`.

## Asking the framework instead of grepping it

```bash
bunx @dunx/mcp ./src/app.module.ts
```

An MCP server over stdio. Six tools answer what routes, providers, modules and
gateways exist, and which constructor parameters would fail to resolve; it reads
the module graph and never boots the app. Three more carry the written guide, the
feature catalogue and the rules that fail at boot, so `dunx_guide` answers
"how do I add auth" without a search.

## The framework's own instructions

- <https://dunx.win/setup.md> - installing, wiring and verifying a dunx app
- <https://dunx.win/llms.txt> - every dunx document, as raw markdown
