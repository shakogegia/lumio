# Portainer deployment guide + prod compose simplification — design

**Date:** 2026-06-18
**Status:** approved (design), pending spec review

## Goal

Make Lumio easy to self-host via Portainer. Two parts:

1. **Simplify `infra/docker-compose.prod.yml`** so it reads cleanly and pastes
   directly into a Portainer Stack (which *pulls* images, never builds).
2. **Add an Immich-style Portainer deployment guide** at
   `docs/deployment/portainer.md`, linked from the README.

The published image `shakogegia/lumio:latest` is assumed public on Docker Hub
(owner runs `make push` after this lands), so the Portainer flow is
"paste compose → set env → deploy", pulling that image.

## Part 1 — Simplify `infra/docker-compose.prod.yml`

Current file uses YAML anchors, a `build:` block, and relative bind mounts
resolved against `infra/`. Changes:

| Change | From | To | Rationale |
|---|---|---|---|
| Remove YAML anchors | `x-db-url`, `x-lumio`, `<<:` merges | each service inlined, self-contained | Readability; clean paste into Portainer's web editor |
| Remove `build:` block | `build: { context: .., dockerfile: Dockerfile }` | `image: shakogegia/lumio:latest` only (hardcoded — the image is always `shakogegia/lumio`, no env indirection) | Portainer pulls; building stays in the Makefile |
| Cache → named volume | bind mount `${CACHE_DIR:-../cache}` | named volume `cache:` (mounted by web + worker) | Thumbnails are regenerable; removes a fragile relative path and one config knob |
| Photos → required abs path | `${PHOTOS_DIR:-../photos}` | `${PHOTOS_DIR}` (must be absolute) | No surprising relative-path resolution |
| Drop DB host-port publish | `ports: ["${DB_PORT:-5433}:5432"]` | (removed) | web/worker reach Postgres over the compose network; not exposing it is simpler + safer. Doc notes how to re-add. |
| Add `container_name` | (compose-generated `lumio-web-1` etc.) | `lumio-db` / `lumio-web` / `lumio-worker` | Stable, friendly names in Portainer / `docker ps` |

Unchanged: `name: lumio`, `pgdata` named volume, DB healthcheck,
`depends_on: { db: { condition: service_healthy } }`, the web/worker split
(one image, `command: ["web"]` / `["worker"]`), `restart: unless-stopped`,
the in-container env (`PHOTOS_DIR=/data/photos`, `CACHE_DIR=/data/cache`).

Photos mount stays read-only for `web`, read-write for `worker`.

### Resulting shape (web service shown)

```yaml
name: lumio
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-lumio}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-lumio}
      POSTGRES_DB: ${POSTGRES_DB:-lumio}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-lumio} -d ${POSTGRES_DB:-lumio}"]
      interval: 5s
      timeout: 5s
      retries: 10
  web:
    image: shakogegia/lumio:latest
    command: ["web"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-lumio}:${POSTGRES_PASSWORD:-lumio}@db:5432/${POSTGRES_DB:-lumio}?schema=public
      PHOTOS_DIR: /data/photos
      CACHE_DIR: /data/cache
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
    ports: ["${PORT:-3000}:3000"]
    volumes:
      - ${PHOTOS_DIR}:/data/photos:ro
      - cache:/data/cache
  worker:
    image: shakogegia/lumio:latest
    command: ["worker"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-lumio}:${POSTGRES_PASSWORD:-lumio}@db:5432/${POSTGRES_DB:-lumio}?schema=public
      PHOTOS_DIR: /data/photos
      CACHE_DIR: /data/cache
    volumes:
      - ${PHOTOS_DIR}:/data/photos
      - cache:/data/cache
volumes:
  pgdata:
  cache:
```

## Part 2 — Makefile touch-ups

- `up`: command unchanged (`$(COMPOSE) up -d`); now pulls the image instead of
  building (no `build:` block). Comment updated to say so.
- Remove the now-unused `CACHE_DIR` var/export (cache is a named volume; the host
  path is no longer consumed by compose). Keep absolute `PHOTOS_DIR`.
- `clean`: also `docker volume rm lumio_cache` alongside `lumio_pgdata`.
- Header comment trimmed (no more relative-path explanation needed).

## Part 3 — New doc `docs/deployment/portainer.md`

Concise walkthrough (assumes the reader knows Portainer). Sections:

1. **Intro** — one short paragraph: the stack is web + worker + Postgres.
2. **Create the stack** — Stacks → *+ Add stack* → name `lumio` → Web editor →
   paste the contents of `infra/docker-compose.prod.yml` (**linked, not
   inlined**, so there's a single source of truth to keep in sync).
3. **Environment variables** — table of required/optional vars
   (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `POSTGRES_PASSWORD`, `PHOTOS_DIR`;
   optional `PORT`, `POSTGRES_USER`, `POSTGRES_DB`). Show both the Portainer
   env-vars UI and the "Advanced mode" `.env` paste. The `BETTER_AUTH_URL` note
   links to the README auth section (the public-origin / `INVALID_ORIGIN` detail).
4. **Deploy the stack.**
5. **Updating** — Portainer "Pull and redeploy" to grab a new image tag.
6. **Troubleshooting** — `INVALID_ORIGIN`; photos not appearing (check worker
   logs / `PHOTOS_DIR` mount); DB connection; how to re-expose the DB port.

Dropped at the owner's request to keep the guide focused: a Prerequisites
section, first-run `/setup`, reverse-proxy/Cloudflare-tunnel, and "build your
own image". The public-origin requirement survives in the `BETTER_AUTH_URL`
table note (linking the README auth section).

Use a `<details>` block for the optional "Advanced mode" env paste.

## Part 4 — README link

Add a short `## Deployment` section:
- One line → **[Portainer deployment guide](docs/deployment/portainer.md)**.
- One-line CLI alternative: `make up` (with absolute `PHOTOS_DIR`).

Keep it lean; the detail lives in the guide.

## Out of scope

- Publishing the image (owner runs `make push` separately).
- Kubernetes / Docker Swarm / non-Portainer orchestration.
- Changing the dev compose (`infra/docker-compose.yml`) or the Dockerfile.
- Reverse-proxy/TLS setup itself (only referenced, not authored).

## Verification

- `docker compose -f infra/docker-compose.prod.yml config` parses with no
  anchors and the expected env interpolation (set `PHOTOS_DIR` + auth vars).
- Markdown links resolve (README → guide).
- Doc steps match the actual compose (env var names, volume names, ports).
