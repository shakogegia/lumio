# Optimistic, worker-finalized photo delete (Backspace/Delete)

**Date:** 2026-06-25
**Status:** Approved (design)
**Supersedes/extends:** `2026-06-19-delete-image-and-trash-design.md` (the original synchronous trash)

## Problem

Today, moving photos to Trash is synchronous and UI-blocking:

1. A confirm dialog ("Move N photos to Trash?") blocks first.
2. The client **awaits** `POST /photos/trash`.
3. The server route runs `trashPhotos()` **inside the request**, looping per photo: snapshot → `TrashedPhoto`, move 3 files (thumbnail, display, original) to the trash dir, delete the `Photo` row.
4. Only after the server responds do the tiles disappear from the grid.

There is no keyboard shortcut, and selecting ~100 photos means the UI waits on a large batch of file moves (slow for cross-device trash dirs or huge originals).

## Goals

- **Backspace / Delete** is a delete shortcut in the web grid **and** the lightbox.
- Delete is **optimistic**: selecting 100 photos removes them from the UI **immediately**.
- The heavy work (snapshot + file moves) runs **asynchronously in the worker**, not the web request.
- Durable: survives tab-close; worker-down is safe; no re-ingest of trashed originals.

## Non-goals

- No change to the mobile app.
- No change to the `TrashedPhoto` snapshot model or the existing Trash page layout (only its data source widens).
- No new per-item job payload — we reuse the existing catalog-scoped, payload-less job queue.

## Approach (chosen: "B1 — soft-delete marker")

Add a soft-delete marker to `Photo`. The **web request only marks rows and returns**; a **worker job finalizes** (snapshot + move files + delete row). Because the `Photo` row *stays in place* until the worker finalizes, a rescan during the window sees an existing row — **no orphan-file re-ingest** — and the marker itself *is* the work queue, so it slots into the existing catalog-scoped job mechanism with no payload changes.

Rejected alternative ("B2 — snapshot immediately, defer only files"): deleting the `Photo` row up front but leaving the original on disk creates a re-ingest hazard (a rescan re-adds it as a new photo) unless originals are moved synchronously (defeating the offload) or the scanner learns about pending trash (couples scanner to trash).

## States

A photo is now in exactly one of three states:

| State | Representation | Files | Visible in grid | Visible in Trash |
|-------|----------------|-------|-----------------|------------------|
| Live | `Photo`, `trashedAt IS NULL` | in catalog/cache | yes | no |
| **Pending trash** | `Photo`, `trashedAt IS NOT NULL` | still in catalog/cache | no | **yes** |
| Finalized trash | `TrashedPhoto` (no `Photo` row) | moved to trash dir | no | yes |

**Trash = pending Photos ∪ TrashedPhoto.**

## Design

### 1. Data model — one migration

`packages/db/prisma/schema.prisma`, `Photo` model:

- Add `trashedAt DateTime?` (nullable; default null).
- Add `@@index([catalogId, trashedAt])` for the live-view filter and the worker drain.

Non-destructive (nullable column add) via `prisma migrate dev` (the repo uses migrations, `npm run migrate` in `packages/db`, not `db push`). **Shared-DB caveat:** generate the migration but coordinate applying it to the shared dev DB; other worktrees share one Postgres.

### 2. Web request — instant path

`POST /api/c/[catalog]/photos/trash` (`apps/web/src/app/api/c/[catalog]/photos/trash/route.ts`) becomes pure DB + enqueue, **no file I/O**:

```
trashed = prisma.photo.updateMany({
  where: { id: { in: ids }, catalogId, trashedAt: null },
  data:  { trashedAt: new Date() },
}).count
enqueueJob(prisma, JobType.process_trash, catalogId)
return { trashed }
```

The old file-moving `trashPhotos()` service is removed from the web layer (its per-photo logic moves to the worker — see §3).

### 3. Worker — async finalize

