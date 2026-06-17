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

# Install dependencies and generate the Prisma client so typecheck/build/tests
# work immediately in the fresh workspace.
pnpm install
pnpm --filter @lumio/db run generate
