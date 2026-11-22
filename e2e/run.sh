#!/bin/bash
# `bun run e2e`: Gravoth Online end to end on this machine, no OAuth needed.
#
# 1. Stands up compose.prod.yml (the image, Postgres, Redis, the rules checker built from the game's repository) with
#    e2e/compose.e2e.yml: throwaway secrets, an S3 mock in place of R2, mails logged at debug, http://localhost:3000.
# 2. Writes real saves with the game's own Core (e2e/savegen, in the .NET SDK image) for the rules checker to read: one for
#    the score route, and the online realms (decision 227) with their witnessed board records.
# 3. Runs e2e/saves.e2e.ts (the cloud save: written, read back to the byte, replaced, refused, deleted, never a
#    guest's), e2e/api.e2e.ts (the game's calls: guests and their upgrade, mail links, password reset, verified, pending
#    and flagged records kept off the boards, online realms feeding them, friends, blocks, privacy, the checker and Redis
#    down, deletion, a backup restored into a scratch database, the cloud saves and realms among it), e2e/realm.e2e.ts
#    (decisions 226 and 227: hero builds, player pages, the realm's lease, revisions and one-time transfers, the boards it
#    feeds, the checker down) and e2e/ui.e2e.ts (the website in headless Chrome, built for Cloudflare Pages
#    and served by e2e/pages.ts on :3001, calling the API on :3000 across origins, as gravoth.petarzarkov.com calls
#    gravoth-api in production).
# 4. Takes it all down again, volumes included, unless KEEP=1.
#
#   GAME_REPO=../bloodline KEEP=1 bun run e2e
set -euo pipefail
cd "$(dirname "$0")/.."
GAME_REPO=$(cd "${GAME_REPO:-../bloodline}" && pwd)
TMP=$PWD/e2e/.tmp
PROJECT=gravoth-e2e
[ -f "$GAME_REPO/dotnet/Gravoth.Validator/Dockerfile" ] || { echo "No rules checker in $GAME_REPO (set GAME_REPO to the game's checkout)" >&2; exit 1; }
for port in 3000 3001; do
  if ss -ltn 2>/dev/null | grep -q ":$port "; then echo "Port $port is in use; stop what holds it first" >&2; exit 1; fi
done

# The rules checker's sources, laid out as deploy-pi.sh lays them out on the Pi.
mkdir -p "$TMP/ctx/dotnet" "$TMP/ctx/game/Assets/Gravoth"
X=(--exclude bin --exclude obj --exclude '*.meta')
rsync -a --delete "${X[@]}" "$GAME_REPO/dotnet/Gravoth.Core.Headless/" "$TMP/ctx/dotnet/Gravoth.Core.Headless/"
rsync -a --delete "${X[@]}" "$GAME_REPO/dotnet/Gravoth.Validator/" "$TMP/ctx/dotnet/Gravoth.Validator/"
rsync -a --delete "${X[@]}" "$GAME_REPO/game/Assets/Gravoth/Core/" "$TMP/ctx/game/Assets/Gravoth/Core/"
cp "$GAME_REPO/dotnet/Directory.Build.props" "$TMP/ctx/dotnet/"

# Throwaway secrets for this machine only, made once and never printed.
if [ ! -f "$TMP/local.env" ]; then
  (umask 077 && {
    echo "AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "MINIO_USER=gravoth-e2e"
    echo "MINIO_PASSWORD=$(openssl rand -hex 16)"
    echo "COMMIT_SHA=e2e"
  } > "$TMP/local.env")
fi
grep -q '^VALIDATOR_CONTEXT=' "$TMP/local.env" || echo "VALIDATOR_CONTEXT=$TMP/ctx" >> "$TMP/local.env"
# Local image names, so the run never tags anything as the published GHCR images.
grep -q '^APP_IMAGE=' "$TMP/local.env" || echo "APP_IMAGE=gravoth-web:e2e" >> "$TMP/local.env"
grep -q '^BOARDS_ONLINE_ONLY=' "$TMP/local.env" || echo "BOARDS_ONLINE_ONLY=true" >> "$TMP/local.env"
grep -q '^VALIDATOR_IMAGE=' "$TMP/local.env" || echo "VALIDATOR_IMAGE=gravoth-validator:e2e" >> "$TMP/local.env"

# Real saves: two barbarians for the score route (the other classes start locked), at chart tiers 9 and 3; and the online
# realms (decision 227) with their witnessed board records, uploaded by the API run and the website run.
echo "== saves from the game's Core"
docker run --rm -v "$TMP/ctx:/game:ro" -v "$PWD/e2e/savegen:/gen:ro" -v "$TMP:/out" --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e DOTNET_CLI_HOME=/tmp -e DOTNET_NOLOGO=1 mcr.microsoft.com/dotnet/sdk:10.0 sh -c '
    set -e; mkdir -p /tmp/work/gen
    cp -r /game/dotnet /game/game /tmp/work/
    cp /gen/Program.cs /gen/SaveGen.csproj /tmp/work/gen/
    cd /tmp/work/gen && dotnet run -c Release -v q -- /out \
      save.txt 0 Ashgrove barbarian 58 9 0 0 Wren barbarian 44 3 0 0 \
      + realm-ana.txt 1 Ashgrove barbarian 58 9 70 0 Wren barbarian 44 3 20 0 \
      + realm-ana2.txt 1 Ashgrove barbarian 58 9 70 0 Wren barbarian 44 3 20 0 Drifter barbarian 12 0 0 0 \
      + realm-bo.txt 1 Bodhi barbarian 40 0 90 0 \
      + realm-bo2.txt 1 Bodhi barbarian 40 0 90 0 Drifter barbarian 12 0 0 0 \
      + realm-cy.txt 1 Cyril barbarian 60 0 100 0 \
      + realm-eli.txt 1 Ember barbarian 60 0 60 1' 2>&1 \
  | grep -E '^hero |^best |error' || true
for f in save realm-ana realm-ana2 realm-bo realm-bo2 realm-cy realm-eli; do
  [ -s "$TMP/$f.txt" ] || { echo "the save generator wrote no $f.txt" >&2; exit 1; }
done

COMPOSE=(docker compose -p "$PROJECT" --env-file "$TMP/local.env" -f compose.prod.yml -f e2e/compose.e2e.yml)
[ "${KEEP:-}" = "1" ] || trap '"${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1' EXIT
echo "== the stack"
"${COMPOSE[@]}" up -d --build --wait 2>&1 | grep -E 'Healthy|Error|error' || true
curl -fsS http://localhost:3000/api/health >/dev/null

status=0
echo "== the cloud save, as the game keeps it"
bun e2e/saves.e2e.ts || status=1
echo "== the API, as the game calls it"
bun e2e/api.e2e.ts || status=1
echo "== players' heroes and the online realm, as the game calls them"
bun e2e/realm.e2e.ts || status=1
echo "== the website as Cloudflare Pages serves it, in headless Chrome"
if command -v "${CHROME:-google-chrome}" >/dev/null; then
  (cd apps/web && GRAVOTH_API_BASE=http://localhost:3000 GRAVOTH_WEB_OUT="$TMP/pages" bun run build >/dev/null)
  bun e2e/pages.ts "$TMP/pages" 3001 & PAGES=$!
  sleep 1
  bun e2e/ui.e2e.ts || status=1
  kill "$PAGES" 2>/dev/null || true
else
  echo "skipped: no ${CHROME:-google-chrome}"
fi
[ "${KEEP:-}" = "1" ] && echo "KEEP=1: the stack stays up on http://localhost:3000 (down: ${COMPOSE[*]} down --volumes)"
exit $status
