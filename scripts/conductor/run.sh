#!/usr/bin/env bash
# Conductor "run" script — starts the dev stack for this workspace.
# Runs from the workspace directory. Requires Docker to be running.
set -euo pipefail

# Next.js reads the PORT env var for the dev server. Conductor reserves
# CONDUCTOR_PORT..+9; fall back to 3000 for manual local runs outside Conductor.
# (Passing --port through `pnpm run ... --` collides with the web script's own
# `dotenv -- next` separator, so we set PORT instead.)
export PORT="${CONDUCTOR_PORT:-3000}"

# Bring up the shared dev Postgres. Idempotent: every workspace shares the one
# Docker Compose project "infra" (host port from .env), so this is a no-op when
# the container is already running.
pnpm db:up

# Start the Next.js dev server on $PORT. `exec` so Conductor's stop signal goes
# straight to the dev server process.
exec pnpm --filter @lumio/web run dev
