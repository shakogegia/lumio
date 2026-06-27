# Reorganize files by upload template (Danger Zone) — design

- **Date:** 2026-06-27
- **Status:** Approved (pending implementation plan)
- **Branch:** gego/upload-template-dates

## Summary

Add a Danger Zone action in a catalog's settings that **reorganizes existing
photo files and folders on disk to match the catalog's current upload
template** (`renderTemplate` from `@lumio/shared`). It runs as an async worker
job with progress reporting, and a confirmation dialog that previews how many
photos will move before the user commits.

The action is non-destructive to photo *content*: it only renames/moves the
original files and updates each `Photo.path`; the photo id, edits, EXIF, and
renditions (which are keyed by id) are preserved.

## Goal / success criteria

- A user can click "Reorganize files" in the catalog Danger Zone, see a count
  of how many photos will be relocated, confirm, and have the worker move the
  files into the folder structure the upload template produces.
- The filesystem watcher does **not** duplicate or trash any photo as a result
  of the moves.
- Re-running the action when everything is already in place moves nothing
  (idempotent).

## Locked decisions

1. **Scope — per-run toggle.** The dialog has an "Include filesystem-imported
   photos" toggle (default **off**).
   - Off → only `source = upload` photos.
   - On → all photos regardless of source.
   - Pending-trash / trashed photos (`trashedAt != null`) are **always excluded**.

2. **Template date semantics during reorg.**
   - `{TAKEN_*}` / legacy `{YYYY}`/`{MM}`/`{DD}` → `takenAt ?? fileModifiedAt ??
     fileCreatedAt` (mirrors the upload-time capture-date-with-fallback).
   - `{NOW_*}` → the photo's `createdAt` (when it entered Lumio). This keeps a
     NOW-based template fanning photos across folders by original import date
     instead of collapsing them all into one "today" folder.

3. **Confirmation UX — count preview + confirm word.** Opening the dialog (and
   toggling the filesystem switch) fetches a purely in-memory count
   (`N of M photos will be relocated`); the user then types the confirm word to
   execute. Mirrors the existing `DeleteAllPhotos` confirm-word pattern.

4. **Watcher-safe ordering — DB path first, then rename.** For each photo:
   update `Photo.path` / `Photo.dirPath` in the database **first**, then
   `rename()` the file on disk (rename preserves mtime). This makes both
   resulting watcher events no-ops:
   - `unlink(oldPath)` → `removePath` looks up `(catalogId, oldPath)`, finds no
     row (already repointed) → no-op.
   - `add(newPath)` → `upsert` finds the already-updated row; file size + mtime
     match the stored stamp → plan = "skip" (or "heal" if a rendition is
     missing). No re-ingest, no new row.

   This requires **no changes to the watcher** and no pause/suppress mechanism.

## Why the watcher ordering matters (background)

The chokidar watcher (`apps/worker/src/watch.ts`) has:
- **no move detection** — a move is seen as independent `unlink` + `add`;
- **no hash-dedup on `add`** — identity is the `(catalogId, path)` unique key
  only, so a same-content file at a new path is treated as "new" and fully
  re-ingested with a new id;
- **immediate delete on `unlink`** — `removePath` (`packages/ingest/src/ingest.ts`)
  hard-deletes the `Photo` row and its renditions, no soft-delete.

So the naive "rename then update DB" order would delete the original photo
(losing edits) and re-import the moved file as a brand-new row. The DB-first
ordering (decision 4) avoids this entirely.

The worker runs the watcher and the job consumer in the same process
(`apps/worker/src/start.ts`), and the consumer claims one job at a time
(`claimNextJob` with `FOR UPDATE SKIP LOCKED`), so a rescan job cannot run
concurrently with a reorganize job. No automatic full rescan runs on a timer
(the 5s reconcile only adjusts the watched-directory set).

## Components

### 1. Core mover — `packages/jobs/src/reorganize.ts` (new)

Dependency-injected and unit-tested, following `packages/jobs/src/purge.ts`.

```
interface ReorganizeDeps {
  db: PrismaClient (photo);
  catalogId: string;
  photosDir: string;        // catalog.path
  uploadTemplate: string;
  includeFilesystem: boolean;
  onProgress?: (processed: number, total: number) => void | Promise<void>;
}

previewReorganize(deps) -> { total: number; willMove: number }
reorganizePhotos(deps) -> { moved: number; skipped: number; failed: number }
```

- **Scope query:** `where { catalogId, trashedAt: null, ...(includeFilesystem ? {} : { source: "upload" }) }`.
- **Per-photo target:** `renderTemplate(uploadTemplate, { date: takenAt ?? fileModifiedAt ?? fileCreatedAt, now: createdAt, originalFilename: basename(path) })`.
- **`previewReorganize`:** counts photos whose `desired !== path`. No disk or DB
  writes. (Collision suffixing does not change whether a photo moves, only its
  final name, so the count is stable and matches execution's `moved` minus
  failures.)
