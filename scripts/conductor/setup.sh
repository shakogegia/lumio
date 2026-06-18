#!/usr/bin/env bash
# Conductor "setup" script — prepares a newly created workspace.
# Runs from the workspace directory. Safe to re-run; touches no DB/Docker.
set -euo pipefail

# Keep the repository's root checkout current so new workspaces branch from the
# latest main. Non-fatal if it can't fast-forward (e.g. local-only commits).
if [ -n "${CONDUCTOR_ROOT_PATH:-}" ]; then
  git -C "$CONDUCTOR_ROOT_PATH" fetch --prune origin \
    && git -C "$CONDUCTOR_ROOT_PATH" pull --ff-only || true
fi

# Ensure a workspace-local .env exists so DATABASE_URL, DB_PORT, PHOTOS_DIR and
# CACHE_DIR resolve out of the box. Conductor's "Files to copy" already pulls a
# real .env from the root checkout when one is present; this is the fallback for
# fresh setups (no root .env), seeded from the committed .env.example. We never
# clobber an existing .env.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "setup: created .env from .env.example"
fi

# Auth: ensure a strong, per-workspace BETTER_AUTH_SECRET. The .env may have come
# from the committed .env.example (placeholder) or a copied root .env; if the
# secret is missing or still a "change-me" placeholder, generate a real one.
if ! grep -qE '^BETTER_AUTH_SECRET=' .env || grep -qE '^BETTER_AUTH_SECRET=.*change-me' .env; then
  secret="$(openssl rand -base64 32)"
  grep -v '^BETTER_AUTH_SECRET=' .env > .env.tmp && mv .env.tmp .env
  printf 'BETTER_AUTH_SECRET="%s"\n' "$secret" >> .env
  echo "setup: generated BETTER_AUTH_SECRET"
fi

# Install dependencies and generate the Prisma client so typecheck/build/tests
# work immediately in the fresh workspace.
pnpm install
pnpm --filter @lumio/db run generate
