#!/usr/bin/env bash
# Conductor "archive" script — runs before a workspace is archived.
#
# Postgres runs as one SHARED Docker Compose project "infra"; NEVER
# `docker compose down` here — it would stop the database for every other running
# workspace. We only tear down THIS workspace's own resources: its portless route
# and its per-workspace database (created in run.sh; see setup.sh).
set -euo pipefail

# Remove this workspace's portless route so archived workspaces don't linger in
# `portless list`. Mirrors the alias registered in run.sh. No-op (and never
# fatal) when portless is absent or the route was never registered.
if command -v portless >/dev/null 2>&1 && [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  portless alias --remove "${CONDUCTOR_WORKSPACE_NAME}.lumio" 2>/dev/null || true
fi

# Drop this workspace's database (per-workspace DBs). Best-effort: terminate any
# lingering connections first, then DROP. The shared Postgres container and every
# other workspace's DB are untouched. All guarded so archiving never fails if
# Docker is down or the DB was never created. The originals on the shared
# MEDIA_ROOT on disk are NOT touched.
if [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  ws_db="lumio_$(printf '%s' "$CONDUCTOR_WORKSPACE_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_')"
  compose_psql() { docker compose --env-file .env -f infra/docker-compose.yml exec -T db psql -U lumio "$@"; }
  compose_psql -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$ws_db' AND pid <> pg_backend_pid();" 2>/dev/null || true
  compose_psql -d postgres -c "DROP DATABASE IF EXISTS \"$ws_db\"" 2>/dev/null || true
fi

exit 0
