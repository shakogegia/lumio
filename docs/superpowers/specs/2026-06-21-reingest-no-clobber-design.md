# Re-ingest must not clobber user edits, sort, or renditions

**Date:** 2026-06-21
**Status:** Approved (design)
**Branch:** gego/image-rotation-revert-bug

## Problem

A photo can show the wrong orientation in production even though its stored
recipe is correct. Two DB rows of the same source image both carry
`edits: { rotate: 270, flipH: false, flipV: false }`, yet one renders portrait
(correct) and the other landscape (un-rotated). The rotate buttons then behave
strangely, and unrelated photos reshuffle in the grid after a rescan.

These are three symptoms of **one** root cause.

## Root cause

The lightbox displays the **pre-baked display rendition** (a WebP with the edit
burned into its pixels). The on-screen CSS transform is only the *delta* between
the saved recipe and the in-progress edit
(`zoomable-image.tsx` → `previewTransform(shown.recipe, working)`); for a saved
photo with no pending change that delta is the identity. So the orientation the
user sees is whatever pixels are in the stored rendition — **independent of**
`edits.rotate`.

The worker's re-ingest path was never made edits-aware. The rotate/flip feature
(`e6c339f`, #50) taught `renditions.ts` about edits, but `store.ts` has not
changed since `00c7f6a` — before edits existed. When the worker re-ingests an
already-edited photo (`scan.ts`/`watch.ts` → `ingestPath` → `processImage` →
`storePhoto`):

- `processImage` (`process.ts:28`) builds renditions with `edits = null` → the
  **un-edited** pixels.
- `storePhoto` (`store.ts`) overwrites `display`/`thumbnail` on disk and the
  `width`/`height`/`thumbhash`/`takenAt`/`sortDate` columns with those un-edited
  values, **but leaves the `edits` column intact** and bumps `updatedAt`
  (`@updatedAt`).
- `updatedAt` changing busts the rendition URL (`?v=`, `rendition-url.ts`), so
  the browser fetches the freshly-clobbered (un-edited) rendition.

Result: the recipe says `rotate: 270` but the rendition is un-rotated → photo
shows un-rotated; `width`/`height` are wrong so zoom/fit is wrong; and for any
photo without an EXIF capture date, `sortDate` is reset to
`processed.takenAt ?? new Date()` → it jumps in the grid.

### Why it is production-only and flaky

In production `web` and `worker` share the same `cache` volume
(`infra/docker-compose.prod.yml`). The clobber fires whenever a re-ingest runs
for an edited photo — today triggered by an mtime/size change (backups, syncs,
`touch`), a missing cache file, the Rescan button, or a `change` watch event.
"Sometimes / second try works" is a race between the web edit-write and the
worker re-ingest-write to the same files; last writer wins. Locally the worker
is usually not re-ingesting those files, so it does not reproduce.

## Design

One invariant drives everything:

> A file whose path is already in the DB is **re-imported only when its content
> hash actually differs** from the stored hash. `size`/`mtime` are a cheap
> pre-filter, not the change signal. The only other thing that may happen to an
> existing photo during a scan/watch is **healing a missing cache rendition**,
> done edits-aware.

### Change detection: hash, with size+mtime as a pre-filter

For each file on disk during a scan (and for each watcher `add`/`change`):

1. **Path not in DB** → full ingest (new photo). *(unchanged)*
2. **Path in DB, `size`+`mtime` match the stored values** → **skip**. Fast path,
   no file read; the steady-state majority.
3. **Path in DB, `size` or `mtime` differs** → read the file and compute its
   sha256:
   - **hash == stored hash** → false alarm (a backup/sync touched the
     timestamp). Update only the stored `fileSize`/`fileMtimeMs` so the next
     scan is cheap again, and **preserve everything else** — `edits`,
     `sortDate`, `takenAt`, `width`/`height`, renditions. No `updatedAt`-driven
     rendition refetch is required because the renditions are untouched.
   - **hash != stored hash** → genuine pixel replacement → **re-import**:
     regenerate renditions from the new content (with `edits = null`), refresh
     `takenAt`/`sortDate`/`width`/`height`/`thumbhash`/`hash`/`fileSize`/
     `fileMtimeMs`, and **reset `edits` to null** (decision A: the new pixels
     carry their own orientation; re-applying an old recipe would be wrong).
     `createdAt` is left as-is (original import date).
4. **Path in DB, a cache rendition file is missing** (independent of hash) →
   regenerate `display`/`thumbnail`/`thumbhash` only, **re-applying the row's
   saved `edits`**; leave `sortDate`/`takenAt`/`width`/`height`/`edits`/
   `createdAt` untouched.
5. **In DB but absent from disk** → reconcile delete. *(unchanged)*

Cost: a file is read/hashed only when its `size` or `mtime` changed — a bounded
set. A backup that rewrites every timestamp costs one full-library hash pass
once (then stamps are refreshed and scans go cheap), instead of clobbering every
edit on every scan.

### Watcher (`watch.ts`)

- `add` → full ingest (new file). *(unchanged)*
- `change` on an already-ingested path → run the same existing-path logic above
  (hash check): re-import only if the hash differs; otherwise refresh the stamp
  / heal a missing cache. Editing EXIF or touching a file externally can no
  longer revert a rotation.
- `unlink` → remove. *(unchanged)*

### New ingest helper (`@lumio/ingest`)

The worker cannot import the web app's `applyPhotoEdits`
(`apps/web/src/lib/photo-edits-service.ts`), so the edits-aware rendition logic
must live in `@lumio/ingest` next to `buildRenditions`:

- `regenerateRenditions(originalInput, edits, dirs, id)` — builds edits-aware
  `display`/`thumbnail`, writes them to `<displaysDir>/<id>.webp` and
  `<thumbnailsDir>/<id>.webp`, and returns the new `thumbhash`. Used by the
  cache-heal path (step 4); the worker then updates only the `thumbhash` column.
- A small `hashFile(absPath)` helper (sha256 of the bytes) factored out of
  `processImage`, so the change-detection path can hash without decoding or
  building renditions.

### `store.ts` / scan refactor

- `scan.ts`'s `isUnchanged` becomes a three-way decision (skip / hash-check /
  heal) rather than the current boolean. The pure decision functions stay pure
  and unit-tested.
