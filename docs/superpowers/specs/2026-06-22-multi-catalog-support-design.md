# Multi-catalog support — design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Branch:** `gego/multi-catalog-support`

## Goal

Replace Lumio's single implicit library (one global `PHOTOS_DIR`) with **catalogs**:
named views onto mounted folders. Every photo, album, album-folder, and trashed
photo belongs to exactly one catalog. The active catalog lives in the URL; the
worker keeps *all* catalogs indexed continuously. First-run setup forces the user
to create a catalog (name + folder, picked through a server-side folder browser);
in-app the user can switch catalogs and create new ones.

## Mental model

A **catalog** = a name + a folder on disk (a mounted volume in production) +
everything indexed from that folder. You view one catalog at a time, identified by
its slug in the URL. Switching catalogs is instant because the worker has already
indexed every catalog. Deleting a catalog is, by default, just removing the *view*
— the user's actual files are never touched unless they explicitly opt in.

## Decisions (from brainstorming)

1. **Active catalog lives in the URL** (`/c/<slug>/…`), not a cookie/global setting —
   the URL is authoritative, so concurrent sessions/tabs can view different catalogs
   with no shared-state ambiguity.
2. **Cache & trash are per-catalog**, subdivided by catalog id: `cache/<catalogId>/*`
   and `trash/<catalogId>/*`. Makes per-catalog size/file-count trivial.
3. **Originals are per-catalog paths**; the global `PHOTOS_DIR` is removed. `CACHE_DIR`
   and `TRASH_DIR` remain as *internal* roots (named volumes), no longer user knobs.
4. **Worker watches all catalogs continuously**; creating a catalog kicks off a
   background scan and adds it to the watch set.
5. **Delete a catalog prompts the user**: detach-only (drop DB rows + cache/trash,
   leave originals untouched) vs. also delete the originals on disk.
6. **URL identity is a slug under a `/c/` prefix** (e.g. `/c/family/photos`). The
   prefix guarantees catalog slugs never collide with real top-level routes.
7. **Settings split**: per-user **profile** settings (account + interface prefs like
   sound effects) vs. **per-catalog** settings (folder, upload template, indexing,
   stats, danger zone).
8. **Folder browser is bounded** to a single `MEDIA_ROOT` (default `/media`);
   catalogs are folders at/under it; no duplicate or nested catalog paths.
9. **Existing data is wiped** (clean break) — no backfill migration. Re-scan rebuilds
   photos from disk; DB-only data (albums, edits, color labels, favorites, trash) is
   intentionally discarded on upgrade.

## Approaches considered

- **Active catalog: URL vs. cookie vs. global DB setting.** → **URL.** A cookie or
  global setting creates "my view changed because another tab/user switched"
  surprises and forces every request to carry hidden context. The URL makes the
  catalog explicit, bookmarkable, and concurrency-safe.
- **Catalog identity in URL: slug vs. id.** → **slug + `/c/` prefix.** For an app whose
  purpose is switching contexts, readable URLs matter; the prefix removes any
  reserved-route collision risk. Slug machinery (unique slug, regenerate on rename)
  is modest.
- **Cache/trash location: inside each catalog's folder vs. central root keyed by id.**
  → **central root keyed by id.** Writing disposable cache into the user's precious
  originals folder is a footgun and breaks on read-only media mounts; a central
  `cache/<id>` / `trash/<id>` keeps originals pristine and is still per-catalog
  countable.
- **Worker: index only the active catalog vs. all catalogs.** → **all catalogs.**
  Because "active" is per-URL (no single instance-wide active catalog), on-demand
  indexing of "the active one" is undefined; continuous indexing of every catalog
  makes switching instant and keeps every catalog fresh.
- **API catalog scoping: nest every route under `/api/c/[catalog]` vs. flat + param.**
  → **nest every catalog-scoped route under `/api/c/[catalog]/…`** (including
  per-photo asset routes). The catalog is an explicit, validated path segment
  everywhere rather than a forgettable query param, mirroring the page routes;
  global routes (catalog CRUD, folder browser, profile, auth) stay top-level. The
  cost is updating the client helpers that build thumbnail/display URLs to include
  the catalog slug — acceptable for the consistency and the built-in scoping guard.
