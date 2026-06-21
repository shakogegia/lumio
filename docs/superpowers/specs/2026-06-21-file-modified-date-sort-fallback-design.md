# File created & modified dates: sort fallback + sort option

**Date:** 2026-06-21
**Status:** Revised design (supersedes the original "file-modified date" scope)

> **Revision note.** The original scope added only a file-*modified* date and used it as the
> `sortDate` fallback. It was implemented and committed (see "Phase 1 — already done"). The
> design then grew: store **both** the file-created (birthtime) and file-modified (mtime)
> dates, drive the taken-sort fallback off the *earliest* of the two, show both in the
> sidebar, and add an explicit **File created** sort option. This document describes the
> final design; the implementation plan tracks Phase 1 (done) and Phase 2 (the delta).

## Problem

A photo's place in the timeline is decided by `Photo.sortDate`, set at ingest. Originally:

```
sortDate = takenAt ?? now
```

`takenAt` comes from EXIF (`DateTimeOriginal`/`CreateDate`). For any photo **without** EXIF —
screenshots, scans, downloads, edited re-saves — `sortDate` fell straight to the import
instant, so EXIF-less photos bunch up at "today" instead of spreading across their real dates.
The taken-date sort and the calendar/month grouping both lose chronology for these photos.

The filesystem carries two timestamps we can use as a better proxy:

- **mtime** (last modified) — POSIX-guaranteed; often *preserved* by copy tools, so it
  frequently still carries the original write/capture time.
- **birthtime** (created) — when the inode was created on *this* filesystem. On macOS APFS it
  is reliable and is the true origin for files created in place (screenshots, app-saved
  images). It *resets to "now"* when a file is copied/downloaded, so on its own it can
  re-cluster imported files at import time.

Neither is universally best, so we store both and combine them.

## Goal

1. Store both `fileCreatedAt` (birthtime) and `fileModifiedAt` (mtime) on every photo.
2. Taken-sort fallback uses the **earliest** of the two file dates:
   ```
   sortDate = takenAt ?? min(fileCreatedAt, fileModifiedAt)
   ```
   The earliest known file timestamp is the best lower-bound proxy for "when this happened",
   and dominates either single source across downloads, in-place-then-edited files, and
   mtime-preserving copies.
3. Show both dates in the lightbox sidebar.
4. Add a **File created** sort option (asc/desc) alongside the existing Date taken / Date
   imported sorts.

## Data model (`Photo`)

| Column | Type | Role |
| --- | --- | --- |
| `fileMtimeMs` | `Float NOT NULL` | exact stat fingerprint, change-detection only (sub-ms precision) |
| `fileSize` | `Int NOT NULL` | size half of the fingerprint |
| `fileModifiedAt` | `DateTime NOT NULL` | mtime mirror; readable + queryable; one input to the taken-sort fallback |
| `fileCreatedAt` | `DateTime NOT NULL` | birthtime mirror; readable + queryable; the other input to the fallback |
| `sortDate` | `DateTime NOT NULL` | chronology for the "Date taken" sort |

Rationale for keeping the float fingerprint separate from the `DateTime` mirrors:
`fileMtimeMs` stays a raw float so change-detection keeps sub-millisecond precision
(`planScan` compares `row.fileMtimeMs === st.mtimeMs`; a `TIMESTAMP(3)` would truncate and
cause spurious re-hashes). The `DateTime` mirrors are for display, querying, and sorting,
where ms precision is fine. `fileCreatedAt` has no fingerprint counterpart — birthtime is not
used for change detection.

All three of `fileMtimeMs`, `fileModifiedAt`, `fileCreatedAt` are `NOT NULL`: `fs.stat()`
always returns `mtimeMs` and `birthtimeMs` as numbers, and `StoreInput` requires them, so
every stored photo has them. The `Photo` table is empty post-Phase-1 wipe, so the Phase-2
`fileCreatedAt` column adds cleanly with no backfill.

## Behaviour

### Ingest (`ingestPath` → `storePhoto`)

`ingestPath` already `stat`s the file. It passes `st.size`, `st.mtimeMs`, and (new)
`st.birthtimeMs` into `storePhoto` via `StoreInput` (new field `fileBirthtimeMs: number`).
`storePhoto` derives:

```
fileModifiedAt = new Date(fileMtimeMs)
fileCreatedAt  = new Date(fileBirthtimeMs)
sortDate       = takenAt ?? earliest(fileCreatedAt, fileModifiedAt)
```

where `earliest(a, b) = a < b ? a : b`. Both file dates are always present, so there is no
import-time floor (a genuine re-import re-derives all of this from the new file; the
content-unchanged restamp path leaves `sortDate` alone — see scan).

### Scan / refresh path

