# Deploying Gravoth Online

Two halves, delivered by `.github/workflows/ci.yml` (decision 220):

- **The website** is static, on the Cloudflare Pages project `gravoth`, behind
  `https://gravoth.petarzarkov.com`. Every push to `main` that passes CI builds
  it for Pages and deploys it. It calls the API at
  `https://gravoth-api.petarzarkov.com` across origins.
- **The server** is one image (`Dockerfile`): CI publishes it to GHCR for
  linux/amd64 and linux/arm64 on every push to `main`. On the Raspberry Pi
  (and later a VPS) `compose.prod.yml` runs it beside Postgres 17, Redis, the
  rules checker and the Cloudflare Tunnel. Deploying it is by hand:
  `./deploy-pi.sh`, only when the developer asks.

## CI/CD

| Job     | When                        | What                                                                                                                         |
| ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `check` | every push and pull request | lint, format, types, every suite (the server's against a Postgres service), both website builds, the image built and booted  |
| `image` | `main`, after `check`       | `ghcr.io/petarzarkov/gravoth-web:main` and `:sha-<7>`, amd64 and arm64, with the run's own token                             |
| `site`  | `main`, after `check`       | the Pages build (`GRAVOTH_API_BASE=$API_ORIGIN`) deployed to `$PAGES_PROJECT`; skipped with a notice until the secrets exist |

The site job needs one repository secret, set by the developer:
`CLOUDFLARE_API_TOKEN` (a token with Cloudflare Pages: Edit). The account id
is the repository variable `CLOUDFLARE_ACCOUNT_ID` (set 2026-11-22; an id, not
a secret). The repository variables `API_ORIGIN` and `PAGES_PROJECT` override
the defaults.

The rules checker's image is the game repository's:
`ghcr.io/petarzarkov/gravoth-validator:<release>` and `:latest`, published by
its `validator.yml` on each `v*` tag, so the server checks saves with the rules
of the game players run. Without the board key the checker reports an online
realm's board records as `unchecked` (their form and plausibility only); given
the key file (`BOARD_KEY_FILE`, mounted read-only into the `validator`
container, never in an image) it verifies each record's witness too.

## The website on Pages

`apps/web/build.ts` with `GRAVOTH_API_BASE` set writes `dist/` for Pages: the
app (`/`, the game's page; `/boards`, `/builds/<id>`, `/sign-in`, `/account`,
`/friends`, `/delete-account`), `/privacy/` (the policy Play links to, a page
of its own), `/terms/` (the terms of service, also a page of its own), the screenshots, and `_headers` (the content security policy
allowing calls to the API only, the other security headers, a year's cache on
the hashed assets). Pages answers any other path with `index.html` (there is no
`404.html`), which is how the app's own paths load.

Sign-in works across the two origins because they are one site
(`petarzarkov.com`): the session cookie is the API's, sent with the site's
credentialed calls, and the API trusts the site (`CORS_ORIGIN`, default
`https://gravoth.petarzarkov.com`, for CORS, the cross-site check and
better-auth). Google and Discord come back to the API
(`https://gravoth-api.petarzarkov.com/api/auth/callback/<provider>`), which
then sends the browser back to the site.

The API still serves its own copy of the site at
`https://gravoth-api.petarzarkov.com/` (same origin), which the end-to-end run
and a Pages outage can fall back on.

## The stack

| Service       | Container           | What it is                                                                                                                    |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app`         | `gravoth-api`       | `APP_IMAGE` (default `ghcr.io/petarzarkov/gravoth-web:main`): the API on :3000 (and its copy of the site). Migrations at boot |
| `postgres`    | `gravoth-postgres`  | The database, on the private network only. Its password is set once, when the volume is first made                            |
| `redis`       | `gravoth-redis`     | The cache, the rate limit and the WebSocket relay; the app degrades without it                                                |
| `validator`   | `gravoth-validator` | `VALIDATOR_IMAGE` (default `ghcr.io/petarzarkov/gravoth-validator:latest`): the rules checker                                 |
| `cloudflared` | `gravoth-tunnel`    | The tunnel (profile `tunnel`): `gravoth-api.petarzarkov.com` → `http://app:3000`. No port is open on the Pi                   |

Mail links and the OAuth redirect URIs are built from `PUBLIC_URL`
(`https://gravoth-api.petarzarkov.com` by default).

## On the Pi

```
~/gravoth/web/                     this repository (deploy-pi.sh copies it; .env is never copied)
~/gravoth/web/.env                 the secrets, written by the developer (every name in .env.example)
~/gravoth/dotnet/..., game/...     the rules checker's sources, only with --build
```

`./deploy-pi.sh [--tunnel]` copies the repository, then on the Pi pulls the
images (`IMAGE_TAG`, default `main`, or a commit's `sha-<7>` from CI's summary;
`VALIDATOR_TAG`, default `latest`) and restarts the stack with them. Pulling
needs a one-time `docker login ghcr.io` on the Pi with a token that can read
the developer's packages.

`./deploy-pi.sh --build` builds both images on the Pi instead: this
repository's source, and the rules checker from the game's checkout
(`GAME_REPO`, default `../bloodline`), copied beside it. That is the way until
the game's next release publishes the checker's first image.

### The first deploy from this repository

Before 2026-11-22 the server lived in the game's repository and ran from
`~/gravoth/server` (Compose project `server`). The first `./deploy-pi.sh` moves
it:

1. When `~/gravoth/web/.env` does not exist, it copies `~/gravoth/server/.env`
   there on the Pi (nothing passes through the machine that runs the script).
2. It stops the old stack (`docker compose -p server ... down`). Its volumes
   stay. The old Redis held only cache, and the old SQLite file is not carried:
   online heroes start fresh, as decided.
3. It builds and starts the new stack under the project name `gravoth`.

`~/gravoth/server` can be deleted once the new stack has run a few days.

## The developer's setup list

Values never go through an agent. Each line names where a value goes.

1. **GitHub:** the secret `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) on
   this repository (`gh secret set CLOUDFLARE_API_TOKEN -R petarzarkov/gravoth-web`;
   the account id is already the variable `CLOUDFLARE_ACCOUNT_ID`). The next
   push to `main` then replaces gravoth.petarzarkov.com with this website. On
   the Pi, once: `docker login ghcr.io` with a token that can read packages.
2. **`~/gravoth/web/.env`** on the Pi (the first deploy copies the existing
   file, which already holds `AUTH_SECRET`, `POSTGRES_PASSWORD`,
   `RESEND_API_KEY` and `MAIL_FROM`). Still to add: `TUNNEL_TOKEN`,
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID` and
   `DISCORD_CLIENT_SECRET`, and the four `R2_*` values. Set
   `POSTGRES_PASSWORD` before the first start: Postgres takes it only when its
   volume is first made.
3. **Cloudflare Tunnel:** done 2026-11-22 (the tunnel `pi-local` routes only
   `gravoth-api.petarzarkov.com` → `http://app:3000`).
4. **Cloudflare R2:** the bucket `gravoth-backups` exists (2026-11-22, Eastern
   Europe); still an R2 API token with Object Read & Write on that bucket only: the account id, key id, secret and
   bucket name are the four `R2_*` lines.
5. **Resend:** add the domain `mail.petarzarkov.com`, put exactly the records
   Resend shows into Cloudflare DNS (DNS only), press Verify, then make a
   Sending-access API key for that domain.
6. **Google:** in the game's existing Google Cloud project (its consent screen
   and both Android clients stay), add `petarzarkov.com` as an authorized
   domain and the `openid`, `email` and `profile` scopes, and create a **Web
   application** OAuth client with the redirect URI
   `https://gravoth-api.petarzarkov.com/api/auth/callback/google`. Its id is
   also the server client id the Android app gives Credential Manager.
