# Lumio — Folders (album organization tree) Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Builds on:** albums + smart-albums (#3)

## Goal
Add **folders** as a pure organization layer over albums. Folders form a true tree: every folder and every album has exactly one parent, or sits at the top level. Folders never hold photos directly — they hold sub-folders and albums. Selecting a folder shows the **deduplicated union of all photos from every album anywhere beneath it** (recursive), including smart albums. The existing `/albums` page becomes a hierarchical browser of the current level.

Example: `Europe › Italy › [Rome, Napoli]`. Clicking **Italy** shows Rome + Napoli combined; clicking **Europe** shows the same (recursive).

## Decisions (brainstorm)
1. **Folders organize albums, not photos** — a folder contains sub-folders and albums only.
2. **Nested, any depth** — a folder can contain both sub-folders and albums.
3. **True tree** — each album/sub-folder has exactly one parent (or top level). Moving relocates it. (Photos remain many-to-many with albums, unchanged.)
4. **Recursive aggregated view** — selecting a folder shows all photos from all descendant albums, deduplicated.
5. **Both album types** — regular *and* smart albums can be filed in folders.
6. **Unified hierarchical albums page** — `/albums` shows top-level folders + top-level albums together; drill in with breadcrumbs. No new top-level nav item.
7. **Move via menu *and* drag-and-drop** — a "Move to…" selection-toolbar action plus dragging cards onto folder cards / breadcrumbs. Both reuse the same move backend.
8. **Delete folder — two modes** — "Remove folder only" reparents children to the deleted folder's parent (or top level), nothing lost (default); "Delete folder and all contents" recursively deletes every descendant folder and album (photos survive — albums are virtual). A non-empty folder prompts a choice; an empty folder just deletes.
9. **Albums are renamable** — add rename to albums too (not just folders); a shared rename dialog serves both.

## Data model — `packages/db/prisma/schema.prisma`
New `Folder` model + one nullable column on `Album`. **Adjacency-list** (`parentId`) representation — trees are shallow/small, so closure-table / materialized-path is overkill.

```prisma
model Folder {
  id        String   @id @default(cuid())
  name      String
  parentId  String?                                  // null = top level
  parent    Folder?  @relation("FolderTree", fields: [parentId], references: [id])
  children  Folder[] @relation("FolderTree")
  albums    Album[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([parentId])
}

model Album {
  // ...existing fields...
  folderId String?                                   // null = top level
  folder   Folder?  @relation(fields: [folderId], references: [id])
  @@index([folderId])
}
```

