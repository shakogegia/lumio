#!/usr/bin/env bash
# Conductor "archive" script — runs before a workspace is archived.
#
# Intentionally a no-op for storage. Postgres is SHARED across workspaces (one
# Docker Compose project "infra"), so there is no per-workspace database or
# external resource to tear down. Do NOT `docker compose down` here — it would
# stop the database for every other running workspace.
set -euo pipefail

# Remove this workspace's portless route so archived workspaces don't linger in
# `portless list`. Mirrors the alias registered in run.sh. No-op (and never
# fatal) when portless is absent or the route was never registered.
if command -v portless >/dev/null 2>&1 && [ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]; then
  portless alias --remove "${CONDUCTOR_WORKSPACE_NAME}.lumio" 2>/dev/null || true
fi

exit 0