- **Existing data: migrate into a "Default" catalog vs. clean wipe.** → **clean wipe**
  (user's call). Removes all backfill/cache-relocation complexity; acceptable
  pre-1.0 since originals on disk are re-scannable.

## Data model

New and changed Prisma models (`packages/db/prisma/schema.prisma`):

- **`Catalog`** (new):
  - `id` (cuid), `name`, `slug` (`@unique`), `path` (`@unique`, absolute folder
    at/under `MEDIA_ROOT`), `uploadTemplate` (default
    `{YYYY}/{YYYY}-{MM}-{DD}/{filename}`), `createdAt`, `updatedAt`.
  - Relations: `photos Photo[]`, `albums Album[]`, `folders Folder[]`.
- **`Photo`**: add `catalogId String` (required) + relation `catalog`; add
  `@@index([catalogId])`. Change `path String @unique` → drop the field-level
  `@unique`, add `@@unique([catalogId, path])`. Existing `sortDate`/`createdAt`
  indexes remain (sort/query stay catalog-filtered via `where`).
- **`Album`**: add `catalogId String` (required) + relation + `@@index([catalogId])`.
- **`Folder`** (album-tree): add `catalogId String` (required) + relation +
  `@@index([catalogId])`. (Album folders are scoped to their catalog.)
- **`TrashedPhoto`**: add `catalogId String` (required) + `@@index([catalogId])`.
- **`Job`**: add `catalogId String?` (nullable — scopes rescan / purge-all /
  empty-trash to a catalog; null = legacy/global).
- **`UserSettings`** (new): `userId String @id` (references `User.id`,
  `onDelete: Cascade`), `soundEffectsEnabled Boolean @default(true)`, `updatedAt`.
- **`AppSettings`**: retired. `uploadTemplate` → `Catalog`; `soundEffectsEnabled` →
  `UserSettings`. The table/model is removed.

### Migration (destructive)

Single migration that: creates `Catalog` + `UserSettings`; adds the `catalogId`
columns and composite unique; drops `AppSettings`. Because existing rows cannot get
a non-null `catalogId` without a backfill (and the user chose a clean wipe), the
migration truncates `Photo`, `Album`, `AlbumPhoto`, `Folder`, `TrashedPhoto`, and
`Job` before/while adding the required columns. As an ops step the cache/trash dirs
are cleared (they regenerate). **Dev caveat:** the dev Postgres is shared across all
Conductor workspaces, so this migration wipes photo data for every workspace — apply
it deliberately, coordinated with the user, following the non-destructive hand-written
migration recipe where possible (see `lumio-env-gotchas`).

## Filesystem & config

`apps/web/src/lib/paths.ts` and `apps/worker/src/config.ts`:

- **Remove** `PHOTOS_DIR`.
- **Add** `MEDIA_ROOT` (default `/media`; dev fallback to a repo-local path). Bounds
  the folder browser and is the root under which catalog folders live.
- `CACHE_DIR` / `TRASH_DIR` stay as internal roots (Docker named volumes), but path
  helpers become catalog-aware:
  - `thumbnailPath(catalogId, photoId)` → `cache/<catalogId>/thumbnails/<photoId>.webp`
  - `displayPath(catalogId, photoId)` → `cache/<catalogId>/displays/<photoId>.webp`
  - `editedDisplayPath(catalogId, photoId)` → `cache/<catalogId>/displays-edited/<photoId>.webp`
  - trash mirrors under `trash/<catalogId>/…`
- `originalPath(catalog, relPath)` resolves `relPath` under the catalog's `path` with
  the existing traversal guard (resolved path must stay within the catalog folder).
- A `browseDir(absPath)` helper enforces the `MEDIA_ROOT` boundary for the folder
  browser (reject anything resolving outside `MEDIA_ROOT`).

## Worker

`apps/worker` (`scan.ts`, `watch.ts`, `watch-main.ts`, `handlers.ts`, `config.ts`):

- **Startup**: load all catalogs; for each, run the initial scan against its `path`;
  then watch every catalog root. Each chokidar event is routed to its catalog by
  matching the absolute path against the catalog roots (longest-prefix match).
- **Reconcile loop**: periodically (and/or via a lightweight signal) diff the live
  watch set against the `Catalog` table — a new catalog → enqueue+run a scan and add
  the watch; a removed catalog → stop watching. This is how the worker reacts to
  in-app catalog create/delete without a restart.
- **Scan/handlers** thread `catalogId` through: photos are created with their
  `catalogId`; relative `path` is computed against the owning catalog's root; cache
  writes target `cache/<catalogId>/…`.
- **Jobs** carry `catalogId` so rescan / purge-all / empty-trash operate on one
  catalog. Catalog **create** enqueues a scan job; catalog **delete** enqueues a
  cleanup job honoring the chosen mode (detach-only vs. delete-originals).

## Web — routing & catalog context

- **Per-catalog pages** move under `apps/web/src/app/(app)/c/[catalog]/…`:
  `photos`, `albums`, `albums/[id]`, `search`, `upload`, `photo/[id]` (+ the
  intercepting `@modal/(.)photo/[id]`), `trash`, `settings`. A `c/[catalog]/layout.tsx`
  resolves the slug → catalog (404 if it doesn't exist) and provides catalog context
  (id, slug, name) to its subtree.
- **Global pages**: `/setup`, `/settings` (profile), `/catalogs` (management).
- **Root redirect**: `/` (and `(app)` index) redirects to `/c/<last-used-or-first>/photos`.
  Last-used is remembered in a cookie *only* to choose the redirect target; the URL
  remains authoritative for the active catalog.
- **API** — every catalog-scoped route nests under `apps/web/src/app/api/c/[catalog]/…`:
  - Data/query/mutation routes: `…/photos`, `…/photos/[id]`, `…/search`, `…/albums`,
    `…/albums/[id]`, `…/exif/{fields,values}`, `…/uploads`, `…/trash`, `…/jobs`
    (rescan / purge-all / empty-trash for *this* catalog), `…/settings` (catalog
    settings: upload template), `…/stats`. The `[catalog]` segment is resolved
    slug → catalog and validated once (shared helper, 404 on unknown slug); handlers
    scope every query by `catalogId`.
  - Per-photo **asset** routes also nest: `…/photos/[id]/thumbnail`, `…/photos/[id]/display`.
    The handler resolves the catalog from the `[catalog]` segment, loads the photo,
    verifies `photo.catalogId === catalog.id` (404 on mismatch → no cross-catalog
    leakage), and serves `cache/<catalogId>/…`. Client helpers that build these URLs
    take the catalog slug from catalog context.
  - **Global (top-level)** routes: `/api/catalogs` (list/create/rename/delete),
    `/api/fs/browse` (folder browser, bounded to `MEDIA_ROOT`), `/api/profile`
    (per-user settings: sound effects), and the existing `/api/auth/*`.
- **Catalog switcher**: a control in the sidebar listing catalogs + "Manage / New
  catalog"; selecting one navigates to `/c/<slug>/photos`.

## Web — setup & catalog management

- **Setup gate**: redirect to `/setup` when there is **no user** *or* **no catalog**.
  Step 1 = create admin account (existing). Step 2 = create the first catalog (name +
  folder browser); on submit, create the catalog, redirect into `/c/<slug>/photos`,
  and the worker picks up the scan job. (On an existing instance with catalogs, step 2
  is auto-satisfied.)
- **`/catalogs`** (management): list catalogs with per-catalog stats; **create**
  (dialog: name + folder browser); **rename**; **delete** (dialog prompts detach-only
  vs. also-delete-originals).
- **Folder browser**: `GET /api/fs/browse?path=<abs>` returns subdirectories only,
  hard-bounded to `MEDIA_ROOT`, traversal-guarded. UI: a dialog with a breadcrumb,
  a directory list, and "use this folder". Enforces no duplicate/nested catalog path
  at create time.

## Web — settings reorg

- **Profile** (`/settings`): account (name/email/password/2FA — already on `User`) +
  interface preferences (**sound effects**, persisted in `UserSettings`).
- **Per-catalog** (`/c/[catalog]/settings`): library **folder path** (display), **upload
  template** (on `Catalog`), **indexing/rescan** (this catalog), **stats** (photo count,
  files on disk, per-catalog storage sizes, last updated), **danger zone** ("delete all
  photos in this catalog").
- `getSettings()` / the settings API split into a profile reader (per-user) and a
  catalog reader (per-catalog); `sound-settings-provider` reads from `UserSettings`;
  `upload-template-form` reads/writes `Catalog.uploadTemplate`.

## Deploy

Docker Compose:

- Mount media under `MEDIA_ROOT`: `~/photos:/media` (catalogs are `/media`, `/media/family`, …).
- A named volume for the cache root and one for the trash root (internal, per-catalog
  subdirs inside).
- `MEDIA_ROOT` is the only path-related user knob; `PHOTOS_DIR` / `CACHE_DIR` /
  `TRASH_DIR` are no longer user-facing.

## Testing approach

- **Unit (worker/shared)**: longest-prefix catalog routing of fs events; catalog-aware
  path helpers; `browseDir` boundary enforcement (reject traversal / outside
  `MEDIA_ROOT`); slug generation + uniqueness; duplicate/nested catalog-path rejection.
- **Unit (db/ingest)**: photo create writes `catalogId`; queries scope by catalog;
  per-catalog stats counts/sizes.
- **API**: `/api/catalogs` CRUD; `/api/c/[catalog]/…` slug resolution + 404 on
  unknown slug + per-`catalogId` query scoping; asset routes reject cross-catalog
  photo ids (404); `/api/fs/browse` bounds.
- **Browser verification** (auth-gated, per project workflow): setup → create first
  catalog via folder browser → land in `/c/<slug>/photos`; create a second catalog +
  switch; per-catalog settings/stats; delete with the detach prompt.

## Out of scope (deferred)

- Per-user catalog access control (all catalogs are visible to the single admin).
- Multi-user / invites / per-user ownership.
- Moving photos *between* catalogs.
- Re-pointing a catalog's folder after creation (path is set once at create).
- Theme and other future profile preferences (the `UserSettings` table makes them
  cheap to add later).

## Implementation phasing (for the plan)

1. **Backend foundation** — schema + migration, catalog-aware paths/config, worker
   multi-catalog watch/reconcile/scan, `Catalog` + `UserSettings` queries.
2. **API** — `/api/catalogs`, `/api/fs/browse`, `?catalog=` scoping on existing data
   routes, asset routes resolve from photo row.
3. **Routing/UI migration** — move pages under `/c/[catalog]`, catalog context layout,
   switcher, root redirect, settings reorg.
4. **Setup & management** — setup gate + first-catalog step, `/catalogs` page, folder
   browser dialog, delete prompt.
