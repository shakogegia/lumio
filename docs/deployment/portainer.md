# Deploying Lumio with Portainer

Lumio runs as a Portainer **Stack** of three containers: `web` and `worker`
(both `shakogegia/lumio:latest`, selected by command) plus a Postgres 16 `db`.
Paste the compose, set a few environment variables, and deploy.

## 1. Create the stack

In Portainer, go to **Stacks → + Add stack** and name it `lumio`. Leave the
build method as **Web editor** and paste in the contents of
[`infra/docker-compose.prod.yml`](../../infra/docker-compose.prod.yml).

## 2. Set environment variables

Portainer does **not** read a `.env` file from the repo — set the variables in
the stack itself. Scroll to **Environment variables** below the editor and add
them, or click **Advanced mode** and paste the block further down.

| Variable | Required | Example | Notes |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | `Xy3…` (32+ random bytes) | Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | ✅ | `https://photos.example.com` | The **public HTTPS origin**. Must match how you reach the app or auth fails with `INVALID_ORIGIN` — see the [README auth notes](../../README.md#authentication). |
| `PHOTOS_DIR` | ✅ | `/mnt/tank/photos` | Absolute host path to your photo library. Mounted read-only into the app. |
| `POSTGRES_PASSWORD` | ▢ recommended | `a-strong-password` | Defaults to `lumio`. Set a real one for anything exposed. |
| `PORT` | ▢ | `3000` | Host port for the web UI (default `3000`). |
| `POSTGRES_USER` | ▢ | `lumio` | Defaults to `lumio`. |
| `POSTGRES_DB` | ▢ | `lumio` | Defaults to `lumio`. |

<details>
<summary><strong>Advanced mode</strong> — paste these as the stack's env vars</summary>

```ini
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
BETTER_AUTH_URL=https://photos.example.com
PHOTOS_DIR=/mnt/tank/photos
POSTGRES_PASSWORD=a-strong-password
# Optional:
# PORT=3000
# POSTGRES_USER=lumio
# POSTGRES_DB=lumio
```

</details>

## 3. Deploy

Click **Deploy the stack**. Portainer pulls `shakogegia/lumio:latest` and starts
`db`, `web`, and `worker`. The `web` and `worker` containers apply database
migrations automatically on startup (advisory-locked, safe to run together).

The worker then scans `PHOTOS_DIR` and ingests your photos in the background —
large libraries take a while; watch the `worker` container logs for progress.

## 4. Updating

When a new image is published, update in place from the stack page:

1. Open the `lumio` stack → **Editor**.
2. Click **Update the stack** and tick **Re-pull image**.
   (Or update individual containers via **Recreate** with *Pull latest image*.)

Migrations run automatically on the new containers' startup.

## Troubleshooting

- **`{"code":"INVALID_ORIGIN"}` on login** — `BETTER_AUTH_URL` doesn't match the
  origin you're actually loading the app from. Set it to the exact public HTTPS
  hostname (no trailing slash) and redeploy.
- **No photos appear** — check the `worker` logs. Confirm `PHOTOS_DIR` is an
  absolute path that exists on the host and contains images; it's mounted
  read-only, so the worker can read but never modifies your originals.
- **`web`/`worker` restart-looping** — usually the DB isn't reachable. Confirm
  the `db` container is healthy and that `POSTGRES_*` values match across all
  three services (they share one `DATABASE_URL`).
- **Need to reach Postgres from the host** (e.g. a DB GUI) — the stack does not
  publish the DB port by default. Add a `ports` mapping to the `db` service:

  ```yaml
      ports:
        - "5433:5432"
  ```
