# Lumio — Walking Skeleton Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Scope:** Thinnest end-to-end vertical slice of the Lumio photo management system.

## Goal

Prove the full Lumio architecture with the smallest end-to-end path: drop image
files into a mounted `/photos` folder, have a worker ingest them (EXIF +
dimensions + thumbnails) into Postgres, and browse them in a Next.js web grid
served entirely through an HTTP API. Each piece stays deliberately simple; the
trickier features (virtualization, live watching, albums logic) are layered on
in named follow-ups.

This is **option B (walking skeleton)** from brainstorming, not the full MVP in
one pass.

## Decisions locked during brainstorming

1. **Scope:** Walking skeleton — thinnest end-to-end path first, then layer on.
2. **Thumbnails:** Stored in a dedicated on-disk directory and served via an API
   route (originals stay untouched in `/photos`).
3. **Test photos:** Synthetic sample images generated via `sharp` (with embedded
   EXIF), committed under `./photos`; mount path configurable via `PHOTOS_DIR`.
4. **Dev Postgres:** Minimal `docker-compose.yml` brought forward now (single
   Postgres service + volume), wired via `DATABASE_URL`.
5. **Worker runtime:** One-shot recursive scan that exits; `POST /api/rescan`
   re-triggers it. `chokidar` watching is the next layer.
6. **Package architecture (Approach 1):** Split `/packages/db` (Prisma owner,
   Node-only) from `/packages/shared` (framework-agnostic types/Zod, no Prisma)
   so a future mobile client can safely import `shared`.

## 1. Monorepo layout & tooling

- **pnpm workspaces** (no Turborepo — unnecessary for MVP; plain workspace
  scripts suffice).
- TypeScript **strict**, shared `tsconfig.base.json`.
- **vitest** for tests across all packages.
- Node 24 (available locally).

```
/apps
  /web        Next.js App Router — UI + API route handlers
  /worker     Node + TS ingestion worker (one-shot scan)
/packages
  /db         Prisma schema + generated client + DTO mappers   (Node-only)
  /shared     framework-agnostic types, Zod schemas, EXIF +
              smart-album rule types                            (no Prisma)
/infra
  docker-compose.yml   Postgres service (dev)
/photos       synthetic sample images (committed; path via PHOTOS_DIR)
/cache        derived/regenerable artifacts root (CACHE_DIR; gitignored)
  /thumbnails   generated thumbnails
```

## 2. Packages

### `/packages/shared`
- DTO types: `Photo`, `Album`, `AlbumPhoto`.
- `PhotoSource` union: `'filesystem' | 'upload'` (extensible for future sources).
- `ExifData` interface (normalized subset: `takenAt`, camera make/model,
  orientation, etc.).
- Smart-album rule types (the JSON rule shape only — no evaluation engine).
- **Zod schemas** for API request params and response envelopes:
  - cursor pagination params (`limit`, `cursor`)
  - `PhotoDTO`, `AlbumDTO`
  - `PhotosPage = { items: PhotoDTO[]; nextCursor: string | null }`
- **Zero Prisma / Next imports** — safe to import anywhere, including future
  mobile.

### `/packages/db`
- Owns `prisma/schema.prisma` and the generated Prisma client.
- Exports a **singleton** Prisma client.
- Exports DTO mappers, e.g. `prismaPhoto → PhotoDTO`.
- The **only** module that touches Postgres — enforces "no client accesses the
  DB directly." Consumed by the worker and the web's server layer.

## 3. Data model (Prisma)

```prisma
model Photo {
  id        String   @id @default(cuid())
  path      String   @unique
  source    String   // 'filesystem' | 'upload'
  takenAt   DateTime?
  width     Int
  height    Int
  hash      String?
  exif      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  albums    AlbumPhoto[]

  @@index([takenAt, id])   // stable cursor ordering
}

model Album {
  id        String   @id @default(cuid())
  name      String
  isSmart   Boolean  @default(false)
  rules     Json?    // smart-album rule JSON; null for regular albums
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  photos    AlbumPhoto[]
}

model AlbumPhoto {
  albumId String
  photoId String
  album   Album @relation(fields: [albumId], references: [id], onDelete: Cascade)
  photo   Photo @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@id([albumId, photoId])
  @@index([photoId])
}
```

- **Thumbnail path is derived** from `id` (`<CACHE_DIR>/thumbnails/<id>.webp`) —
  no column needed.
- Cursor pagination orders by `(takenAt DESC, id DESC)`; the cursor encodes the
  last seen `(takenAt, id)`.

## 4. Ingestion pipeline & worker

The pipeline is built as **trigger-agnostic functions** so a `chokidar` watcher
(or upload handler) can drive it later without rework:

```
IngestionInput (filesystem) → normalize → process → store

  normalize : resolve canonical path within PHOTOS_DIR
  process   : sharp (width/height)
              exifr (takenAt from DateTimeOriginal, camera, orientation, …)
              sharp thumbnail → webp (fit inside THUMBNAIL_MAX constant = 400px)
              sha256 hash of file bytes
  store     : upsert Photo by unique `path`; thumbnail written to
              <CACHE_DIR>/thumbnails/<id>.webp after the row's id is known
```

`IngestionInput` is a discriminated union; the filesystem variant is
`{ source: 'filesystem'; absPath: string }`. Future variants (uploads) add new
cases without touching `process`/`store`.

