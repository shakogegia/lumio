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
| `MEDIA_DIR` | ✅ | `/mnt/tank/photos` | Absolute host path to your photo library. Bind-mounted **read-write** at `/media` — this is the root the in-app folder browser is bounded to; you create catalogs (folders at/under it) in the app, and uploads + a catalog's "delete originals" write here. |
| `POSTGRES_PASSWORD` | ▢ recommended | `a-strong-password` | Defaults to `lumio`. Set a real one for anything exposed. |
| `PORT` | ▢ | `3000` | Host port for the web UI (default `3000`). |
| `MAX_UPLOAD_SIZE` | ▢ | `200mb` | Largest photo the upload form accepts. **Include a unit** (`b`/`kb`/`mb`/`gb`) — a bare number is bytes, so `300` means 300 B, not 300 MB. Defaults to `200mb`; changing it only needs a container restart. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ▢ | `http://192.168.1.50:3000,https://box.tailnet.ts.net` | Comma-separated **extra** origins you also reach the app from (LAN IP, Tailscale host). Each must be listed or login is rejected with `INVALID_ORIGIN`. |
| `USE_SECURE_COOKIES` | ▢ | `false` | Defaults to Secure (HTTPS-only) cookies. Set `false` to allow logins over plain HTTP like `http://<lan-ip>:3000`. ⚠️ Drops the Secure flag on **all** origins — only on a trusted LAN/Tailscale-only deployment. |
| `POSTGRES_USER` | ▢ | `lumio` | Defaults to `lumio`. |
| `POSTGRES_DB` | ▢ | `lumio` | Defaults to `lumio`. |

> The container's `MEDIA_ROOT=/media`, `CACHE_DIR=/data/cache`, and
> `TRASH_DIR=/data/trash` are **internal** and already wired up in the compose —
> you don't set them. `cache` holds regenerable renditions and `trash` holds
> trashed originals, both in named volumes and subdivided per catalog. Only
> `MEDIA_DIR` (the host path bind-mounted at `/media`) is yours to set.

A starter `.env`:

```ini
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
BETTER_AUTH_URL=https://photos.example.com
MEDIA_DIR=/mnt/tank/photos
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

Then open the app at `http://<host>:3000` (or your `PORT`). On first launch it
redirects to `/setup`:

1. **Create the admin account** — the single owner login.
2. **Create your first catalog** (required to continue). Give it a name and use
   the built-in **folder browser** to pick the folder it indexes — the browser is
   bounded to `/media` (your `MEDIA_DIR`), so choose `/media` itself or any
   subfolder of it.

Once the catalog exists, the worker scans that folder and ingests your photos in
the background — large libraries take a while. Watch progress with:

```bash
docker compose logs -f worker
```

You can add, switch, and manage more catalogs later: the sidebar logo is a
catalog switcher, and the `/catalogs` page manages them. Each catalog's
upload-folder template lives in its own **Settings**; sound effects are per-user
in your **Profile**.

## Ingest performance

The worker scans each catalog's folder (under `/media`) on startup and whenever files change.

- **Incremental scan:** files already indexed with an unchanged size + mod/time
  (and an intact cache) are skipped, so restarts are near-instant. Only new or
  changed files are (re)processed. Wiping `CACHE_DIR` forces regeneration.
- **Concurrency (polite by default):** new/changed files are processed by a pool
  sized to `INGEST_CONCURRENCY` (default: **half** the worker's visible cores).
  The worker pins `sharp.concurrency(1)` and sizes `UV_THREADPOOL_SIZE` to the
  pool, so total CPU ≈ the pool size — a bulk import uses about half the cores and
  leaves the rest to serve the app + Postgres. It also runs at low OS priority, so
  it yields CPU to web + Postgres rather than competing as an equal. Raise
  `INGEST_CONCURRENCY` on a dedicated box for faster imports; lower it to be gentler.
- **Shared box (e.g. N100):** the worker, web, and db share one machine, and a
  large import is CPU-heavy. To guarantee it can never starve the app, cap the
  worker container's CPUs (uncomment `cpus:` in the compose file) and set
  `INGEST_CONCURRENCY` to match.
- **Measure your hardware:** run `pnpm bench` against your library — it mirrors
  the worker's settings and prints the real per-image cost and speedup curve.

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
- **No photos appear** — check `docker compose logs worker`, and confirm you
  created a catalog in the app pointing at a folder under `/media` that actually
  contains images. Confirm `MEDIA_DIR` is an absolute host path that exists and
  holds your library. It's bind-mounted read-write at `/media` so uploads and a
  catalog's "delete originals" can write there.
- **Uploads fail / `ENOENT` writing under `/media`** — `MEDIA_DIR` must be
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
