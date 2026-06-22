#!/usr/bin/env bash
# Conductor "run" script — starts the dev stack for this workspace.
# Runs from the workspace directory. Requires Docker to be running.
set -euo pipefail

# Next.js reads the PORT env var for the dev server. Conductor reserves
# CONDUCTOR_PORT..+9; fall back to 3000 for manual local runs outside Conductor.
# (Passing --port through `pnpm run ... --` collides with the web script's own
# `dotenv -- next` separator, so we set PORT instead.)
export PORT="${CONDUCTOR_PORT:-3000}"

# Better Auth's baseURL / trustedOrigins must match the origin the browser uses,
# or sign-in fails the CSRF/origin check (INVALID_ORIGIN). Behind the portless
# proxy the browser origin is the https subdomain, so that's the baseURL; we also
# trust the direct http://localhost:<port> origin so both access paths work.
# dotenv-cli does NOT override already-exported vars, so these win over .env.
if command -v portless >/dev/null 2>&1 && [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  export BETTER_AUTH_URL="https://${CONDUCTOR_WORKSPACE_NAME}.lumio.localhost:1355"
  export BETTER_AUTH_TRUSTED_ORIGINS="http://localhost:${PORT}"
else
  export BETTER_AUTH_URL="http://localhost:${PORT}"
fi

# Bring up the shared dev Postgres. Idempotent: every workspace shares the one
# Docker Compose project "infra" (host port from .env), so this is a no-op when
# the container is already running.
pnpm db:up

# Per-workspace database (see setup.sh): the multi-catalog schema migration is
# destructive, so each workspace owns a separate DB on the shared Postgres — a
# migrate here can never wipe another running workspace. Create the DB if absent,
# then apply pending migrations. Idempotent (no-op once created + up to date).
# Only under Conductor; manual/CI runs use the .env DATABASE_URL as-is. We talk to
# Postgres via `docker compose exec` so we don't hardcode the container name.
if [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  ws_db="lumio_$(printf '%s' "$CONDUCTOR_WORKSPACE_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_')"
  compose_psql() { docker compose --env-file .env -f infra/docker-compose.yml exec -T db psql -U lumio "$@"; }
  if ! compose_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$ws_db'" | grep -q 1; then
    compose_psql -d postgres -c "CREATE DATABASE \"$ws_db\""
    echo "run: created per-workspace DB $ws_db"
  fi
  pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy
fi

# Register a stable, named URL for this workspace with the shared portless proxy
# (https://<workspace>.lumio.localhost:1355 -> the dev server on $PORT). We only
# add the alias against the already-running proxy; we never start or restart it,
# so other projects sharing the one proxy daemon are unaffected. Skipped when
# portless isn't installed or we're outside Conductor (CI, plain local runs),
# so the dev server still comes up normally. archive.sh removes the alias.
if command -v portless >/dev/null 2>&1 && [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  portless alias "${CONDUCTOR_WORKSPACE_NAME}.lumio" "$PORT" --force || true
  echo "==> Lumio workspace URL: https://${CONDUCTOR_WORKSPACE_NAME}.lumio.localhost:1355"
fi

# Start the Next.js dev server on $PORT. `exec` so Conductor's stop signal goes
# straight to the dev server process.
exec pnpm --filter @lumio/web run dev
