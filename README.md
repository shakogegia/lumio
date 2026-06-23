# Lumio

Self-hosted photo management — filesystem → worker → Postgres → web grid.

## Prerequisites
- Node 24, pnpm 11, Docker

## Quickstart
```bash
pnpm install
cp .env.example .env       # adjust DB_PORT/DATABASE_URL if 5432 is taken (this repo uses 5433 locally)
pnpm db:up                 # start Postgres
pnpm db:migrate            # apply schema
# add photos: upload via the web UI, or drop image files under MEDIA_ROOT (the in-app folder browser's root, ./media locally)
pnpm ingest                # scan + ingest into the DB, build thumbnails
pnpm dev                   # start the web app on http://localhost:3000
```

Open http://localhost:3000 → redirects to `/photos`.

## Deployment

In production Lumio runs the same image as two containers (`web` + `worker`)
plus Postgres, via [`infra/docker-compose.prod.yml`](infra/docker-compose.prod.yml).
You bind-mount your photo library (host `MEDIA_DIR`) at `/media` and then create
one or more **catalogs** in the app — each is a folder at/under `/media`, picked
with the built-in folder browser on first-run setup. Regenerable renditions and
trashed originals live in the named `cache`/`trash` volumes, subdivided per catalog.

- **Portainer:** follow the **[Portainer deployment guide](docs/deployment/portainer.md)** —
  paste the stack, set a few env vars, deploy.
- **Docker Compose (CLI):** follow the **[Docker Compose deployment guide](docs/deployment/docker-compose.md)** —
  download the compose file, set a few env vars in `.env`, `docker compose up -d`.
  From a cloned repo you can instead use the Makefile shortcut:

## Auth model — single-admin by design

Lumio is a **single-admin application**. First-run setup creates one admin account; after
that, signup is hard-closed (`assertSignupAllowed` rejects all further registrations).
There is intentionally no catalog-ownership model — any authenticated session can read
and mutate any catalog. Catalogs are global.

This is a deliberate design choice for a self-hosted, single-user tool. The per-user
ownership model (and the invite/multi-user system that requires it) is roadmap-deferred.
See `apps/web/src/lib/server/with-auth.ts` for the full rationale.
