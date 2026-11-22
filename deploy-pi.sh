#!/bin/bash
# Deploys Gravoth Online's server to the Raspberry Pi by hand (docs/deploy.md). Run it only when the developer asks.
#
#   ./deploy-pi.sh [--tunnel] [--build]
#
# By default the Pi pulls the images CI published to GHCR: this repository's (IMAGE_TAG, default `main`, or a commit's
# `sha-<7>`) and the rules checker the game's repository publishes with each release (VALIDATOR_TAG, default `latest`).
# That needs a one-time `docker login ghcr.io` on the Pi with a token that can read packages (the developer's).
# --build builds both on the Pi instead: this repository's source, and the checker from the game's checkout (GAME_REPO,
# default ../bloodline). The tunnel starts only with --tunnel, once gravoth-api.petarzarkov.com points at http://app:3000.
# The website is not here: CI deploys it to Cloudflare Pages.
#
# Secrets stay in ~/gravoth/web/.env on the Pi, written by the developer; nothing here reads or prints them. The first run
# moves the stack off the old layout (bloodline's server/ in ~/gravoth/server, Compose project "server"): it stops that stack
# (its volumes stay) and, when ~/gravoth/web/.env does not exist yet, copies ~/gravoth/server/.env there on the Pi.
set -euo pipefail
cd "$(dirname "$0")"
KEY=${PI_KEY:-$HOME/.ssh/id_dunx_demo}; HOST=${PI_HOST:-PiLocal}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=60 -o IdentityAgent=none -o IdentitiesOnly=yes -i $KEY"
TUNNEL=""; BUILD=""
for arg in "$@"; do
  case $arg in
    --tunnel) TUNNEL="--profile tunnel" ;;
    --build) BUILD=1 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done
IMAGE_TAG=${IMAGE_TAG:-main}; VALIDATOR_TAG=${VALIDATOR_TAG:-latest}
COMMIT=$(git rev-parse --short HEAD)

$SSH "$HOST" 'mkdir -p ~/gravoth/web'
rsync -az --delete --exclude node_modules --exclude .env --exclude dist --exclude coverage --exclude .tmp --exclude .git -e "$SSH" ./ "$HOST:gravoth/web/"

if [ -n "$BUILD" ]; then
  GAME_REPO=${GAME_REPO:-../bloodline}
  [ -f "$GAME_REPO/dotnet/Gravoth.Validator/Dockerfile" ] || { echo "No rules checker in $GAME_REPO (set GAME_REPO to the game's checkout)" >&2; exit 1; }
  sync() { rsync -az --delete --exclude bin --exclude obj --exclude '*.meta' -e "$SSH" "$1/" "$HOST:$2/"; }
  $SSH "$HOST" 'mkdir -p ~/gravoth/dotnet ~/gravoth/game/Assets/Gravoth/Core'
  sync "$GAME_REPO/dotnet/Gravoth.Core.Headless" gravoth/dotnet/Gravoth.Core.Headless
  sync "$GAME_REPO/dotnet/Gravoth.Validator" gravoth/dotnet/Gravoth.Validator
  sync "$GAME_REPO/game/Assets/Gravoth/Core" gravoth/game/Assets/Gravoth/Core
  rsync -az -e "$SSH" "$GAME_REPO/dotnet/Directory.Build.props" "$HOST:gravoth/dotnet/"
  UP="COMMIT_SHA=$COMMIT APP_IMAGE=gravoth-web:local VALIDATOR_IMAGE=gravoth-validator:local docker compose -f compose.prod.yml $TUNNEL up -d --build --remove-orphans"
else
  IMAGES="APP_IMAGE=ghcr.io/petarzarkov/gravoth-web:$IMAGE_TAG VALIDATOR_IMAGE=ghcr.io/petarzarkov/gravoth-validator:$VALIDATOR_TAG"
  UP="export $IMAGES && docker compose -f compose.prod.yml $TUNNEL pull --quiet && docker compose -f compose.prod.yml $TUNNEL up -d --no-build --remove-orphans"
fi

$SSH "$HOST" "set -e
  cd ~/gravoth
  if [ ! -f web/.env ] && [ -f server/.env ]; then cp -p server/.env web/.env && echo 'moved the settings: server/.env copied to web/.env'; fi
  [ -f web/.env ] || { echo 'No ~/gravoth/web/.env on the Pi: the developer writes it first (every name in .env.example)' >&2; exit 1; }
  if [ -f server/compose.prod.yml ] && docker compose -p server -f server/compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    docker compose -p server -f server/compose.prod.yml --profile tunnel down && echo 'stopped the old stack (project server; volumes kept)'
  fi
  cd web && $UP
  docker image prune -f >/dev/null
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'"