- **`reorganizePhotos`:** sequential (keeps collision resolution race-free and
  avoids hammering disk/DB). For each in-scope photo:
  1. compute `desired`; if `desired === path` → `skipped++`, continue.
  2. resolve a collision-free relative target: starting from `desired`, while a
     `Photo` row exists at `(catalogId, candidate)` **or** a file exists at
     `candidate` (excluding this photo's own current path), append `-N` to the
     filename stem (same scheme as `placeUpload`).
  3. update the row: `path = target`, `dirPath = dirname(target) or ""`.
  4. `mkdir -p` the target's parent, then `rename(oldAbs, newAbs)`.
  5. on rename error → **revert** the row's `path`/`dirPath`, log, `failed++`,
     continue.
  6. `moved++`.
  - After the loop, **prune emptied directories**: for each vacated parent dir,
    walk bottom-up removing now-empty directories, bounded to under `photosDir`
    (never remove `photosDir` itself).
- **Tolerated edge cases:** source file missing on disk → log + `skipped`
  (don't fail the batch); rename `EXDEV` is not expected (moves stay within one
  catalog subtree / filesystem) but a rename failure is handled by the revert
  path.

### 2. Job types — `packages/shared/src/jobs.ts`

Add two enum values to encode the single boolean toggle without a DB migration
(the `Job` row has no params column):

```
reorganize = "reorganize"          // uploads only
reorganize_all = "reorganize_all"  // include filesystem-imported
```

Rejected alternative: add a `Job.params Json?` column (cleaner/more general but
requires a migration on the shared dev DB, which we are avoiding for now).

### 3. Worker handler — `apps/worker/src/handlers.ts`

Map both job types to the mover:

```
[JobType.reorganize]:     run(includeFilesystem=false)
[JobType.reorganize_all]: run(includeFilesystem=true)

run = async (report, job, includeFilesystem) => {
  resolve catalog (path, uploadTemplate) by job.catalogId;
  await reorganizePhotos({ db, catalogId, photosDir: catalog.path,
    uploadTemplate: catalog.uploadTemplate, includeFilesystem,
    onProgress: (p, t) => report(p, t, "Reorganizing…") });
  report final counts;
}
```

### 4. API routes — `apps/web/src/app/api/c/[catalog]/photos/reorganize/`

- `POST /reorganize` — body `{ includeFilesystem: boolean }`. `validateTemplate`
  the catalog's template; on failure return 400. Else `enqueueJob` the matching
  type (`reorganize` or `reorganize_all`) → `202 { jobId }`.
- `GET /reorganize/preview?includeFilesystem=<bool>` → `{ total, willMove }`
  via `previewReorganize`. Read-only.
- Both wrapped in `withCatalog` (auth + catalog resolution), following the
  existing `photos/purge` route conventions.

### 5. UI — `apps/web/src/app/(app)/settings/catalogs/[id]/danger-zone.tsx`

New `ReorganizePhotos` card alongside `DeleteAllPhotos`:
- "Include filesystem-imported photos" toggle (default off).
- Live count `N of M photos will be relocated`, fetched from the preview
  endpoint on open and whenever the toggle changes.
- Confirm-word input gates the run button (same UX as `DeleteAllPhotos`).
- `useAsyncJob(jobType, catalogApiUrl(slug, "/photos/reorganize"), { onComplete: () => router.refresh() })`,
  where `jobType` is `reorganize_all` when the toggle is on, else `reorganize`.
  Progress comes from activity polling.
- The POST body carries `{ includeFilesystem }`.

## Data flow

1. User opens the Reorganize dialog → UI `GET .../reorganize/preview` → shows count.
2. User toggles filesystem switch → preview refetched with new param.
3. User types confirm word, clicks Run → UI `POST .../reorganize { includeFilesystem }`
   → route validates template, `enqueueJob` → `202 { jobId }`.
4. Worker consumer claims the job → handler calls `reorganizePhotos`, reporting
   progress; each photo: DB repoint → file rename; empty dirs pruned at the end.
5. UI activity polling observes the job leave the active set → `router.refresh()`.

## Error handling

- Invalid template → 400 at POST, job never enqueued.
- Per-photo rename failure → DB revert + log + continue (batch is not aborted).
- Missing source file → log + skip.
- Whole-job failure → consumer marks the `Job` row `failed` with the error
  message (existing behavior).

## Testing (TDD)

Core mover, against a real temp directory (pattern: `packages/jobs/src/purge.test.ts`):
- moves a photo to its template path, updating `path` and `dirPath`;
- preserves the file and its mtime; photo id unchanged;
- skips a photo already at its template path (idempotent);
- collision → second photo targeting the same path gets a `-N` suffix;
- `includeFilesystem=false` excludes `source = filesystem` photos; `true` includes them;
- excludes `trashedAt != null` photos;
- prunes directories left empty by the moves;
- missing source file is tolerated (skip, no throw);
- rename failure reverts the DB row (`path`/`dirPath` unchanged afterward).

`previewReorganize`:
- `willMove` counts only photos whose templated path differs from the current path;
- respects the `includeFilesystem` scope and trashed exclusion.

## Known limitations (accepted)

- A crash in the small window between the DB repoint and the rename for a single
  photo leaves that row pointing at the not-yet-moved file. Recoverable by a
  manual rescan; that one photo could lose its edits. Acceptable for a Danger
  Zone operation.
- `{filename}` uses the current file basename (there is no separate
  original-filename column), so a `-N` suffix from a prior collision can persist
  across reorganizations.

## Out of scope (possible follow-ups)

- A `Job.params Json?` column to parameterize jobs generically.
- A full `old path → new path` dry-run listing.
- Concurrency in the mover (sequential is fine for v1).
- Reorganizing sidecar / non-image files.
