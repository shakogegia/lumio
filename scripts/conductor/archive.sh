#!/usr/bin/env bash
# Conductor "archive" script — runs before a workspace is archived.
#
# Intentionally a no-op. Postgres is SHARED across workspaces (one Docker Compose
# project "infra"), so there is no per-workspace external resource to tear down.
# Do NOT `docker compose down` here — it would stop the database for every other
# running workspace. (If this project moves to per-workspace databases, tear the
# workspace's own container/volume down here instead.)
set -euo pipefail
exit 0
