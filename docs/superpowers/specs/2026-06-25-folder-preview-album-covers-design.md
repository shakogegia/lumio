# Folder preview thumbnails prioritize inner albums' covers

## Problem

On `/albums`, a folder card shows a 2×2 preview mosaic (`folder.previewPhotoIds`).
Today that mosaic is just the **4 most-recent photos across the folder's whole
subtree** (`folderSummary` in `folders-service.ts`, `orderBy: PHOTO_ORDER, take: 4`).
It ignores album boundaries, so a folder with five albums can show four photos all
from a single album — an unrepresentative preview.

## Goal

The folder mosaic should **lead with the covers of the albums inside the folder**,
then fall back to recent photos only to fill any remaining cells.

## Decisions (from brainstorming)

- **Scope:** recursive — all albums in the folder's subtree, **direct child albums
  first, then albums in nested subfolders** (option B).
- **Within a tier:** order by album `createdAt` ascending — the same canonical
  album order used by `listAlbumSummaries` (the sidebar tree).
- **Fallback:** if fewer than 4 album covers are available (few albums, or albums
  whose cover is `null` because they're empty), top up the remaining cells with the
  most-recent loose photos in the subtree (today's behavior), **deduplicated** so a
  photo that is already shown as an album cover is never repeated.
- A folder with **zero** album covers behaves exactly as today (4 recent photos).

## Design

### Album cover, single-sourced (`albums-service.ts`)

The album-cover rule (pinned cover while still a member → else most-recent member;
smart albums → newest rule-match) currently lives inline in `albumSummary`. Extract
it so folder previews resolve covers identically:

- `albumCoverId(catalogId, row, db, now): Promise<string | null>` — the effective
  cover for one album row.
- `albumCoverMap(catalogId, rows, db, now): Promise<Map<string, string | null>>` —
  covers for many albums in one parallel pass.
- `albumSummary` is refactored to call `albumCoverId` (no behavior change; same
  underlying queries, so existing tests stay green).

### Folder preview (`folders-service.ts`)

- `listFolderContents` fetches albums with `orderBy: { createdAt: "asc" }` and builds
  one `albumCoverMap` for the whole catalog, passed down to each `folderSummary`
  (covers computed once, reused across folders).
- New helper `subtreeAlbumsForPreview(allAlbums, folderId, descendantIds)` returns
  the subtree's albums ordered direct-children-first then nested, preserving the
  incoming `createdAt asc` order as the within-tier tiebreak.
- `folderSummary` builds `previewPhotoIds`:
  1. Walk the ordered subtree albums, take each album's cover from the map, dedupe,
     stop at 4.
  2. If still < 4, query the most-recent subtree photos (`PHOTO_ORDER`) excluding the
     already-chosen ids (`id: { notIn }`), and append until the mosaic holds 4. A
     defensive cap keeps the result at ≤4 regardless of how many the fill returns.
- `totalPhotoCount` query is unchanged.

No DTO/type changes (`previewPhotoIds: string[]` already carries up to 4 ids) and no
client/component changes — `folder-card.tsx` keeps rendering the same array.

## Testing

`folders-service.test.ts` additions:
- Preview leads with album covers (direct then nested), then fills with recent photos.
- A recent photo equal to an album cover is deduped, not repeated.
- 4+ album covers → no recent-photo fill.
- Empty-album / no-cover folders still fall back to recent photos.

Existing `folders-service.test.ts` and `albums-service.test.ts` must stay green.
