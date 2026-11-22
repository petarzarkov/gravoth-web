#!/bin/bash
# `bun run e2e`: Gravoth Online end to end on this machine, no OAuth needed.
#
# 1. Stands up compose.prod.yml (the image, Postgres, Redis, the rules checker built from the game's repository) with
#    e2e/compose.e2e.yml: throwaway secrets, an S3 mock in place of R2, mails logged at debug, http://localhost:3000.
# 2. Writes a real save with the game's own Core (e2e/savegen, in the .NET SDK image) for the rules checker to read.
# 3. Runs e2e/api.e2e.ts (the game's calls: guests and their upgrade, mail links, password reset, verified, pending and
#    flagged records, friends, blocks, privacy, the checker and Redis down, deletion, a backup restored into a scratch
#    database) and e2e/ui.e2e.ts (the website in headless Chrome).
# 4. Takes it all down again, volumes included, unless KEEP=1.
#
#   GAME_REPO=../bloodline KEEP=1 bun run e2e
set -euo pipefail
cd "$(dirname "$0")/.."
GAME_REPO=$(cd "${GAME_REPO:-../bloodline}" && pwd)
TMP=$PWD/e2e/.tmp
PROJECT=gravoth-e2e
[ -f "$GAME_REPO/dotnet/Gravoth.Validator/Dockerfile" ] || { echo "No rules checker in $GAME_REPO (set GAME_REPO to the game's checkout)" >&2; exit 1; }
if ss -ltn 2>/dev/null | grep -q ':3000 '; then echo "Port 3000 is in use; stop what holds it first" >&2; exit 1; fi

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

# A real save: two barbarians (the other classes start locked), at chart tiers 9 and 3.
echo "== a save from the game's Core"
docker run --rm -v "$TMP/ctx:/game:ro" -v "$PWD/e2e/savegen:/gen:ro" -v "$TMP:/out" --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e DOTNET_CLI_HOME=/tmp -e DOTNET_NOLOGO=1 mcr.microsoft.com/dotnet/sdk:10.0 sh -c '
    set -e; mkdir -p /tmp/work/gen
    cp -r /game/dotnet /game/game /tmp/work/
    cp /gen/Program.cs /gen/SaveGen.csproj /tmp/work/gen/
    cd /tmp/work/gen && dotnet run -c Release -v q -- Ashgrove barbarian 58 9 Wren barbarian 44 3 > /out/save.txt' 2>&1 \
  | grep -E '^hero |error' || true
[ -s "$TMP/save.txt" ] || { echo "the save generator wrote nothing" >&2; exit 1; }

COMPOSE=(docker compose -p "$PROJECT" --env-file "$TMP/local.env" -f compose.prod.yml -f e2e/compose.e2e.yml)
[ "${KEEP:-}" = "1" ] || trap '"${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1' EXIT
echo "== the stack"
"${COMPOSE[@]}" up -d --build --wait 2>&1 | grep -E 'Healthy|Error|error' || true
curl -fsS http://localhost:3000/api/health >/dev/null

status=0
echo "== the API, as the game calls it"
bun e2e/api.e2e.ts || status=1
echo "== the website, in headless Chrome"
if command -v "${CHROME:-google-chrome}" >/dev/null; then bun e2e/ui.e2e.ts || status=1; else echo "skipped: no ${CHROME:-google-chrome}"; fi
[ "${KEEP:-}" = "1" ] && echo "KEEP=1: the stack stays up on http://localhost:3000 (down: ${COMPOSE[*]} down --volumes)"
exit $status