**Worker entry = one-shot scan:**
1. Recursively walk `PHOTOS_DIR`, filtering to supported extensions
   (`jpg`, `jpeg`, `png`, `webp`; `heic` detected but see caveat).
2. Run each file through the pipeline (per-file try/catch — skip + log on
   failure, continue).
3. **Reconcile deletions:** DB rows whose `path` no longer exists on disk →
   delete row + remove thumbnail file.
4. Print a summary (added / updated / removed / skipped) and exit.

`POST /api/rescan` re-triggers this by spawning the worker process.

> **HEIC caveat:** `sharp` only decodes HEIC when built with libheic, which is
> not guaranteed in this environment. Skeleton samples are jpg/png/webp; HEIC
> files are detected but logged-as-skipped when the runtime cannot decode them.
> Full HEIC support is a named follow-up.

## 5. API + Web UI

### API route handlers (Next.js, Node runtime; validated with shared Zod)
- `GET /api/photos?limit=&cursor=` → `{ items, nextCursor }`, ordered
  `takenAt DESC, id DESC`.
- `GET /api/photos/:id` → full `PhotoDTO` (exif, path, takenAt).
- `GET /api/thumbnails/:id` → streams the webp thumbnail with cache headers.
- `GET /api/photos/:id/original` → streams the original file from `/photos`.
- `POST /api/rescan` → **spawns the worker process** (heavy work stays in the
  worker, per spec) and returns `202 Accepted`.
- `GET /api/albums` → list albums (regular + smart sections).

> Rationale for spawning the worker on rescan: the spec requires that the worker
> handles all heavy processing and forbids Redis/microservices. A spawned
> process is the pragmatic MVP queue; a real job queue is out of scope.

### Pages (App Router)
- `/photos` — responsive thumbnail grid, **cursor-based infinite scroll**
  (IntersectionObserver sentinel), shadcn `Card`, lazy-loaded thumbnails.
- `/photo/[id]` — original image + EXIF / path / takenAt in a shadcn `Sheet`.
- `/albums` — albums list with a separate smart-albums section (likely empty in
  the skeleton).
- `/settings` — `PHOTOS_DIR` info, photo count, indexing status, manual
  **Rescan** button.

### shadcn/ui
Install the spec's component set (Button, Card, Dialog, Sheet, Tabs, Input,
Badge, Dropdown Menu, Tooltip); wire the ones the skeleton actually uses (Card,
Sheet, Button, Badge, Tabs) and keep the rest ready.

### Deliberate, reversible deviations (flagged & approved)
1. **Grid is not yet virtualized.** Per the walking-skeleton choice, the grid
   uses simple infinite scroll now. **TanStack Virtual is follow-up #1** (the
   spec mandates it).
2. **Thumbnails use lazy `<img>`** on pre-sized webp rather than `next/image`;
   `next/image` is reserved for originals on the detail page. Trivial to switch
   to follow the spec literally.

## 6. Error handling

- **Worker:** per-file try/catch → skip + log, continue; final summary counts.
  Unsupported/undecodable formats logged as skipped.
- **API:** Zod validation failure → `400`; missing resource → `404`; otherwise
  `500` with a safe message. Invalid cursor → `400`. Missing thumbnail/original
  file → `404`.

## 7. Testing (TDD)

`vitest` per package:
- **shared:** Zod schema validation, cursor encode/decode round-trip, EXIF
  normalization mapping.
- **db:** `prismaPhoto → PhotoDTO` mapping.
- **worker:** pipeline against generated sample images (correct dims, EXIF
  `takenAt`, thumbnail produced); deletion reconciliation removes row +
  thumbnail.
- **web:** API route handlers — pagination returns correct `nextCursor`, honors
  `limit`, `404` on missing id, `400` on bad params.

## 8. Dev environment & sample data

- `infra/docker-compose.yml`: `postgres:16` service + named volume, port 5432.
- `.env.example`:
  - `DATABASE_URL=postgresql://lumio:lumio@localhost:5432/lumio`
  - `PHOTOS_DIR=./photos`
  - `CACHE_DIR=./cache`  (thumbnails live at `${CACHE_DIR}/thumbnails`)
  - (thumbnail size is a code constant `THUMBNAIL_MAX = 400`, not an env var —
    it's a build-time decision, since changing it requires regenerating the
    whole thumbnail cache)
- Root scripts:
  - `db:up` → `docker compose -f infra/docker-compose.yml up -d`
  - `db:migrate` → `prisma migrate dev` (in `/packages/db`)
  - `seed:photos` → generate ~12 synthetic images with embedded EXIF into
    `./photos`
  - `ingest` → run worker one-shot scan
  - `dev` → run the Next.js web app
- README quickstart documenting the above order.

## 9. Explicitly deferred (named follow-ups, in order)

1. **TanStack Virtual** virtualization of the grid (spec-mandated).
2. **chokidar** live watching (add / remove / change).
3. Albums CRUD + **smart-album rule evaluation** engine.
4. **HEIC** decode support (libheic-enabled sharp).
5. Web / mobile **uploads** through the same ingestion pipeline.
6. **Auth / multi-tenant**.

## Non-goals (per spec "DO NOT")

- No Redis, no microservices.
- No full smart-album rule engine yet (store JSON only).
- No loading full datasets into the UI.
- No breaking the ingestion pipeline abstraction.
- No overengineering.
