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
# fresh setups (no root .env), initialized from the committed .env.example. We never
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
  # `|| true`: grep -v exits 1 if it filters out every line (a .env containing
  # only the secret) — harmless here, but it would trip `set -e`.
  grep -v '^BETTER_AUTH_SECRET=' .env > .env.tmp || true
  mv .env.tmp .env
  printf 'BETTER_AUTH_SECRET="%s"\n' "$secret" >> .env
  echo "setup: generated BETTER_AUTH_SECRET"
fi

# Shared media: point MEDIA_ROOT/CACHE_DIR/TRASH_DIR at the root checkout's data/
# dir so every workspace browses + reads/writes one media tree + cache + trash on
# disk. MEDIA_ROOT bounds the in-app folder browser; catalogs are folders under it
# (e.g. data/photos), so a workspace's catalog can target the shared photos. Only
# under Conductor; manual/CI runs keep the workspace-local ./media|./cache|./trash.
# Derived, not user-authored, so we always overwrite (idempotent; the grep also
# drops any legacy PHOTOS_DIR). Same grep -v / .env.tmp / mv pattern as above.
if [ -n "${CONDUCTOR_ROOT_PATH:-}" ]; then
  data_root="$CONDUCTOR_ROOT_PATH/data"
  mkdir -p "$data_root/photos" "$data_root/cache" "$data_root/trash"
  grep -vE '^(PHOTOS_DIR|MEDIA_ROOT|CACHE_DIR|TRASH_DIR)=' .env > .env.tmp || true
  { printf 'MEDIA_ROOT="%s"\n' "$data_root"
    printf 'CACHE_DIR="%s"\n'  "$data_root/cache"
    printf 'TRASH_DIR="%s"\n'  "$data_root/trash"; } >> .env.tmp
  mv .env.tmp .env
  echo "setup: pointed MEDIA_ROOT/CACHE_DIR/TRASH_DIR at shared $data_root"
fi

# Install dependencies and generate the Prisma client so typecheck/build/tests
# work immediately in the fresh workspace.
pnpm install
pnpm --filter @lumio/db run generate