- `storePhoto` keeps its create/full-update behavior for the new-file and
  genuine-change paths. The "preserve" (false-alarm) and "heal" paths do **not**
  go through the full `storePhoto` update; they touch only the specific columns
  named above so they cannot clobber unrelated fields.

### Rescan button (Settings → Catalog → Indexing)

Keep it — it is a genuine fallback for when the watcher misses events (files
copied while the worker was down; filesystems where inotify does not fire: NAS,
network shares, some Docker bind mounts). After this change it is a pure
reconcile and can never touch an existing photo's edits/sort/dates. Update its
description from "Trigger a full rescan of the photos directory." to something
honest like "Scan for new and deleted files."

## Testing

- **Regression (the bug):** ingest a photo → apply `rotate: 270` → run a scan
  (and separately, fire a `change` event / `touch` the original so `mtime`
  changes) → assert the display rendition, `edits`, `width`/`height`, and
  `sortDate` are all unchanged.
- **False-alarm stamp refresh:** mtime changes but content identical → stored
  `fileMtimeMs` updates; `edits`/`sortDate`/renditions preserved; no re-decode.
- **Genuine replacement:** replace file bytes (hash differs) → renditions
  regenerated from new content, metadata refreshed, `edits` reset to null,
  `createdAt` unchanged.
- **Cache heal:** delete `display`/`thumbnail` for an edited photo → scan
  regenerates them **with** the saved recipe (rotated), other columns untouched.
- **New file / deletion** reconcile paths still pass (existing tests).
- Pure-function unit tests for the new three-way scan decision.

## Trade-offs / out of scope

- Genuine in-place replacement now requires a hash pass for files whose
  timestamp changed; accepted (bounded, self-correcting).
- No "force re-import / re-read metadata for existing photos" affordance is
  added now; can come later if ever needed.
- Existing production rows already clobbered (recipe says rotate, rendition is
  un-rotated) are **not** auto-repaired by this change. They self-heal when the
  user re-applies the edit, or via a one-off backfill — out of scope here; flag
  separately if a migration is wanted.
