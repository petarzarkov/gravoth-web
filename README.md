# gravoth-web

Gravoth Online: the server behind the game's accounts, boards, friends and chat, and
the game's website, https://gravoth.petarzarkov.com (the game's page, the
privacy policy, the boards with every record's build, sign-in, friends). A Bun monorepo on
[dunx](https://github.com/petarzarkov/dunx), started from the developer's
[`dunx-template`](https://github.com/petarzarkov/dunx-template) (its lint,
format, hooks and conventions) with the server moved in from the game's
repository.

| Path                 | What it is                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | `@gravoth/server`: the API (better-auth sign-in with email, Google and Discord; profiles, friends with their online status, friend suggestions and blocks; heroes, their builds, titles and player pages; the boards with their path filter; the game's cloud save; the online realm; chat and its moderation; the `bad-words` list for chat, display names and hero names), Postgres, Resend mail, R2 backups |
| `apps/web`           | `@gravoth/web`: the website (React and Mantine on Bun's bundler): the boards with each row's build, build cards, sign-in, the account, friends (online ones with a green dot) with their suggestions and, for the admin role, chat moderation. Deployed to Cloudflare Pages by CI; the API serves a copy too                                                                                                   |
| `packages/contracts` | `@gravoth/contracts`: what both sides agree on: request schemas (zod), response shapes, the boards, hero classes and talent paths, and error codes. `@gravoth/contracts/constants` carries no zod                                                                                                                                                                                                              |
| `docs/`              | `architecture.md` (how it fits), `deploy.md` (the Raspberry Pi, the first move, the setup list, restore)                                                                                                                                                                                                                                                                                                       |

The game itself (Unity, `Gravoth.Core`, the rules checker in
`dotnet/Gravoth.Validator`) lives in its own repository. The product plan and
the decisions are there too: `docs/online-plan.md`, `docs/poc-decisions.md`,
and the one open-issues list at the top of `docs/status.md`.

## Quick start

```bash
bun install
docker compose -f apps/server/compose.yml up -d   # Postgres and Redis for development
bun run dev                                        # the API on http://localhost:3000
bun run build                                      # the website into apps/web/dist; the API now serves it at /
```

For the website with hot reload instead, run the API with the dev server's
origin trusted, and the dev server beside it:

```bash
CORS_ORIGIN=http://localhost:3001 bun run dev      # the API
bun run dev:web                                    # http://localhost:3001, /api passed through to :3000
```

```
http://localhost:3000/                  the website (after bun run build)
http://localhost:3000/api/health        Postgres and the rules checker, up or down
http://localhost:3000/api/docs          Swagger UI over the OpenAPI document
http://localhost:3000/api/openapi.json  the document, better-auth's routes included
```

## Scripts

| Script                    | What it does                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- |
| `bun run check`           | lint, format, types and every suite: what CI runs                               |
| `bun run dev`             | the API, restarting on a change                                                 |
| `bun run dev:web`         | the website with hot reload on :3001                                            |
| `bun run build`           | the website into `apps/web/dist`                                                |
| `bun run typecheck`       | `tsc` over the contracts, the server and the website                            |
| `bun run test`            | contracts, website, then the server (which starts and removes its own Postgres) |
| `bun run lint` / `format` | oxlint and oxfmt, fixing                                                        |

The server's own scripts (`db:generate`, `mail:preview`, `backup:now`, and
`admin:grant` / `admin:revoke <displayName>` for chat's moderator role,
`docs/deploy.md`) are in `apps/server/package.json`.

## End to end, on this machine

```bash
bun run e2e        # GAME_REPO=../bloodline by default; KEEP=1 leaves the stack up on :3000
```

`e2e/run.sh` runs the production stack locally (`compose.prod.yml`, with the
rules checker built from the game's repository) beside an S3 mock in place of
R2, with throwaway secrets and every mail written to the log. It writes real
saves with the game's own Core (`e2e/savegen`: one for the score route, and
online realms with witnessed board records), then drives the API the way the
game does (`e2e/saves.e2e.ts`: the cloud save written, read back to the byte,
replaced and deleted; `e2e/chat.e2e.ts`: two players chatting, the filter, the
flood limit, a report reaching the moderation routes once the script in the app's
container gives the admin role, a mute; `e2e/suggestions.e2e.ts`: friend
suggestions from friends of friends, a neighbour on the pit floor and a chat
partner, their order, a dismissal, a hidden profile and a block;
`e2e/api.e2e.ts`: guests and their upgrade, the confirmation and reset mails'
links, verified, pending and flagged records kept off the boards,
online realms feeding them, friends, blocks, privacy, the rules checker and
Redis down, account deletion, a backup restored into a scratch database;
`e2e/realm.e2e.ts`: hero builds, player pages, the realm's lease, revisions and
one-time transfers (a move retried after a lost answer among them), two phones'
offline heroes, the checker down; `e2e/presence.e2e.ts`: friends' online status
in the list and the conversations, its switch, Redis stopped) and the website in
headless Chrome
(`e2e/ui.e2e.ts`, the player page, the friends page's suggestions and the chat
moderation page too). No OAuth client is needed: Google and Discord are simply
not offered. It needs Docker, Chrome and port 3000 free.

## Deploying

CI/CD is `.github/workflows/ci.yml`: every push and pull request runs the
checks; every push to `main` also publishes the server image to GHCR (amd64
and arm64) and deploys the website to Cloudflare Pages
(gravoth.petarzarkov.com). The server reaches the Raspberry Pi by hand:
`./deploy-pi.sh` pulls the published images there, only when the developer
asks. `compose.prod.yml` runs it with Postgres, Redis, the rules checker (the
game repository's image) and the Cloudflare Tunnel. Everything, the setup list
included, is in `docs/deploy.md`.