- **No `onDelete: Cascade`** on the `Folder`→children / `Folder`→albums relations — both delete modes (reparent and cascade) are handled explicitly in the service so behavior is intentional, never an implicit FK side effect. Default Prisma referential action (`Restrict`) is fine because the service updates/clears references inside the same transaction before deleting a folder row. (The existing `AlbumPhoto.onDelete: Cascade` is unchanged — that's what lets cascade-deleted albums drop their join rows automatically.)
- Migration must follow the project's DB-migration recipe (Prisma migrate against the dev DB on port 5433; commit the generated migration SQL).

## `@lumio/shared`
New `packages/shared/src/folders.ts`:
- `createFolderSchema` — `{ name: string(1..200), parentId?: string | null }`.
- `renameFolderSchema` — `{ name: string(1..200) }`.
- `moveItemsSchema` — `{ folderIds?: string[], albumIds?: string[], targetFolderId: string | null }` (refine: at least one of `folderIds`/`albumIds` non-empty; `null` target = top level).
- `deleteFolderSchema` — delete mode `{ mode: "reparent" | "cascade" }` (validated from the `?mode=` query param; default `reparent`).

In `packages/shared/src/albums.ts`:
- `renameAlbumSchema` — `{ name: string(1..200) }` (new; albums gain rename).

New DTOs in `packages/shared/src/types.ts`:
- `FolderDTO` = `{ id, name, parentId: string | null, createdAt, updatedAt }`.
- `FolderSummaryDTO` = `FolderDTO & { albumCount: number; childFolderCount: number; totalPhotoCount: number; previewPhotoIds: string[] }` — counts are **recursive/aggregate** (albumCount = albums anywhere beneath; totalPhotoCount = deduped photo count beneath); `previewPhotoIds` = up to 4 cover ids for the folder-card mosaic.
- `FolderContentsDTO` = `{ folder: FolderDTO | null; breadcrumbs: FolderDTO[]; subfolders: FolderSummaryDTO[]; albums: AlbumSummaryDTO[] }` (`folder: null` = top level).

## `@lumio/db`
- `folderPhotoWhere(args: { regularAlbumIds: string[]; smartAlbums: { rules }[] }, now: Date): Prisma.PhotoWhereInput` — pure builder for the recursive aggregated view:
  - `{ OR: [ { albums: { some: { albumId: { in: regularAlbumIds } } } }, ...smartAlbums.map(a => smartAlbumWhere(a.rules, now)) ] }`.
  - empty inputs → never-match clause (`{ id: { in: [] } }`).
  - **Reuses `smartAlbumWhere`** from `packages/db/src/smart-albums.ts` verbatim. Dedup is inherent (a photo matching multiple OR branches is one row).
- `toFolderDTO(row)` mapper in `packages/db/src/mappers.ts`.
- Descendant-set computation lives in the service (loads all folders once — cheap — and walks the tree in memory) rather than a recursive SQL CTE, keeping it Prisma-native and unit-testable.

## Service — `apps/web/src/lib/folders-service.ts`
Mirrors `albums-service.ts` (injectable `db` param, custom error classes `FolderNotFoundError`, `FolderCycleError`).
- `listFolderContents(folderId: string | null, db?)` → `FolderContentsDTO` — direct child folders (as summaries) + direct child albums (reuse album-summary shaping) + breadcrumbs. `404`/null if `folderId` given but missing.
- `getFolder(id, db?)` → `FolderDTO | null`.
- `createFolder({ name, parentId }, db?)` → `FolderDTO` (validates `parentId` exists if given).
- `renameFolder(id, name, db?)` → `FolderDTO`.
- `deleteFolder(id, mode: "reparent" | "cascade", db?)` → void — **transaction** (`FolderNotFoundError` if missing):
  - `reparent`: load `folder.parentId`; `update many` direct child folders' `parentId` and child albums' `folderId` to `folder.parentId`; delete the folder row.
  - `cascade`: collect the full descendant folder-id set + descendant album-id set (in-memory walk); `deleteMany` those albums (their `AlbumPhoto` rows cascade via the existing `onDelete: Cascade`), then `deleteMany` the descendant folders and the folder itself. Photos are untouched.
- `moveItems({ folderIds, albumIds, targetFolderId }, db?)` → count — **cycle guard**: a folder may not move into itself or any descendant (compute descendant set of each moved folder; reject if target ∈ it) → `FolderCycleError`. Validate target exists (if non-null). Set `parentId`/`folderId` accordingly in a transaction.
- `listFolderPhotos(id, params, db?)` → `PhotosPage | null` — compute descendant album ids (split regular/smart), build `folderPhotoWhere`, then reuse the exact sort / cursor pagination / month-filter plumbing from `listAlbumPhotos`. `null` if folder missing.
- `folderPhotosForDownload(id, db?)` → `{ id, path }[] | null` — optional, mirror `listAlbumPhotosForDownload` (defer if not needed for first pass).

Helper: `collectDescendantFolderIds(allFolders, rootId)` (pure, unit-tested) and `collectDescendantAlbums(...)`.

In `apps/web/src/lib/albums-service.ts` (existing):
- `renameAlbum(id, name, db?)` → `AlbumDTO` (new; `AlbumNotFoundError` if missing).

## Web API (Node runtime, `withAuth`, Zod-validated) — `/api/folders`
- `GET  /api/folders?parentId=<id|>` → `FolderContentsDTO` (omit/empty `parentId` = top level). SSR pages call `listFolderContents` directly; this route serves client-side refreshes and the move-picker.
- `POST /api/folders` `{ name, parentId? }` → `FolderDTO` (201).
- `GET  /api/folders/[id]` → `FolderContentsDTO` (404 if missing).
- `PATCH  /api/folders/[id]` `{ name }` → `FolderDTO` (rename).
- `DELETE /api/folders/[id]?mode=reparent|cascade` → 204 (default `reparent`; `cascade` deletes contents).
- `GET  /api/folders/[id]/photos?limit=&cursor=&month=` → `PhotosPage` (recursive aggregated; 404 if missing).
- `POST /api/folders/move` `{ folderIds?, albumIds?, targetFolderId }` → `{ count }` (400 on cycle).

New album route:
- `PATCH /api/albums/[id]` `{ name }` → `AlbumDTO` (rename; 404 if missing).

## Web UI
- **`/albums` (+ `/albums/folder/[id]`)** — the page resolves the current folder (root or `[id]`) via SSR `listFolderContents` and renders **folder cards + album cards together**, with **breadcrumbs** (`Albums › Europe › Italy`). Reuse the existing albums grid/card layout (`AlbumsView`, grid-size/sort hooks) — folders just add a card variant.
  - **`FolderCard`** — folder glyph + up to 4 preview thumbnails (`previewPhotoIds` → `/api/thumbnails/:id`) + name + counts ("3 albums · 412 photos"). Click drills in; selection toggles like album cards.
  - Toolbar **"New Folder"** beside "New Album" (`NewFolderDialog`: name input → `POST /api/folders` with current `parentId` → `router.refresh()`). New albums created here also inherit the current `folderId`.
  - Folder card context/selection action **"View all photos"** → the recursive aggregated grid (`/api/folders/[id]/photos`), reusing `PhotoGrid` with the folder photos endpoint (and the existing calendar/month filter where applicable).
  - **Rename** action (shared `RenameDialog`) on **both** folder cards (`PATCH /api/folders/[id]`) and album cards (`PATCH /api/albums/[id]`).
  - **Delete folder** → confirm dialog: an empty folder deletes immediately; a non-empty folder offers **"Remove folder only (keep albums)"** (`?mode=reparent`) vs **"Delete folder and all contents"** (`?mode=cascade`, destructive styling) → `router.refresh()`.
- **`MoveToFolderDialog`** — opened from the selection toolbar "Move to…" on any mix of selected albums/folders. A tree picker of folders + "Top level"; disables the moved folders and their descendants (mirrors the cycle guard). Submit → `POST /api/folders/move` → refresh.
- **Drag-and-drop** (`@dnd-kit/core`, new `apps/web` dep; pointer + touch + keyboard sensors):
  - Every folder/album card is a draggable; every **folder card** and **breadcrumb segment** (including the "Albums" root → top level) is a drop target.
  - Multi-select aware: dragging a card that's in the current selection moves the whole selection, else just that card. A `DragOverlay` shows a count badge.
  - On `dragStart`, compute the invalid-target set (each dragged folder + its descendants, plus each item's current parent → no-op); those targets don't highlight and reject drops — mirrors the server `FolderCycleError`.
  - On a valid drop → `POST /api/folders/move` → `router.refresh()`. Same backend as the menu; "Move to…" stays as the accessible/bulk fallback.
- **Sidebar** — the "Albums" hover flyout (`sidebar-albums.tsx`) surfaces **top-level folders** (navigating into the folder view) alongside top-level albums. Full nested tree in the flyout is out of scope.

## Error handling
- Zod failures → 400; missing folder → 404; move cycle → 400 (`FolderCycleError`); delete is idempotent-ish (404 if already gone).
- All multi-row mutations (delete-reparent, delete-cascade, move) run in a transaction.

## Testing
- **shared:** Zod schemas (`createFolderSchema` parent null/string; `moveItemsSchema` refine requiring at least one of folderIds/albumIds; `renameAlbumSchema`/`renameFolderSchema` length bounds; `deleteFolderSchema` mode default).
- **db:** `folderPhotoWhere` (regular only, smart only, mixed, empty → never-match) with a fixed `now`.
- **web (fake db):** `collectDescendantFolderIds` (deep tree, branching, single node); `deleteFolder` `reparent` moves children to grandparent (top level when parent is null); `deleteFolder` `cascade` removes all descendant folders + albums but leaves photos; `moveItems` cycle guard rejects self/descendant target; `renameAlbum`/`renameFolder` happy-path + not-found; `listFolderContents` shaping (breadcrumbs, recursive counts); `listFolderPhotos` dedup + pagination shape across regular + smart descendants.
- **gate:** `pnpm -r test` + `pnpm --filter @lumio/web build` green; browser-verify: create folder "Europe", create sub-folder "Italy", **drag** albums "Rome" & "Napoli" onto Italy (and verify "Move to…" menu works too), confirm Europe card counts are recursive, click Europe → "View all photos" shows Rome+Napoli deduped, rename an album, delete Italy with **"Remove folder only"** → Rome & Napoli reparent up to Europe (not lost), then delete a test folder with **"Delete folder and all contents"** → its albums gone, photos still present in the main grid.

## Non-goals (first pass)
Per-folder cover selection · putting photos directly into folders · full nested tree inside the sidebar flyout · folder-level download (deferred).