- **Fingerprint comparison** (`planScan`): unchanged — exact float `fileMtimeMs === st.mtimeMs`.
- **Restamp** (content-identical touch, `refreshStamp`): updates `fileModifiedAt` **and**
  `fileCreatedAt` (in the same raw `UPDATE`, so `updatedAt` is not bumped), but does **not**
  touch `sortDate` — a touch that doesn't change pixels must not reorder the photo. (mtime can
  move on a touch; birthtime normally won't, but re-writing it is harmless and keeps the
  mirror exact.)
- **Genuine re-import** (hash changed → `storePhoto`): re-derives all file dates and
  `sortDate` from the new file.

## Sort options

`PhotoSort` currently: `taken-desc`, `taken-asc`, `imported-desc`, `imported-asc`. Add
`file-created-desc`, `file-created-asc`.

`photoOrderBy` maps:
- `taken-*` → `sortDate`
- `imported-*` → `createdAt`
- `file-created-*` → `fileCreatedAt` (new)

each with the `id` tiebreaker in the same direction for keyset pagination. The sort dropdown
UI gains a "File created" option (newest/oldest), labelled consistently with "Date taken" /
"Date imported".

A **File modified** sort is intentionally NOT added (out of scope) — file-modified is visible
in the sidebar but not offered as a sort. Easy to add later for symmetry.

## Consumers

- "Date taken" sorts and the calendar/month grouping already key off `sortDate`; the new
  `min()` fallback flows through automatically — no query change beyond `photoOrderBy`.
- "Date imported" sorts stay on `createdAt`, untouched.
- New `file-created-*` sorts read `fileCreatedAt`.
- Stale comments describing `sortDate` as `takenAt ?? importTime` (Phase 1 updated them to
  `?? fileModifiedAt`) become `takenAt ?? earliest file date`:
  `apps/web/src/lib/photo-order.ts`, `apps/web/src/lib/calendar-service.ts`,
  `packages/ingest/src/store.ts`.

### Sidebar display

Lightbox Info tab rows, in order: `Source · Taken · File created · File modified · Camera ·
Hash`. Both file dates render their raw ISO value (matching "Taken"); prettier formatting is
out of scope.

`PhotoDTO` gains `fileCreatedAt: string | null` (alongside the existing
`fileModifiedAt: string | null`). Both are non-null for live photos; `toTrashedPhotoDTO`
returns `null` for both (TrashedPhoto has no file-stat columns).

## Migration

**Phase 1 (already applied):** wiped `Photo`/`TrashedPhoto`, added `fileModifiedAt NOT NULL`,
tightened `fileSize`/`fileMtimeMs` to `NOT NULL`
(`20260621123000_add_file_modified_at`).

**Phase 2:** add `fileCreatedAt DateTime NOT NULL` to the (currently empty) `Photo` table — a
clean `NOT NULL` add, no backfill. Same shared-DB recipe: hand-write `migration.sql`, apply
with `prisma migrate deploy` (never `migrate dev`/reset). The migration should re-`DELETE FROM
"Photo"` defensively in case another worktree repopulated it before this runs, so the
`NOT NULL` add can't fail.

After Phase 2, reimport from disk (`pnpm ingest`) so every row gets real created/modified
dates and a `min()`-based `sortDate`.

## Out of scope

- A "File modified" sort option (sidebar display only).
- `min()` guard against corrupt epoch/1970 timestamps (rare; YAGNI).
- Prettier date formatting of the sidebar rows.

## Pre-existing test failures (not in scope to fix here)

The branch base (`2d3c13b`) predates the `origin/main` fix that switched the default photo
sort to `imported-desc`. So `coercePhotoSort`/`parseGridSort`/detail-scope tests that expect
`taken-desc` fail on this branch and resolve on rebase onto `origin/main`. These are unrelated
to this work and must not be "fixed" by editing those tests (that would absorb an unrelated
upstream change). The web service-test fixtures that fail with `toISOString` on `undefined`,
however, ARE in scope — they feed mock rows to `toPhotoDTO` and need `fileModifiedAt` +
`fileCreatedAt` added.

## Testing

- `store.test.ts`: `sortDate` = `takenAt` when present; = `min(created, modified)` when
  `takenAt` is null (cover both orderings — created<modified and modified<created); both
  `fileCreatedAt` and `fileModifiedAt` written from the supplied stamps.
- `scan.test.ts`: a restamp updates both file-date columns but leaves `sortDate`/`updatedAt`
  untouched (verified manually — raw SQL, no DB harness); planScan unchanged.
- `mappers.test.ts`: `toPhotoDTO` emits both ISO file dates; `toTrashedPhotoDTO` emits `null`
  for both.
- `photo-order.test.ts` (or equivalent): `file-created-*` maps to `fileCreatedAt` with the
  matching `id` tiebreaker.
- Web service-test fixtures updated so `toPhotoDTO` no longer throws.
