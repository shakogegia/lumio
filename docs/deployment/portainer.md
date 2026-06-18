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
| `PHOTOS_DIR` | ✅ | `/mnt/tank/photos` | Absolute host path to your photo library. Mounted read-write — the app writes uploaded photos here. |
| `POSTGRES_PASSWORD` | ▢ recommended | `a-strong-password` | Defaults to `lumio`. Set a real one for anything exposed. |
| `PORT` | ▢ | `3000` | Host port for the web UI (default `3000`). |
| `MAX_UPLOAD_SIZE` | ▢ | `200mb` | Largest photo the upload form accepts. **Include a unit** (`b`/`kb`/`mb`/`gb`) — a bare number is bytes, so `300` means 300 B, not 300 MB. Defaults to `200mb`; changing it only needs a container restart. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ▢ | `http://192.168.1.50:3000,https://box.tailnet.ts.net` | Comma-separated **extra** origins you also reach the app from (LAN IP, Tailscale host). Each must be listed or login is rejected with `INVALID_ORIGIN`. |
| `USE_SECURE_COOKIES` | ▢ | `false` | Defaults to Secure (HTTPS-only) cookies. Set `false` to allow logins over plain HTTP like `http://<lan-ip>:3000`. ⚠️ Drops the Secure flag on **all** origins — only on a trusted LAN/Tailscale-only deployment. |
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
# MAX_UPLOAD_SIZE=200mb
# Reach the app from extra hosts (LAN IP / Tailscale) — see "Multiple access URLs" below:
# BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.50:3000,https://box.tailnet.ts.net
# USE_SECURE_COOKIES=false
# POSTGRES_USER=lumio
# POSTGRES_DB=lumio
```

</details>

## Multiple access URLs (domain + LAN IP + Tailscale)

You can reach the app from several origins at once. Two things matter:

1. **Trust the origin.** List every URL you load the app from in
   `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated), in addition to
   `BETTER_AUTH_URL`. Otherwise login fails with `INVALID_ORIGIN`.
2. **Cookies vs HTTP.** Session cookies are `Secure` by default and only travel
   over **HTTPS**. So an HTTPS domain and a Tailscale host served over HTTPS
   (`tailscale serve --bg 3000`) work as-is, but a plain `http://<lan-ip>:3000`
   won't keep you logged in until you set `USE_SECURE_COOKIES=false`.

   ⚠️ `USE_SECURE_COOKIES=false` removes the Secure flag on **every** origin,
   including your public HTTPS domain — only enable it on a LAN/Tailscale-only
   deployment. If the app is also on a public domain, prefer reaching the LAN box
   over HTTPS (e.g. its Tailscale name) and leaving Secure cookies on.

Example for domain + LAN IP + Tailscale, accepting plain-HTTP LAN access:

```ini
BETTER_AUTH_URL=https://photos.example.com
BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.50:3000,https://box.tailnet.ts.net
USE_SECURE_COOKIES=false
```

Both of these are read at container **startup**, so changing them only needs a
restart/recreate — no image rebuild.

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
  absolute path that exists on the host and contains images. The directory is
  mounted read-write so the web app can save uploads into it; the worker only
  reads and ingests, it never modifies your existing originals.
- **Uploads fail / `ENOENT` writing to `/data/photos`** — `PHOTOS_DIR` must be
  writable by the container. Check host permissions on that path.
- **Large uploads fail to parse** — raise `MAX_UPLOAD_SIZE` (default `200mb`)
  and restart. If you're behind Cloudflare, note the free plan caps request
  bodies at 100MB regardless of this setting.
- **`web`/`worker` restart-looping** — usually the DB isn't reachable. Confirm
  the `db` container is healthy and that `POSTGRES_*` values match across all
  three services (they share one `DATABASE_URL`).
- **Need to reach Postgres from the host** (e.g. a DB GUI) — the stack does not
  publish the DB port by default. Add a `ports` mapping to the `db` service:

  ```yaml
      ports:
        - "5433:5432"
  ```
