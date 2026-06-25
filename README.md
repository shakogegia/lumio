# Lumio

**Self-hosted photo management that lives on top of your own files.**

Lumio turns a folder of photos on disk into a fast, searchable, editable library —
without locking your originals inside a proprietary database or moving them somewhere
you can't find them. Point it at a directory, and a background worker watches the
filesystem, indexes every image, and keeps the library in sync as files come and go.
Your originals stay exactly where they are, in the layout you chose, readable by any
other tool. Lumio just adds the index, the thumbnails, and the interface on top.

It's self-hosted: run it on a NAS, home server, or any box you control — a self-hosted
alternative to cloud photo services.

---

## What it does

- **Watches your filesystem.** A worker scans your photo directory and then keeps
  watching it. Drop new files in, move them, or delete them on disk and the library
  reflects the change automatically — no manual re-import step.
- **Organizes without moving your files.** Browse the real folder tree, group photos
  into **albums**, or define **smart albums** that auto-populate from rules (by date,
  camera, lens, and any EXIF field). Originals never get rearranged behind your back.
- **Finds anything by its metadata.** Search and filter on any EXIF field — camera make/model,
  lens, ISO, aperture, focal length, capture date, GPS — through one predicate engine that
  also powers smart albums. Save a search, turn it into an album.
- **Edits non-destructively.** A GPU-accelerated (WebGL2) editor with a Lightroom-style
  panel: exposure, contrast, white balance (Kelvin + tint), tone curves, color, sharpening,
  noise reduction, and grain. What you see is exactly what gets baked — and your original
  file is never touched. Adjustments are stored, not flattened.
- **Imports through the browser.** Drag-and-drop upload with content-hash de-duplication
  (the same photo won't land twice) and a configurable folder template that decides where
  uploads are filed on disk (default `{YYYY}/{YYYY}-{MM}-{DD}/{filename}`).
- **Handles the formats real cameras produce.** JPEG, PNG, WebP, plus JXL and HEIC/HEIF
  via external decoders. Display-resolution renditions are generated so even non-browser
  formats preview instantly, with Display P3 color management end-to-end.
- **Keeps the housekeeping sane.** Favorites, a soft-delete **trash** (restore or purge),
  per-photo and per-catalog storage stats, an activity log, and feature toggles you can
  flip globally or per catalog.
- **Multiple catalogs.** Run several independent libraries (e.g. *Family*, *Work*) from
  one install, each pointing at its own folder under your media root.

---

## How it works

Lumio is a pnpm monorepo with a clean split between the thing that reads your disk and
the thing that serves the UI:

```
apps/web        Next.js 16 (App Router) — the web UI and the API routes
apps/worker     Node ingestion engine — scans, watches, decodes, thumbnails
packages/db     Prisma + Postgres — the single database chokepoint
packages/ingest Shared ingestion pipeline (decode, hash, EXIF, place uploads)
packages/jobs   Background job helpers
packages/shared Framework-agnostic types, enums, and Zod schemas (no Prisma/Next)
```

The flow is one direction: **filesystem → worker → Postgres → web**.

- The **worker** walks your media directory (and then watches it with chokidar). For each
  image it decodes the pixels (sharp, with external `djxl`/`sips` for JXL/HEIC), reads EXIF
  (exifr), computes a sha256 content hash, and generates thumbnail + display renditions into
  a cache directory. The result is written to Postgres.
- **Postgres** (via Prisma) is the only place photo records live, and `packages/db` is the
  only code that talks to it.
- The **web app** reads from that database, serves the renditions, and hosts the editor,
  search, albums, uploads, and settings. Originals are served from — and only ever read
  from — your media directory.

Regenerable data (thumbnails, display renditions) lives in a cache directory; trashed
originals move to a trash directory. Both are separate from your library, so your source
folder stays pristine.

---

## Getting started (local development)

**Prerequisites:** Node 24, pnpm 11, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env        # adjust DATABASE_URL / DB_PORT if 5432 is taken
pnpm db:up                  # start Postgres in Docker
pnpm db:migrate             # apply the schema

# Add photos: drop image files under MEDIA_ROOT (./media by default),
# or upload them through the web UI once it's running.

pnpm ingest                 # scan + index + build thumbnails (one-shot)
pnpm dev                    # web app on http://localhost:3000
```

Open <http://localhost:3000>. On first run you'll create the single admin account, then
pick a folder for your first catalog with the built-in browser.

Want the library to stay in sync while you add and remove files? Run the watcher alongside
the app:

```bash
pnpm watch                  # live filesystem watcher (add / change / delete)
```

### Handy scripts

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `pnpm dev`        | Start the web app (Next.js)                           |
| `pnpm ingest`     | One-shot scan + index + thumbnail build               |
| `pnpm watch`      | Watch the filesystem and ingest changes live          |
| `pnpm db:up`      | Start Postgres in Docker                               |
| `pnpm db:migrate` | Apply database migrations                              |
| `pnpm test`       | Run the test suite across all packages                |

---

## Deployment

For self-hosting in production, Lumio runs as two containers (`web` + `worker`) plus
Postgres. Setup is covered in its own guides so this README can stay focused on the app:

- **[Docker Compose](docs/deployment/docker-compose.md)** — download the compose file, set a
  few env vars, `docker compose up -d`.
- **[Portainer](docs/deployment/portainer.md)** — paste the stack, set env vars, deploy.

---

## Authentication — single-admin by design

Lumio is a **single-admin application**. First-run setup creates one admin account; after
that, signup is closed. There is intentionally no per-catalog ownership model — any
authenticated session can read and manage any catalog. This is a deliberate choice for a
self-hosted, single-user tool; multi-user support is deferred. Auth is handled by
[Better Auth](https://www.better-auth.com/) (email + password, with optional two-factor and
passkeys).

---

## Contributing

Issues and pull requests are welcome. The codebase is TypeScript end-to-end, tested with
Vitest (`pnpm test`), and organized so that all database access flows through `packages/db`
and all shared types through `packages/shared` — keeping the worker and the web app honest
about their boundaries.

## License

No license has been chosen yet — until a `LICENSE` file is added to this repository, all
rights are reserved.
