# Deploying Lumio with Docker Compose

Lumio runs as three containers: `web` and `worker` (both
`shakogegia/lumio:latest`, selected by command) plus a Postgres 16 `db`. You only
need Docker and the compose file — no repo clone, no Makefile. Drop the compose
file in a folder, add a `.env`, and run `docker compose up -d`.

> Prefer a UI? See the [Portainer deployment guide](portainer.md) instead — same
> stack, same env vars.

## Prerequisites

- **Docker Engine** with the **Compose v2** plugin (`docker compose version`).
- An **absolute host path** to your photo library (existing photos, or an empty
  directory you'll upload into).

## 1. Get the compose file

Make a folder and download the production stack into it **as
`docker-compose.yml`** so bare `docker compose` commands just work:

```bash
mkdir -p ~/lumio && cd ~/lumio
curl -L -o docker-compose.yml \
  https://raw.githubusercontent.com/shakogegia/lumio/main/infra/docker-compose.prod.yml
```

## 2. Configure environment variables

Create a `.env` file **in the same folder** as `docker-compose.yml`. Compose
auto-loads it when you run from that folder.

| Variable | Required | Example | Notes |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | `Xy3…` (32+ random bytes) | Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | ✅ | `https://photos.example.com` | The **public HTTPS origin**. Must match how you reach the app or auth fails with `INVALID_ORIGIN` — see the [README auth notes](../../README.md#authentication). |
| `PHOTOS_DIR` | ✅ | `/mnt/tank/photos` | Absolute host path to your photo library. Mounted read-write — the app writes uploaded photos here. |
| `POSTGRES_PASSWORD` | ▢ recommended | `a-strong-password` | Defaults to `lumio`. Set a real one for anything exposed. |
| `PORT` | ▢ | `3000` | Host port for the web UI (default `3000`). |
| `MAX_UPLOAD_SIZE` | ▢ | `200mb` | Largest photo the upload form accepts. **Include a unit** (`b`/`kb`/`mb`/`gb`) — a bare number is bytes, so `300` means 300 B, not 300 MB. Defaults to `200mb`; changing it only needs a container restart. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ▢ | `http://192.168.1.50:3000,https://box.tailnet.ts.net` | Comma-separated **extra** origins you also reach the app from (LAN IP, Tailscale host). Each must be listed or login is rejected with `INVALID_ORIGIN`. |
| `USE_SECURE_COOKIES` | ▢ | `false` | Defaults to Secure (HTTPS-only) cookies. Set `false` to allow logins over plain HTTP like `http://<lan-ip>:3000`. ⚠️ Drops the Secure flag on **all** origins — only on a trusted LAN/Tailscale-only deployment. |
| `POSTGRES_USER` | ▢ | `lumio` | Defaults to `lumio`. |
| `POSTGRES_DB` | ▢ | `lumio` | Defaults to `lumio`. |

A starter `.env`:

```ini
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
BETTER_AUTH_URL=https://photos.example.com
PHOTOS_DIR=/mnt/tank/photos
POSTGRES_PASSWORD=a-strong-password
# Optional:
# PORT=3000
# MAX_UPLOAD_SIZE=200mb
# Reach the app from extra hosts (LAN IP / Tailscale) — see "Multiple access URLs" below:
# BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.50:3000,https://box.tailnet.ts.net
# USE_SECURE_COOKIES=false
# POSTGRES_USER=lumio
# POSTGRES_DB=lumio
```

## Multiple access URLs (domain + LAN IP + Tailscale)

You can reach the app from several origins at once (a public domain, a LAN IP, a
Tailscale host) — list every origin in `BETTER_AUTH_TRUSTED_ORIGINS` and mind the
Secure-cookie rule for plain HTTP. The Portainer guide covers this in detail and
the rules are identical here: see
[Multiple access URLs](portainer.md#multiple-access-urls-domain--lan-ip--tailscale).
Both `BETTER_AUTH_*` and `USE_SECURE_COOKIES` are read at container startup, so
changing them only needs `docker compose up -d` again — no image rebuild.

## 3. Deploy

From the folder containing `docker-compose.yml` and `.env`:

```bash
docker compose up -d
```

Compose pulls `shakogegia/lumio:latest` and starts `db`, `web`, and `worker`. The
`web` and `worker` containers apply database migrations automatically on startup
(advisory-locked, safe to run together).

The worker then scans `PHOTOS_DIR` and ingests your photos in the background —
large libraries take a while. Watch progress with:

```bash
docker compose logs -f worker
```

Then open the app at `http://<host>:3000` (or your `PORT`). On first launch it
redirects to `/setup` to create the single admin account.

## Ingest performance

The worker scans `PHOTOS_DIR` on startup and whenever files change.

- **Incremental scan:** files already indexed with an unchanged size + mod/time
  (and an intact cache) are skipped, so restarts are near-instant. Only new or
  changed files are (re)processed. Wiping `CACHE_DIR` forces regeneration.
- **Concurrency:** new/changed files are processed by a worker pool sized to
  `INGEST_CONCURRENCY` (default: the worker's logical core count). The worker
  automatically sets `UV_THREADPOOL_SIZE` to the same value — Sharp's decode/
  encode runs on that threadpool, so without it throughput plateaus at ~4
  regardless of cores. Set `INGEST_CONCURRENCY` to pin it (e.g. to a CPU limit).
- **Measure your hardware:** run `pnpm bench` against your library to see the
  real per-image cost and the speedup curve on your machine.

## 4. Updating

When a new image is published, pull it and recreate the containers:

```bash
docker compose pull
docker compose up -d
```

Migrations run automatically on the new containers' startup.

## Troubleshooting

- **`{"code":"INVALID_ORIGIN"}` on login** — `BETTER_AUTH_URL` doesn't match the
  origin you're actually loading the app from. Set it to the exact public HTTPS
  hostname (no trailing slash) and run `docker compose up -d` again.
- **No photos appear** — check `docker compose logs worker`. Confirm `PHOTOS_DIR`
  is an absolute path that exists on the host and contains images. The directory
  is mounted read-write so the web app can save uploads into it; the worker only
  reads and ingests, it never modifies your existing originals.
- **Uploads fail / `ENOENT` writing to `/data/photos`** — `PHOTOS_DIR` must be
  writable by the container. Check host permissions on that path.
- **Large uploads fail to parse** — raise `MAX_UPLOAD_SIZE` (default `200mb`) and
  run `docker compose up -d`. If you're behind Cloudflare, note the free plan caps
  request bodies at 100MB regardless of this setting.
- **`web`/`worker` restart-looping** — usually the DB isn't reachable. Check
  `docker compose ps` / `docker compose logs db` and confirm any `POSTGRES_*`
  overrides are consistent (all three services share one `DATABASE_URL`).
- **`.env` not applied** — run `docker compose` from the folder that holds both
  `docker-compose.yml` and `.env`, or pass `--env-file ./.env` explicitly.
  `docker compose config` prints the resolved values so you can confirm.
- **Need to reach Postgres from the host** (e.g. a DB GUI) — the stack does not
  publish the DB port by default. Add a `ports` mapping to the `db` service:

  ```yaml
      ports:
        - "5433:5432"
  ```