7. **Discord:** an application named Gravoth in the Developer Portal, with the
   OAuth2 redirect `https://gravoth-api.petarzarkov.com/api/auth/callback/discord`.
8. **Deploy** when ready (`./deploy-pi.sh --tunnel`), then, after the first
   nightly backup, the restore drill below.

A provider shows on the sign-in page and in the game only while both its
variables are set (`GET /api/account/methods`), so the site works before the
Google and Discord clients exist.

## Backups and the restore drill

Every night at 03:30 UTC the app streams `pg_dump --format=custom` into the R2
bucket as `postgres/gravoth-<time>.dump`, and deletes dumps older than
`BACKUP_KEEP_DAYS` (30). Without the four `R2_*` variables it logs that it
skipped.

The drill need not wait for the night: `docker exec gravoth-api bun scripts/backup-now.ts`
runs the same job at once and prints the key it wrote. `bun run e2e` does the
whole drill on this machine (against an S3 mock, through `R2_ENDPOINT`) and
checks every table comes back with its rows.

To restore (the drill, before launch, into a scratch database first):

```bash
# On the Pi, with the dump downloaded from R2 into ~/restore/gravoth.dump:
docker cp ~/restore/gravoth.dump gravoth-postgres:/tmp/gravoth.dump
docker exec gravoth-postgres createdb -U gravoth gravoth_drill
docker exec gravoth-postgres pg_restore --no-owner -U gravoth -d gravoth_drill /tmp/gravoth.dump
docker exec gravoth-postgres psql -U gravoth -d gravoth_drill -c 'select count(*) from users'
# A real restore over the live database: --clean --if-exists -d gravoth, with the app stopped.
```
