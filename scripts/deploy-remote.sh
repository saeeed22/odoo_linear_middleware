#!/usr/bin/env bash
# Remote-side half of the Deploy-to-Staging workflow.
#
# Executed via: ssh <host> "APP_DIR=<path> bash -s" < scripts/deploy-remote.sh
# Expects a deployment tarball already uploaded to /tmp/middleware-deploy.tar.gz
# and a populated .env already present in $APP_DIR.
#
# Keep this script self-contained and idempotent — any push to main re-runs it.
set -euo pipefail

: "${APP_DIR:?APP_DIR must be exported before invoking this script}"

TARBALL="/tmp/middleware-deploy.tar.gz"

echo "== Preparing ${APP_DIR} =="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Safety: abort if cd landed somewhere unexpected before we touch the tree.
if [ "$(pwd)" != "$APP_DIR" ]; then
  echo "cwd drift detected (pwd=$(pwd), expected=$APP_DIR); aborting" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERROR: .env is missing on the server." >&2
  echo "Create it from .env.example with real staging credentials before the first deploy." >&2
  echo "Example: cp .env.example .env && \${EDITOR:-vi} .env" >&2
  exit 1
fi

echo "== Extracting new release =="
# Wipe everything except server-managed files. Docker named volumes (pgdata,
# redisdata) live under /var/lib/docker and are unaffected by this.
find . -mindepth 1 -maxdepth 1 \
  ! -name '.env' \
  ! -name 'docker-compose.override.yml' \
  -exec rm -rf {} +

tar -xzf "$TARBALL"
rm -f "$TARBALL"

if [ ! -f docker-compose.yml ]; then
  echo "docker-compose.yml missing after extract; aborting" >&2
  exit 1
fi

echo "== Building images =="
docker compose build --progress=plain

echo "== Starting services (health-gated) =="
# --wait blocks until every service with a healthcheck reports healthy and the
# others report started. 240s comfortably covers cold postgres init + the
# Prisma migrate deploy step executed by the entrypoint on first boot.
docker compose up -d --remove-orphans --wait --wait-timeout 240

echo "== Current status =="
docker compose ps

echo "== Recent app + worker logs =="
docker compose logs --tail=40 app worker || true

echo "== Pruning dangling images =="
docker image prune -f >/dev/null

echo "== Deploy complete =="
