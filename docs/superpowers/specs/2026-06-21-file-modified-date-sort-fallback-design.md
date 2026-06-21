# File-modified date as a sort fallback

**Date:** 2026-06-21
**Status:** Approved (pending spec review)

## Problem

A photo's place in the timeline is decided by `Photo.sortDate`, which today is set at
ingest as:

```
sortDate = takenAt ?? now   // store.ts:37
```

`takenAt` comes from EXIF (`DateTimeOriginal`/`CreateDate`). For any photo **without**
EXIF — screenshots, scans, downloads, edited re-saves — `sortDate` falls straight to
the import instant. Drop 500 old screenshots into the library today and they all bunch
up at "today" instead of spreading across their real dates. The taken-date sort and the
calendar/month grouping both lose chronology for EXIF-less photos.

We already capture a filesystem timestamp at ingest (`fileMtimeMs`, from `fs.stat`),
but it is used only as a change-detection fingerprint — it never feeds the sort. The
missing tier is the file's modified date sitting between EXIF capture date and import
time.

## Goal

Give `sortDate` a middle fallback so EXIF-less photos sort by their file's modified
date instead of import time:

```
sortDate = takenAt ?? fileModifiedAt ?? now
```

## Why mtime, not birthtime

- `mtime` is POSIX-guaranteed — every file on every filesystem has one. `birthtime`
  can come back `0`/unset on Linux, so it is unreliable as a NOT NULL signal.
- A plain copy/download resets `birthtime` to "now" (≈ import time), so for exactly the
  EXIF-less files we care about it adds nothing over `createdAt`. Many copy tools
  preserve `mtime`, so it is frequently close to the original write/capture time.

## Data model

Two timestamps with distinct jobs, so each gets the representation that fits:

| Column | Type | Role | Change |
| --- | --- | --- | --- |
| `fileMtimeMs` | `Float` | exact stat fingerprint, change-detection only | **NOT NULL** (was `Float?`) |
| `fileSize` | `Int` | size half of the fingerprint | **NOT NULL** (was `Int?`) |
| `fileModifiedAt` | `DateTime` | readable mirror of mtime; feeds `sortDate`; queryable | **new, NOT NULL** |
| `sortDate` | `DateTime` | chronology for the "taken" sorts | semantics change (see below) |

Rationale for two columns rather than one:

- `fileMtimeMs` stays a raw float so change-detection keeps sub-millisecond precision.
  `planScan` compares `row.fileMtimeMs === st.mtimeMs` (`scan.ts:55`); a
  `TIMESTAMP(3)` would truncate fractional milliseconds and cause spurious re-hashes.
  Its low-level name is now correct: it is unambiguously a fingerprint, nothing else.
- `fileModifiedAt` is a real `DateTime` — human-readable in DB tooling, queryable
  (`WHERE fileModifiedAt > '2024-01-01'`), and the value that feeds `sortDate`. The ms
  truncation is harmless here because the float already covers the equality check.

The two are **not redundant over time**: a content-identical touch updates the
file-date pair to track the live file but must leave `sortDate` frozen (a touch that
does not change pixels must not reorder the photo).

Tightening `fileMtimeMs`/`fileSize` to `NOT NULL` is a cleanup the wipe unlocks:
`StoreInput` already requires both (`store.ts:7`), so they are always populated going
forward. It lets us drop the `| null` handling in `planScan`/`ScanRow` (`scan.ts:50`,
`scan.ts:91`).

## Behaviour

### Ingest (`ingestPath` → `storePhoto`)

`ingestPath` already has `st.mtimeMs` (`ingest.ts:25`). It passes:

- `st.mtimeMs` (raw) → `fileMtimeMs` (fingerprint), unchanged.
- `new Date(st.mtimeMs)` → `fileModifiedAt` (new).

`storePhoto` writes both and computes `sortDate = takenAt ?? fileModifiedAt ?? now`.
Because `fileModifiedAt` is always present, the file's mtime is the real floor; `?? now`
remains only as a defensive default. EXIF-less photos now sort by their file date.

### Scan / refresh path

- **Fingerprint comparison** (`planScan`, `scan.ts:49`): unchanged — exact float
  `fileMtimeMs === st.mtimeMs`.
