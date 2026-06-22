# `/folders` redesign — album-style folder cards + selection + calendar

**Status:** Approved (design) · **Date:** 2026-06-23 · **Branch:** `gego/sidebar-file-browser` (PR #76)

## Summary

Bring the disk `/folders` page up to the `/albums` look & feel: replace the plain folder tiles with **album-style folder cards** (2×2 cover mosaic + a "N photos" count), make them **selectable the same way as `/albums`** (ring, click / ⌘-click / shift-range, double-click/Enter to open), and add the **month calendar** to the photos. The photos keep using the shared `PhotoLibraryView`; the folders render in its `aboveGrid` slot.

Folder selection is **separate** from photo selection (disjoint action sets) and is shown **inline** (count + Cancel) above the Folders section. The filesystem **rename / move / delete actions are deferred** — the selection UI is built so they can be wired later; no destructive filesystem mutations land now.

## Decisions (locked during brainstorming)

- **Reuse:** photos stay on `PhotoLibraryView`; the Folders section goes in `aboveGrid`. No bespoke re-composition of the grid.
- **Folder cards:** full `/albums` treatment — 2×2 cover mosaic (recursive, by `dirPath` prefix) + name + a recursive **"M photos"** count.
- **Selection:** folders selectable like `/albums` (`SelectionRing` + single-click selects, ⌘/Ctrl-click toggles, shift-click ranges, within the Folders section). Double-click / Enter opens; each card is a real `<Link>` (middle-click / open-in-new-tab work). Folder selection is **separate** from the photo grid's selection.
- **Selection chrome:** **inline** — a small "N selected · Cancel" bar above the Folders section (not a sticky-header takeover), since there are no folder actions yet. (Keeps `/folders` on `PhotoLibraryView`.)
- **Actions deferred:** filesystem rename / move / delete are NOT implemented; the selection exists for them to hang off later.
- **Counts:** the folder cards' cover mosaic + photo count are **recursive** (include nested subfolders' photos), matching `/albums`. The photo grid + calendar stay **direct** (the folder's own photos only) — see §D.
- **Calendar:** add a month calendar to `/folders` (new `/fs/calendar` facets + `month` on `/fs/photos`).

## A. Folder summary data (server)

Replace `listSubfolders(catalog, rel) → {name, rel}[]` with `listSubfolderSummaries(catalog, rel) → FolderSummary[]`:

```ts
interface FolderSummary {
  name: string;
  rel: string;
  photoCount: number;        // recursive: photos whose dirPath is `rel` or under `rel/`
  previewPhotoIds: string[]; // ≤4 cover ids (canonical photoOrderBy), recursive
}
```

- Immediate subfolders still come from one `readdir` of `rel` (filesystem — includes subdirs with no indexed photos).
- `photoCount` + `previewPhotoIds` come from the indexed `Photo.dirPath` column, **batched** (no per-folder fs walk):
  - Counts: `groupBy(dirPath)` over `dirPath` starting with `rel/` (plus exact `rel`), summed into each immediate subfolder's subtree.
  - Previews: a single bounded, `photoOrderBy`-ordered query over the same prefix, bucketed in JS by immediate subfolder, taking ≤4 each.
  - (Exact query strategy is finalized in the plan; the key is "DB `dirPath`, batched, no N+1 fs walk.")
- A subfolder with no indexed photos → `photoCount: 0`, `previewPhotoIds: []` (card shows the folder icon, like `/albums`' empty-folder mosaic).
- `listSubfolderSummaries` keeps the `originalPath` traversal guard + injectable deps for tests.

## B. Folder card + Folders section (client)

- **`DiskFolderCard`** (`folders/disk-folder-card.tsx`): matches the `/albums` `FolderCard` cover treatment — a 2×2 mosaic of `previewPhotoIds` thumbnails (`/photos/:id/thumbnail`), or a folder icon when empty — plus the folder name and `countLabel(photoCount, "photo", "photos")`. Props: `{ slug, folder, isSelected, onSelect(rel, e), onOpen(rel) }`. Wrapped in `<SelectionRing>`; the card is an `<a href={folderHref}>` with `onClick`→select (preventDefault on plain left-click, so ⌘/shift modifiers still reach `onSelect`), `onDoubleClick`→open — mirroring `FolderCard`/`AlbumCard`.
- **`FoldersSection`** (rewritten): heading "Folders" + folder count; an inline selection bar ("N selected" + Cancel) shown when `selected.size > 0`; a responsive CSS grid of `DiskFolderCard`s. Owns folder selection via `useGridSelection` + `useGridSelectionNav` (reused from `/albums`), keyed by `rel`. `onOpen(rel)` → `router.push(/folders?path=rel)`.
- Reuse `SelectionRing`, `useGridSelection`, `useGridSelectionNav` verbatim (they're generic). The folder grid uses a fixed responsive layout (`repeat(auto-fill, minmax(…))`), NOT the photo grid's `useGridColumns` store — folder density is intentionally not user-adjustable (out of scope).

## C. Page composition

`folder-explorer.tsx` keeps using `PhotoLibraryView` for photos and passes the new Folders section as `aboveGrid`:

```tsx
<PhotoLibraryView
  title={<FolderBreadcrumb slug={slug} rel={rel} />}
  aboveGrid={<FoldersSection slug={slug} rel={rel} folders={summaries} />}
  calendar={{ facetsEndpoint: catalogApiUrl(slug, `/fs/calendar?path=${encodeURIComponent(rel)}`) }}
  collection={({ sort, month }) => ({
    endpoint: catalogApiUrl(slug, "/fs/photos"),
    params: new URLSearchParams(month ? { path: rel, sort, month } : { path: rel, sort }),
    urlForId: (id) => /* detailScopeQuery folder scope, unchanged */,
    baseUrl: /* /folders?path=rel, unchanged */,
    key: `folder:${rel}:${sort}:${month ?? ""}`,
  })}
/>
```

`page.tsx` calls `listSubfolderSummaries` instead of `listSubfolders` and passes the summaries.

## D. Calendar on `/folders`

**Direct vs. recursive — the one rule:** the photo *grid* shows only the folder's **direct** photos (`dirPath === rel`), exactly as today. The calendar facets must match the grid, so they are also **direct**. Recursion applies ONLY to the folder *cards'* covers + counts (a card affordance, §A), never to the grid or calendar.

- New route `GET /api/c/[catalog]/fs/calendar?path=<rel>` → `buildCalendarFacets(catalog.id, { dirPath: rel })`, gated by the disk-explorer feature (same gate as `/fs/photos`). Direct `dirPath` match, matching the grid.
- `/fs/photos`: add `month` support — when present, narrow the existing `{ dirPath: rel }` where with the month's `sortDate` range (reuse the same month→range helper the `/photos` route uses). No change to the recursion behavior (still direct).
- Enable `calendar` in `folder-explorer.tsx` (shown in §C). `month` flows into the `collection` params + `key`; `PhotoLibraryView` owns the month state.

## E. Reuse / cleanup
- Reuse from `/albums`: `SelectionRing`, `useGridSelection`, `useGridSelectionNav`, `countLabel`, the `Section`-style heading + grid pattern, `SelectionToolbar` is NOT used (inline bar instead).
- `listSubfolders` → `listSubfolderSummaries` (rename + enrich); update its test.
- No changes to `PhotoLibraryView`, the photo scope, or `photo-mutations`.

## F. Testing
- Unit: `listSubfolderSummaries` (fake readdir + fake `findIndexedPhotos`/groupBy deps) — counts/previews per subfolder, recursive prefix, traversal block, empty-folder case. `dirPathPrefixWhere` pure helper. Keep `detail-scope`/`locate` tests green.
- Browser: `/folders` — folder cards show covers+counts; single-click selects (ring), ⌘/shift multi-select, double-click/Enter opens; inline "N selected · Cancel"; photo grid + lightbox + bulk toolbar unaffected; month calendar filters the photos.
- Gates: `pnpm -r test`; `tsc` (ignore `calendar.ts`); eslint clean for changed files; `@lumio/web build`.

## G. Out of scope / deferred
- Filesystem **rename / move / delete** of folders (+ their dialogs/APIs) — the selection UI is the hook; actions land later.
- Folder-card density control; drag-to-move; per-subfolder `subfolderCount` on the card (photo count only for v1).
- Header-takeover selection toolbar for folders (revisit when actions land).
