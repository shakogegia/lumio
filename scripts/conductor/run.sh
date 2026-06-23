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

# Mobile dev convenience: pre-fill the Expo app's "Connect" screen with this
# workspace's web URL so you don't retype it. The iOS Simulator reaches the
# host's localhost; the portless .localhost:1355 subdomain can't be TLS-trusted
# from the simulator, so we use the direct port. apps/mobile/.env is gitignored
# and per-workspace; same grep -v / .tmp / mv idempotent pattern as setup.sh.
if [ -f apps/mobile/package.json ]; then
  { [ -f apps/mobile/.env ] && grep -v '^EXPO_PUBLIC_API_URL=' apps/mobile/.env || true; } > apps/mobile/.env.tmp
  printf 'EXPO_PUBLIC_API_URL="http://localhost:%s"\n' "$PORT" >> apps/mobile/.env.tmp
  mv apps/mobile/.env.tmp apps/mobile/.env
  echo "==> wrote apps/mobile/.env EXPO_PUBLIC_API_URL=http://localhost:$PORT"
fi

# Bring up the shared dev Postgres. Idempotent: every workspace shares the one
# Docker Compose project "infra" (host port from .env), so this is a no-op when
# the container is already running. Migrations are applied out-of-band against the
# shared DB (pnpm db:migrate), not here — so a destructive schema change is a
# deliberate, coordinated step, never an automatic one on dev-server start.
pnpm db:up

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
