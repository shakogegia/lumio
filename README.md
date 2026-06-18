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

## Deployment

In production Lumio runs the same image as two containers (`web` + `worker`)
plus Postgres, via [`infra/docker-compose.prod.yml`](infra/docker-compose.prod.yml).

- **Portainer:** follow the **[Portainer deployment guide](docs/deployment/portainer.md)** —
  paste the stack, set a few env vars, deploy.
- **Docker Compose (CLI):** build (or pull) the image, then bring the stack up
  with an absolute `PHOTOS_DIR`:

  ```bash
  make build                                # or: make push DOCKER_REPO=you/lumio
  make up PHOTOS_DIR=/abs/path/to/photos    # PHOTOS_DIR must be an absolute path
  ```

Either way, set the `BETTER_AUTH_*` vars below.

## Authentication

Lumio requires login. Set two env vars (compose reads them from your shell or a
root `.env`):

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` — the **public HTTPS origin** the app is served from
  (e.g. `https://photos.example.com`). Behind a Cloudflare tunnel this MUST be
  the external hostname, or session cookies / CSRF checks will fail
  (`{"code":"INVALID_ORIGIN"}`).

On first launch (no users yet) the app redirects to `/setup` so you can create
the single admin account. After that, account creation is permanently closed
and only `/login` is reachable.

### Cloudflare tunnel
Point your `cloudflared` ingress at the web container:

    ingress:
      - hostname: photos.example.com
        service: http://web:3000
      - service: http_status:404

Then set `BETTER_AUTH_URL=https://photos.example.com`.
