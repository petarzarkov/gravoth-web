#!/bin/bash
# Deploys Gravoth Online to the Raspberry Pi (docs/deploy.md): copies this repository to ~/gravoth/web on the Pi, and the rules
# checker's sources from the game's repository (dotnet/Gravoth.Validator, Gravoth.Core.Headless and the Core it compiles) to
# ~/gravoth beside it, then rebuilds and restarts the Compose stack there. Run it only when the developer asks.
#
#   ./deploy-pi.sh [--tunnel]
#
# GAME_REPO is the game's checkout (default ../bloodline). The tunnel starts only with --tunnel, once
# gravoth-api.petarzarkov.com points at http://app:3000 in Cloudflare. Secrets stay in ~/gravoth/web/.env on the Pi, written by
# the developer; nothing here reads or prints them.
#
# The first run moves the stack off the old layout (bloodline's server/ in ~/gravoth/server, Compose project "server"): it stops
# that stack (its volumes stay) and, when ~/gravoth/web/.env does not exist yet, copies ~/gravoth/server/.env there on the Pi.
set -euo pipefail
cd "$(dirname "$0")"
GAME_REPO=${GAME_REPO:-../bloodline}
KEY=${PI_KEY:-$HOME/.ssh/id_dunx_demo}; HOST=${PI_HOST:-PiLocal}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=60 -o IdentityAgent=none -o IdentitiesOnly=yes -i $KEY"

[ -f "$GAME_REPO/dotnet/Gravoth.Validator/Dockerfile" ] || { echo "No rules checker in $GAME_REPO (set GAME_REPO to the game's checkout)" >&2; exit 1; }

sync() { rsync -az --delete --exclude node_modules --exclude .env --exclude dist --exclude bin --exclude obj --exclude '*.meta' -e "$SSH" "$1/" "$HOST:$2/"; }

$SSH "$HOST" 'mkdir -p ~/gravoth/web ~/gravoth/dotnet ~/gravoth/game/Assets/Gravoth/Core'
rsync -az --delete --exclude node_modules --exclude .env --exclude dist --exclude coverage --exclude .tmp --exclude .git -e "$SSH" ./ "$HOST:gravoth/web/"
sync "$GAME_REPO/dotnet/Gravoth.Core.Headless" gravoth/dotnet/Gravoth.Core.Headless
sync "$GAME_REPO/dotnet/Gravoth.Validator" gravoth/dotnet/Gravoth.Validator
sync "$GAME_REPO/game/Assets/Gravoth/Core" gravoth/game/Assets/Gravoth/Core
rsync -az -e "$SSH" "$GAME_REPO/dotnet/Directory.Build.props" "$HOST:gravoth/dotnet/"

PROFILE=""; [ "${1:-}" = "--tunnel" ] && PROFILE="--profile tunnel"
COMMIT=$(git rev-parse --short HEAD)
$SSH "$HOST" "set -e
  cd ~/gravoth
  if [ ! -f web/.env ] && [ -f server/.env ]; then cp -p server/.env web/.env && echo 'moved the settings: server/.env copied to web/.env'; fi
  [ -f web/.env ] || { echo 'No ~/gravoth/web/.env on the Pi: the developer writes it first (every name in .env.example)' >&2; exit 1; }
  if [ -f server/compose.prod.yml ] && docker compose -p server -f server/compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    docker compose -p server -f server/compose.prod.yml --profile tunnel down && echo 'stopped the old stack (project server; volumes kept)'
  fi
  cd web && COMMIT_SHA=$COMMIT docker compose -f compose.prod.yml $PROFILE up -d --build --remove-orphans
  docker image prune -f >/dev/null
  docker ps --format '{{.Names}}\t{{.Status}}'"
