#!/bin/sh
# Shared container entrypoint.
#
# - Applies any pending Prisma migrations before handing off to the
#   actual process (app / worker). `migrate deploy` is idempotent and safe
#   to run on every boot.
# - Uses `exec` so the child process becomes PID 1 and receives signals
#   (SIGTERM/SIGINT) directly from Docker — important for the graceful
#   shutdown hooks in src/index.ts.
#
# Failures in `migrate deploy` crash the container on purpose: running
# against an un-migrated DB is a silent-corruption risk.

set -eu

echo "[entrypoint] Applying Prisma migrations (migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Migrations up to date. Launching: $*"
exec "$@"