- **Restamp** (content-identical touch, `refreshStamp`, `scan.ts:118`): also sets
  `fileModifiedAt`, alongside `fileSize`/`fileMtimeMs`, in the same raw `UPDATE` so
  `updatedAt` is still not bumped. It does **not** touch `sortDate`.
- **Genuine re-import** (hash changed → `storePhoto`): recomputes `fileModifiedAt` and
  `sortDate` from the new file, same as a fresh ingest. Existing behaviour, extended.

Net: the file-date pair tracks the live file; `sortDate` is derived from it once and
only re-derived on a real content change.

## Consumers

No web query changes. The consuming layer already separates the two concepts
(`photo-order.ts`):

- "Taken" sorts (`taken-desc`/`taken-asc`) order by `sortDate` → improved by this change.
- "Imported" sorts (`imported-desc`/`imported-asc`) order by `createdAt` → genuine
  import time, untouched. The default grid sort (newest imported) is unaffected.
- Calendar/month grouping (`calendar-service.ts`) buckets by `sortDate` → EXIF-less
  photos now group by file date instead of import time, which is the intended fix.

Stale comments describing `sortDate` as `takenAt ?? importTime` will be updated to
`takenAt ?? file-modified ?? import time`:

- `apps/web/src/lib/photo-order.ts:6`
- `apps/web/src/lib/calendar-service.ts:17`
- `packages/ingest/src/store.ts:37`

### Sidebar display

Surface the file-modified date in the lightbox Info tab
(`apps/web/src/components/photo-grid/lightbox-sidebar.tsx`), as a new `Row` placed
directly after "Taken":

```
Source / Taken / File modified / Camera / Hash
```

Plumbing required:

- `PhotoDTO` (`packages/shared/src/types.ts`): add `fileModifiedAt: string | null`
  (ISO string). Nullable because `toTrashedPhotoDTO` also produces a `PhotoDTO` and
  `TrashedPhoto` has no such column.
- `toPhotoDTO` (`packages/db/src/mappers.ts`): map
  `row.fileModifiedAt.toISOString()` (always present — the column is `NOT NULL`).
- `toTrashedPhotoDTO`: set `fileModifiedAt: null`.
- The new `Row` renders `photo.fileModifiedAt ?? "—"`, matching the existing "Taken"
  row's raw-ISO style for consistency (prettier date formatting can come later and is
  not part of this change).

## Out of scope

- `birthtime` / file creation date — explicitly rejected above.
- Retroactive `sortDate` correction via backfill — not needed; see migration.
- Prettier date formatting of the "File modified" / "Taken" rows — render the raw value
  for now, matching the current sidebar.

## Migration (wipe + reimport)

The shared Postgres `Photo` table already holds rows, and adding a `NOT NULL` column to
a populated table fails. We empty the table rather than backfill — accepted because the
library is reconstructable from disk and we are early enough that losing DB-only data is
fine.

Single migration:

1. Empty `Photo` and its dependents (`AlbumPhoto`, `TrashedPhoto`).
2. Add `fileModifiedAt DateTime NOT NULL`.
3. Flip `fileMtimeMs` and `fileSize` to `NOT NULL`.

No backfill or nullable-then-alter dance — the table is empty when the columns are
added. After migrating, reimport from disk via the existing scan path.

**Accepted data loss** (DB-only, not reconstructable from file bytes): `edits`
(rotations/crops), `isFavorite`, `colorLabel`, `AlbumPhoto` membership, `source`
provenance, and `createdAt` resets to reimport time. The user has explicitly chosen this
over a data-preserving backfill.

The exact wipe mechanism (existing destructive seed script vs. a one-off) will be
confirmed when writing the implementation plan.

## Testing

- `store.test.ts`: `sortDate` resolves to `fileModifiedAt` when `takenAt` is null; to
  `takenAt` when present. `fileModifiedAt` is written from the supplied mtime.
- `scan.test.ts`: a restamp updates `fileModifiedAt` but leaves `sortDate` and
  `updatedAt` untouched; a real re-import re-derives both `fileModifiedAt` and
  `sortDate`.
- `mappers.test.ts`: `toPhotoDTO` emits `fileModifiedAt` as an ISO string;
  `toTrashedPhotoDTO` emits `fileModifiedAt: null`.
- Existing fingerprint/change-detection tests stay green (float comparison unchanged).
