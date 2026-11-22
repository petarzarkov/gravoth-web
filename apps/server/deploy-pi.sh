#!/bin/bash
# Deploys the Gravoth server to the Raspberry Pi (docs/online-plan.md, step 1): copies server/, the validator and the Core sources
# it compiles to ~/gravoth on the Pi, then rebuilds and restarts the Compose stack there. The tunnel starts only with --tunnel, once
# gravoth-api.petarzarkov.com points at it in Cloudflare. Secrets stay in ~/gravoth/server/.env on the Pi, written by the developer.
#   server/deploy-pi.sh [--tunnel]
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=${PI_KEY:-$HOME/.ssh/id_dunx_demo}; HOST=${PI_HOST:-PiLocal}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8 -o IdentityAgent=none -o IdentitiesOnly=yes -i $KEY"
sync() { rsync -az --delete --exclude node_modules --exclude .env --exclude bin --exclude obj --exclude '*.meta' -e "$SSH" "$1/" "$HOST:gravoth/$1/"; }
$SSH "$HOST" 'mkdir -p ~/gravoth/server ~/gravoth/dotnet ~/gravoth/game/Assets/Gravoth/Core'
sync server; sync dotnet/Gravoth.Core.Headless; sync dotnet/Gravoth.Validator; sync game/Assets/Gravoth/Core
rsync -az -e "$SSH" dotnet/Directory.Build.props "$HOST:gravoth/dotnet/"
PROFILE=""; [ "${1:-}" = "--tunnel" ] && PROFILE="--profile tunnel"
$SSH "$HOST" "cd ~/gravoth/server && COMMIT_SHA=$(git rev-parse --short HEAD) docker compose -f compose.prod.yml $PROFILE up -d --build --remove-orphans && docker image prune -f >/dev/null && docker ps --format '{{.Names}}\t{{.Status}}'"