- New `JobType.process_trash` (`packages/shared/src/jobs.ts`), mirrored in the `Job.type` column convention.
- New `finalizeTrash(deps)` in `packages/jobs` (ports today's `trashPhotos` per-photo logic):
  - **Drain loop**: repeatedly fetch a batch of `Photo` where `catalogId` and `trashedAt IS NOT NULL` until none remain, then exit. This is essential because `enqueueJob` dedups by `(type, catalogId)` — photos marked *while* this job is already running produce no new queued job, so the running job must keep re-querying to pick them up. (Without the loop, a batch trashed mid-run could be orphaned as pending until the next unrelated enqueue.)
  - Per photo, **re-checking `trashedAt` is still set** (so an undo can cancel mid-drain): snapshot → `TrashedPhoto`, move original + `thumbnails/<id>.webp` + `displays/<id>.webp` into the trash dir, then delete the `Photo` row.
  - Idempotent / re-runnable; tolerant of already-moved files (existing `moveFile` ENOENT/EXDEV handling). Moving the original fires the watcher's `unlink`, which is tolerant of the already-deleted row (unchanged behavior).
- New handler in `apps/worker/src/handlers.ts` for `JobType.process_trash`, wired like `rescan`/`empty_trash` with `report()` progress.

### 4. Live-view filter — no leaks

The six photo-listing query sites each gain a `trashedAt: null` filter, applied through one greppable constant `LIVE_PHOTO = { trashedAt: null }` spread into their `where`:

1. `listPhotos` — `apps/web/src/lib/server/photos-service.ts`
2. `listPhotosForWhere` — same file
3. `getNeighborsForWhere` — same file (lightbox strip + prev/next)
4. albums — `apps/web/src/lib/server/albums-service.ts`
5. calendar — `apps/web/src/lib/server/calendar-service.ts`
6. folders — `apps/web/src/lib/server/folders-service.ts`

The worker/finalize, restore, and `listTrash` (pending side) paths deliberately do **not** apply `LIVE_PHOTO` — they need to see trashed rows.

### 5. Trash view + restore + empty — dual-state

- **`listTrash`** (`trash-service.ts`): UNION pending Photos (mapped into the existing trashed-photo DTO; `deletedAt` ← `trashedAt`) + `TrashedPhoto`, ordered newest-first. Pending items appear in Trash immediately.
- **Restore** (`/trash/restore`, one endpoint, server decides per id):
  - id is a pending `Photo` → clear `trashedAt` (instant; files never moved).
  - id is a `TrashedPhoto` → existing `restorePhotos` (recreate row + move files back).
- **Empty trash** (`JobType.empty_trash` / `purgeTrash`): purge `TrashedPhoto` (existing) **and** hard-delete pending Photos + their on-disk files.

### 6. Client — optimistic + Undo, unified across all entry points

Refactor `usePhotoActions.trash()` (`apps/web/src/components/photo-actions/use-photo-actions.tsx`):

- **Drop the confirm dialog.**
- Immediately: `gridRef.removePhotos(ids)` + clear selection (via `onSuccess`) + `playSound(MoveToTrash)` + show an **Undo toast** ("Moved N photos to Trash" · Undo, ~6s, sonner `action` button — matching the `passkey-nudge.tsx` pattern).
- Fire `trashPhotos(slug, ids)` **in the background** (UI does not await).
- **POST fails** → re-insert the removed tiles (rollback) + error toast.
- **Undo** → call the dual-state restore endpoint with `ids` + re-insert tiles + dismiss toast. Works whether or not the worker has already finalized (restore is dual-state).

This one change covers all four entry points, which already route through `trash()` / `trashPhotos()`:

1. Selection toolbar Delete button — `selection-actions.tsx`
2. Right-click context menu — `photo-context-menu.tsx`
3. Lightbox actions button — `lightbox-actions.tsx`
4. New keyboard shortcut (§7)

The grid must support re-inserting removed tiles for rollback/undo (extend `PhotoGridHandle` if a re-insert/restore op does not already exist; otherwise a refetch).

### 7. Keyboard shortcut

- **Grid** (`lib/grid-shortcut.ts` + `features/photo-grid/grid-shortcuts.tsx`): `resolveGridShortcut()` gains `Backspace`/`Delete` → `{ kind: "trash" }` when `selectionSize >= 1`; `GridShortcuts` dispatches `actions.trash([...selectedIds])`. Existing guards (`inEditable`, `overlayOpen`, `lightboxOpen`, modifier, `repeat`) already prevent misfires — essential so Backspace never fires while typing.
- **Lightbox** (`features/lightbox/use-lightbox-keyboard.ts`): `Backspace`/`Delete` → trash the current photo, then advance (`step(+1)`; if it was the last, `step(-1)`; if it was the only one, `close()`). Reuses the same optimistic + undo path. Respects the existing unsaved-edit `guard()`.

### 8. Error handling & edge cases

- **POST failure** → client rollback (re-insert tiles + error toast). Marker was never set server-side, so state stays consistent.
- **Undo vs finalize race** → worker re-checks `trashedAt` per photo before finalizing (skips cleared ones); restore handles already-finalized ids by moving files back.
- **Worker down** → photos stay pending: hidden from live views, durable, shown in Trash; drained on worker restart. No re-ingest because the `Photo` row persists.
- **Rescan during the window** → original still on disk but its `Photo` row still exists → treated as existing, not re-ingested.
- **Cross-catalog safety** → `updateMany`/drain scoped by `catalogId` (unchanged guarantee).

## Testing

- **Unit — `resolveGridShortcut`**: Backspace & Delete map to `trash` with selection ≥ 1; null under each guard (inEditable, overlay, lightbox, modifier, repeat, empty selection).
- **Unit — `finalizeTrash`**: drains pending, snapshots + moves + deletes, idempotent on re-run, skips rows whose `trashedAt` was cleared (undo). Mocked db + fs.
- **Unit — restore dual-state**: pending id → clears `trashedAt`, no file move; finalized id → `restorePhotos` path.
- **Unit — live-view filter**: `listPhotos` (and one other site) excludes `trashedAt IS NOT NULL`.
- **Manual / e2e**: select 100 → Backspace → instant removal + Undo toast; Undo restores; worker finalizes (files land in trash dir, Trash page shows them); lightbox Delete advances correctly (including last-photo and only-photo cases); worker-down then restart drains.

## Open coordination

- Apply the `trashedAt` migration to the shared dev DB deliberately (drift caveat).
- Confirm `PhotoGridHandle` can re-insert tiles for rollback/undo; if not, add that op (or fall back to a scoped refetch).
