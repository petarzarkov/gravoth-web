# Deploying Gravoth Online

One image (`Dockerfile`) holds the API and the website it serves. On the
Raspberry Pi (and later a VPS) `compose.prod.yml` runs it beside Postgres 17,
Redis, the rules checker and the Cloudflare Tunnel. Nothing here deploys by
itself: `./deploy-pi.sh` runs only when the developer asks.

## The stack

| Service       | Container           | What it is                                                                                                  |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `app`         | `gravoth-api`       | This repository's image: the API on :3000 with the website at `/`. Migrations run at boot                   |
| `postgres`    | `gravoth-postgres`  | The database, on the private network only. Its password is set once, when the volume is first made          |
| `redis`       | `gravoth-redis`     | The cache, the rate limit and the WebSocket relay; the app degrades without it                              |
| `validator`   | `gravoth-validator` | The rules checker, built from the game's repository (`dotnet/Gravoth.Validator` and the Core it compiles)   |
| `cloudflared` | `gravoth-tunnel`    | The tunnel (profile `tunnel`): `gravoth-api.petarzarkov.com` → `http://app:3000`. No port is open on the Pi |

The public address serves both halves: `https://gravoth-api.petarzarkov.com/`
is the website, `/api/...` the API the game calls. Mail links and the OAuth
redirect URIs are built from `PUBLIC_URL` (that address by default). To give
the website a nicer address later, point another tunnel hostname at
`http://app:3000`, set `PUBLIC_URL` to it, and add its callback URLs to the
Google and Discord clients.

## On the Pi

```
~/gravoth/web/                     this repository (deploy-pi.sh copies it; .env is never copied)
~/gravoth/web/.env                 the secrets, written by the developer (every name in .env.example)
~/gravoth/dotnet/...               the rules checker's sources, from the game's repository
~/gravoth/game/Assets/Gravoth/Core the Core it compiles
```

`./deploy-pi.sh [--tunnel]` (with `GAME_REPO` pointing at the game's checkout,
default `../bloodline`) copies all of that, then on the Pi runs
`docker compose -f compose.prod.yml up -d --build` in `~/gravoth/web` with the
commit as `COMMIT_SHA`.

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

1. **`~/gravoth/web/.env`** on the Pi (the first deploy copies the existing
   file, which already holds `AUTH_SECRET`, `POSTGRES_PASSWORD`,
   `RESEND_API_KEY` and `MAIL_FROM`). Still to add: `TUNNEL_TOKEN`,
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID` and
   `DISCORD_CLIENT_SECRET`, and the four `R2_*` values. Set
   `POSTGRES_PASSWORD` before the first start: Postgres takes it only when its
   volume is first made.
2. **Cloudflare Tunnel:** remove the `firecracker.petarzarkov.com` and
   `demo.dunx.win` hostnames, add `gravoth-api.petarzarkov.com` →
   `http://app:3000`.
3. **Cloudflare R2:** a bucket (`gravoth-backups`) and an R2 API token with
   Object Read & Write on that bucket only: the account id, key id, secret and
   bucket name are the four `R2_*` lines.
4. **Resend:** add the domain `mail.petarzarkov.com`, put exactly the records
   Resend shows into Cloudflare DNS (DNS only), press Verify, then make a
   Sending-access API key for that domain.
5. **Google:** in the game's existing Google Cloud project (its consent screen
   and both Android clients stay), add `petarzarkov.com` as an authorized
   domain and the `openid`, `email` and `profile` scopes, and create a **Web
   application** OAuth client with the redirect URI
   `https://gravoth-api.petarzarkov.com/api/auth/callback/google`. Its id is
   also the server client id the Android app gives Credential Manager.
6. **Discord:** an application named Gravoth in the Developer Portal, with the
   OAuth2 redirect `https://gravoth-api.petarzarkov.com/api/auth/callback/discord`.
7. **Deploy** when ready (`./deploy-pi.sh --tunnel`), then, after the first
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

## CI

`.github/workflows/ci.yml`, one job per push to `main` or pull request: lint,
format, types, every suite (the server's against a Postgres service), the
website build, and the image built and booted against that Postgres. It never
pushes an image and never deploys.
