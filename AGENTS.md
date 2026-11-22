# Working in gravoth-web

Gravoth Online: `apps/server` (the API), `apps/web` (the website) and
`packages/contracts` (what both import). `README.md` is the tour,
`docs/architecture.md` how it fits, `docs/deploy.md` how it ships.
`apps/server/AGENTS.md` has the dunx rules that fail at boot when broken.

Run `bun run check` when you are done: lint, format, types and every suite,
what CI runs.

## The developer's rules

- **Never add a `Co-Authored-By` trailer**, or any other co-author attribution,
  to a commit message. Commits are authored by the repository's owner only
  (`.claude/settings.json` and its hook enforce it).
- **One open-issues list.** Everything still to fix or check for Gravoth Online
  lives in the "Open issues" checklist at the top of `docs/status.md` in the
  game's repository (`petarzarkov/bloodline`). Never keep a separate list here.
- **Never handle secret values.** The developer writes `.env` on the Pi and sets
  GitHub secrets. Scripts pass secrets by file or environment and never echo
  them; never print `.env`.
- **The Raspberry Pi** is reached with the developer's key:
  `ssh -o IdentityAgent=none -o IdentitiesOnly=yes -o ConnectTimeout=60 -i ~/.ssh/id_dunx_demo PiLocal`.
  Read-only checks (`uptime`, `docker ps`, logs) are fine. Deploy
  (`./deploy-pi.sh`), restart containers or change `~/gravoth/web/.env` only
  when the developer asks.
- **Commit often, scoped to your own files:** `git commit -m "<area>: <what>" -- <paths>`.
  Push in batches; CI runs on every push to `main`.

## The shape of things

- **Bun only.** Never `npm`, `npx`, `yarn` or `pnpm`. `bunx` to run a tool.
- **ESM, and relative imports carry a `.js` extension** (the file is `.ts`).
- **The contracts are the one place a shape is written down.** A request schema
  (zod) or a response shape the website or the game reads goes in
  `packages/contracts`, and the server imports it from there. Never redeclare
  one in a service or a page.
- **The website imports values only from `@gravoth/contracts/constants`**, and
  everything else with `import type`. `constants.ts` imports nothing, so the
  bundle carries no zod (`contracts.test.ts` holds it to that).
- **The website is served by the API** (`apps/server/src/web/`): same origin, so
  the session is a first-party cookie. `SpaShell` answers `index.html` for the
  paths the site owns, never under `/api` and never for a file; the page's own
  response carries the strict content security policy.
- **The rules checker is the game's** (`dotnet/Gravoth.Validator` in the game's
  repository). The server calls it over HTTP and never re-implements a rule.
- **Migrations are drizzle-kit's** (`bun run db:generate` in `apps/server`);
  never edit a committed one. `0001` is hand-written (the trigger that keeps
  builds immutable). Use `apps/server/src/database/columns.ts`'s `jsonb`, not
  drizzle's: over `Bun.SQL` drizzle's own stores a quoted string.

## Tests

- `packages/contracts` and `apps/web`: `bun test`, nothing running.
- `apps/server`: `bun run test` starts Postgres from `apps/server/compose.yml`
  (project `gravoth-server-test`, port 55432), gives each suite its own
  database, and removes it all. With `TEST_DATABASE_URL` set (CI) it starts
  nothing.
