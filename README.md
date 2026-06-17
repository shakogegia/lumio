# Lumio (walking skeleton)

Self-hosted photo management — filesystem → worker → Postgres → web grid.

## Prerequisites
- Node 24, pnpm 11, Docker

## Quickstart
```bash
pnpm install
cp .env.example .env       # adjust DB_PORT/DATABASE_URL if 5432 is taken (this repo uses 5433 locally)
pnpm db:up                 # start Postgres
pnpm db:migrate            # apply schema
pnpm seed:photos           # generate sample images into ./photos
pnpm ingest                # scan + ingest into the DB, build thumbnails
pnpm dev                   # start the web app on http://localhost:3000
```

Open http://localhost:3000 → redirects to `/photos`.

## Layout
- `apps/web` — Next.js UI + API (uses `--webpack`; transpiles workspace packages)
- `apps/worker` — ingestion engine (one-shot scan)
- `packages/db` — Prisma schema + client (only DB chokepoint)
- `packages/shared` — framework-agnostic types/enums/Zod

## Env
- `DATABASE_URL` — Postgres connection
- `DB_PORT` — host port for the dev Postgres container (default 5432; 5433 locally)
- `PHOTOS_DIR` — source-of-truth originals (default `./photos`)
- `CACHE_DIR` — regenerable artifacts; thumbnails at `$CACHE_DIR/thumbnails`

## Deferred follow-ups
TanStack Virtual grid · chokidar watching · album/smart-album rule engine ·
HEIC decode · uploads · auth.
