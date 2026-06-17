# Lumio — Project Status & Handoff

_Last updated: 2026-06-17. Branch: `gego/-none` (not yet merged to `origin/main`)._

Self-hosted, API-first photo manager (Google Photos / Immich-style MVP). pnpm monorepo:
`apps/web` (Next.js 16 UI + API) · `apps/worker` (ingestion) · `packages/db` (Prisma, the only DB chokepoint) · `packages/shared` (framework-agnostic types/Zod).

## Built so far
- **Walking skeleton** — worker scans `/photos` → Postgres → API → web grid.
- **#1 Virtualized grid + cursor hardening** — TanStack Virtual (uniform square), non-null `sortDate` ordering.
- **#2 chokidar watch mode** — `pnpm watch` (live add/change/unlink); one-shot `ingest` + `POST /api/rescan` intact.
- **Format support** — JXL/HEIC decode via external `djxl`/`sips`; 2048px **display renditions** (`/api/photos/:id/display`) so non-browser formats show on the detail page.
- **#3 Albums + smart-album engine** — regular CRUD, `smartAlbumWhere` evaluator (`last_30_days`, `exif.cameraModel eq`), rule-builder dialog, `/albums`, `/albums/[id]`, `/photo/[id]` membership.

Tests: 46 passing (shared 12, db 9, web 12, worker 13). Web build clean.

## Run it
```bash
pnpm install
cp .env.example .env        # local override: DB_PORT=5433 + matching DATABASE_URL (5432 is taken by another container)
pnpm db:up                  # shared Postgres (compose project "infra", host port from .env)
pnpm db:migrate             # apply schema
pnpm seed:photos            # ⚠️ rm -rf's /photos first — DON'T run if you have real photos there
pnpm ingest                 # scan + ingest + build thumbnails/displays
pnpm dev                    # web on http://localhost:3000 (uses next dev --webpack)
pnpm watch                  # (optional) live filesystem watcher
```

## Gotchas
- **DB on 5433** via `DB_PORT` in the gitignored `.env`. Scripts load it via `dotenv-cli`.
- **Next 16** uses `--webpack` + a `resolve.extensionAlias` hook (Turbopack can't resolve workspace `.js`→`.ts`).
- **`/photos/` is gitignored** (user data). `pnpm seed:photos` is destructive.
- pnpm native-build approvals live in `pnpm-workspace.yaml` (`onlyBuiltDependencies` + `allowBuilds`).

## What's next
- **#4 Uploads through the pipeline** (web/mobile upload → normalize into `/photos` → reuse `ingestPath`).
- **#5 Productionization** (search/filters, favorite/delete, full `infra/docker-compose.yml` web+worker+db, auth).
- Follow-ups: derive `SmartAlbumRules` from the Zod schema; non-destructive `seed:photos`; optional per-workspace DBs; justified grid; smart-album rule editing.

## Resuming in a new chat
Open a new chat **in this Conductor workspace** (continues on `gego/-none` with all commits, your `.env`, and `/photos`). Say e.g. _"Continue Lumio — do #4 uploads"_ or _"read `docs/superpowers/plans/` and pick up where we left off."_ Design docs: `docs/superpowers/specs/` + `docs/superpowers/plans/`.
