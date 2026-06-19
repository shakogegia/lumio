# Conductor shared photos & cache + seed removal — design

**Date:** 2026-06-19
**Status:** Approved (ready for implementation plan)

## Problem

Every Conductor workspace already shares one Postgres (a single Docker Compose
project `infra`, host port from `.env`). But `PHOTOS_DIR` and `CACHE_DIR` default
to the workspace-relative `./photos` and `./cache`, so each workspace keeps its
own originals and regenerable cache. A photo uploaded in one workspace is invisible
in another even though they read the same database — the DB rows reference files
that only exist in the workspace that created them.

Goal: make the photo library and cache **shared across workspaces**, the same way
the database is, anchored at the original repo checkout.

Separately: the synthetic photo seeder (`seed:photos`) is no longer wanted — the
workflow is to upload photos through the web UI. It is also actively dangerous
once photos are shared, because it does `rm -rf $PHOTOS_DIR`. Remove it entirely.

## Part 1 — Shared photos & cache

### Key insight: no application code changes

Both consumers resolve the dirs the same way:

- `apps/web/src/lib/paths.ts`: `path.resolve(ROOT, process.env.PHOTOS_DIR ?? "./photos")`
- `apps/worker/src/config.ts`: `path.resolve(REPO_ROOT, process.env.PHOTOS_DIR ?? "./photos")`

`path.resolve(base, value)` returns `value` unchanged when `value` is absolute.
So feeding an **absolute** `PHOTOS_DIR`/`CACHE_DIR` makes both apps use the shared
location directly. The only change is *what value the env vars carry*.

### Mechanism: setup.sh rewrites the workspace `.env`

`.env` is the single source of truth — `apps/web` runs `dotenv -e ../../.env`, and
the manual worker commands (`pnpm watch`, `pnpm ingest`) do too. Writing the
absolute paths into `.env` (rather than exporting them only in `run.sh`) means the
web dev server *and* every manual CLI command use the shared store.

Add this block to `scripts/conductor/setup.sh`, alongside the existing
`BETTER_AUTH_SECRET` rewrite:

```bash
# Shared media: point PHOTOS_DIR/CACHE_DIR at the root checkout's data/ dir so
# every workspace reads/writes one library + cache (mirrors the shared Postgres).
# Only under Conductor; manual/CI runs keep the workspace-local ./photos|./cache.
if [ -n "${CONDUCTOR_ROOT_PATH:-}" ]; then
  data_root="$CONDUCTOR_ROOT_PATH/data"
  mkdir -p "$data_root/photos" "$data_root/cache"
  grep -vE '^(PHOTOS_DIR|CACHE_DIR)=' .env > .env.tmp || true
  { printf 'PHOTOS_DIR="%s"\n' "$data_root/photos"
    printf 'CACHE_DIR="%s"\n'  "$data_root/cache"; } >> .env.tmp
  mv .env.tmp .env
  echo "setup: pointed PHOTOS_DIR/CACHE_DIR at shared $data_root"
fi
```

- **Anchor:** `CONDUCTOR_ROOT_PATH` (the original repo checkout, e.g.
  `/Users/gego/Developer/lumio`) — already used in `setup.sh` for the git pull.
  Shared root is `$CONDUCTOR_ROOT_PATH/data`, holding `photos/` and `cache/`.
- **Idempotent / safe to re-run:** the two lines are derived, never user-authored,
  so setup recomputes and overwrites them every run. Re-running setup migrates an
  existing workspace onto the shared store. Uses the same `grep -v` / `.env.tmp` /
  `mv` pattern as the existing secret rewrite (handles a `.env` that would otherwise
  trip `set -e`).
- **mkdir -p** creates the shared dirs so the first workspace works out of the box.
  The worker/web create the `thumbnails/`/`displays/` subdirs of cache on demand.
- **Fallback:** when `CONDUCTOR_ROOT_PATH` is unset (CI, plain local runs), the
  block is skipped and `.env` keeps the relative `./photos`/`./cache` defaults —
  current behavior, unchanged.

### `.env.example`

Add a short comment by `PHOTOS_DIR`/`CACHE_DIR` noting that under Conductor,
`setup.sh` rewrites these to an absolute shared path under the root checkout's
`data/` dir. Keep the relative defaults themselves (the non-Conductor default).

### Concurrency / safety

Sharing is safe: cache files are keyed by photo id and regenerable; originals are
content the user drops in. The shared Postgres already coordinates the rows. The
one destructive operation against `PHOTOS_DIR` was the seeder — removed in Part 2.

### No data migration needed

The root checkout currently has no `photos/`, `cache/`, or `data/` and no `.env`
— a clean start. Existing per-workspace photos are not migrated (fresh shared
library); this is acceptable since the data so far is throwaway uploads.

## Part 2 — Remove the seed entirely

`apps/worker/scripts/seed-photos.ts` is the only direct consumer of `sharp` in the
worker, and `exifr` is not imported in the worker at all (both are carried by
`@lumio/ingest` for real ingestion). Removing the seeder lets both drop from the
worker's direct deps.

| File | Change |
|---|---|
| `apps/worker/scripts/seed-photos.ts` | delete; remove the now-empty `scripts/` dir |
| `apps/worker/package.json` | remove `"seed"` script; drop `sharp` + `exifr` from `dependencies` |
| `package.json` (root) | remove `"seed:photos"` |
| `Makefile` | remove the `seed:` target + its comment; drop `seed` from `.PHONY` |
| `Dockerfile` | remove the `seed)` case branch; update the header comment that lists `ingest`, `seed`, `migrate` |
| `README.md` | replace the `pnpm seed:photos` quickstart line with guidance to upload via the web UI (or drop files into `PHOTOS_DIR`) |
| `docs/STATUS.md` | drop the seed references (the destructive-seed warning lines and the "non-destructive `seed:photos`" follow-up) |

Historical plan/spec files under `docs/superpowers/**` are point-in-time records
and stay untouched.

## Verification

1. `pnpm install` updates the lockfile cleanly after dropping `sharp`/`exifr` from
   the worker.
2. `pnpm -r typecheck` and `pnpm -r test` stay green — nothing imports the seeder.
3. `grep -rn seed` returns only historical `docs/superpowers/**` references.
4. Simulate Conductor setup with a temp `CONDUCTOR_ROOT_PATH`: run `setup.sh` and
   confirm `.env` now carries absolute `PHOTOS_DIR`/`CACHE_DIR` and the
   `data/photos` + `data/cache` dirs were created. Re-run to confirm idempotency
   (no duplicate lines).
5. End-to-end: upload a photo in one workspace, confirm it appears in another
   (same shared `data/photos` plus the already-shared Postgres).

## Out of scope

- Migrating existing per-workspace photos into the shared store.
- Per-workspace databases (a separate listed follow-up).
- Any change to the production Docker stack's bind mounts (`Makefile`/
  `docker-compose.prod.yml`) beyond removing the dead `seed` plumbing.
