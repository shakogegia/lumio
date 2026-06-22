# Photo action consolidation + reusable PhotoLibraryView + folder explorer grid

**Status:** Approved (design) · **Date:** 2026-06-22 · **Branch:** `gego/sidebar-file-browser` (PR #76)

## Summary

Three coordinated refactors, done **together** (not as separate follow-ups) so the codebase doesn't end up half-migrated:

1. **One network call per photo mutation.** Today favorite/trash/add-remove-album each have their fetch written in 2–3 places (bulk grid path vs. lightbox vs. dialog). Consolidate every mutation into a single `photo-mutations.ts` module and route every caller through it.
2. **One reusable grid view.** Five views (`library`, `album`, album `folder-photos`, `favorites`, `search`, `trash`) re-implement the same composition. Extract `PhotoLibraryView` (+ a shared `SelectionActions` button set) and migrate the four that share its action set: `library`, `album`, album `folder-photos`, `favorites`.
3. **Folder explorer = the real grid.** Rebuild `/folders` into two sections — **Folders** and **Photos** — where Photos is the real `/photos` experience scoped to the folder (selection, ⌘-click, double-click→lightbox, context menu, bulk toolbar). Anything that isn't a subfolder or an indexed photo is not shown.

Goal stated by the user: **reuse as much as possible, clean code, do it correctly now.**

## Decisions (locked during brainstorming)

- Photos section = the real `/photos` view scoped to the folder; grid size/sort/view come from the **global** grid controls (shared, like the album view).
- **Action consolidation is in scope here** (not deferred): the lightbox, per-tile heart, and add-to-album dialog route through the same mutation module as the bulk actions.
- **Dedupe breadth = B2 + favorites:** migrate `library-view`, `album-view`, album `folder-photos-view`, `favorites-view` onto `PhotoLibraryView`. Leave `search-view` and `trash-view` for later (divergent toolbars/actions).
- **`favorites` becomes a `DetailScope` kind**, so all four migrated views build on the scope system uniformly (and the favorites lightbox strip walks favorites).
- Folder breadcrumb mirrors the **albums** header trail (root link + `ChevronRight` + crumb links, last plain) in the `HeaderBar` title slot.
- **Drop** the recursive folder search and the entire "unsupported files" section. Only subfolders + indexed photos appear.
- **Folder scope simplifies** to `{ kind:"folder"; dir; sort: PhotoSort }` (no `fsort`); film strip uses standard `photoOrderBy` + the generic cursor (no special folder branch in `locate-photo`).

---

## Phase 1 — Single source per photo mutation

**New module `apps/web/src/lib/photo-mutations.ts`** (client): one thin function per mutation, each issuing exactly one `fetch` to the existing endpoint and returning the parsed result or throwing. **No** optimistic UI, toast, sound, or router.refresh here — callers keep those (they differ by context). This is purely the network layer.

```ts
favoritePhotos(slug, ids: string[], isFavorite: boolean): Promise<void>      // POST /photos/favorite
setPhotoColorLabel(slug, ids: string[], label: ColorLabel | null): Promise<void> // POST /photos/color-label
trashPhotos(slug, ids: string[]): Promise<void>                              // POST /photos/trash
addPhotosToAlbum(slug, albumId, ids: string[]): Promise<void>               // POST /albums/:id/photos
removePhotoFromAlbum(slug, albumId, photoId): Promise<void>                 // DELETE /albums/:id/photos/:photoId
createAlbum(slug, name: string): Promise<{ id: string }>                    // POST /albums
```

**Route every existing caller through it** (keeping each caller's own optimistic patch + toast + sound + refresh):
- `use-photo-actions.tsx` — favorite, color-label, trash, addToAlbumDirect.
- `use-favorite.ts` (`useToggleFavorite`) — favorite (per-tile heart, lightbox `F`).
- `lightbox-actions.tsx` — trash.
- `use-add-to-album.tsx` — addToAlbumDirect.
- `add-to-album-dialog.tsx` — create album + add.
- `lightbox-sidebar.tsx` — add/remove album ("Appears in" list).

No endpoint or behavior changes; this is invisible to users. Tests: `photo-mutations.test.ts` asserts each function's method/URL/body via a mocked `fetch`.

> Note: `download` is already single-sourced (`download-client.ts`); leave it. `color-label` currently lives only in `usePhotoActions` but moves into the module for uniformity.

---

## Phase 2 — `PhotoLibraryView` + shared actions + 4 migrations

### `PhotoLibraryView` — `apps/web/src/components/photo-library/photo-library-view.tsx`

```tsx
export interface PhotoLibraryViewProps {
  // PhotoLibraryView owns useGridSort, so it builds the scope from the current
  // sort — keeping grid order, film strip, and detail href in agreement.
  makeScope: (sort: PhotoSort) => DetailScope;
  title: React.ReactNode;                       // plain text or the breadcrumb trail
  noun?: [singular: string, plural: string];    // default ["photo","photos"]
  empty?: React.ReactNode;                      // default generic "No photos yet"
  actionOptions?: {                             // forwarded to usePhotoActions
    excludeAlbumId?: string;
    albumCover?: { albumId: string; coverPhotoId: string | null };
    onTrashed?: (ids: string[]) => void;
    dropOnUnfavorite?: boolean;
    trashDescription?: string;
  };
  aboveGrid?: React.ReactNode;                  // between toolbar and grid (folders section)
}
```

Encapsulates exactly what the five views duplicate: `useGridSelection` + `useGridView/Columns/Sort` + the `HeaderBar`↔`SelectionToolbar` swap + `PhotoCollectionProvider` (keyed on the resolved scope) + `PhotoActionsProvider` + `CollectionTotalReporter` + `PhotoGrid` + `Lightbox` + `GridShortcuts`. Subtitle = `countLabel(total, ...noun)` with a skeleton while loading.

### Shared action UI — `SelectionActions`

`apps/web/src/components/photo-actions/selection-actions.tsx` renders the **standard bulk-button set** (FavoriteButton, ColorLabelMenu, AddToAlbumMenu, Download, Trash) given `{ actions, selectedIds, gridRef }`, centralizing the repeated `computeFavoriteTarget(gridRef.getPhotos(selected))` wiring. `PhotoLibraryView` renders `<SelectionToolbar … actions={<SelectionActions …/>} />`. Combined with Phase 1, each action is defined once for the toolbar, once for the context menu (`photo-context-menu`, unchanged), and the *network* once (Phase 1).

Also **move `selection-toolbar.tsx`** from `app/(app)/.../photos/` into `components/photo-actions/` (the migrated views currently cross-import it from the photos route).

### `favorites` DetailScope kind

Add to `detail-scope.ts`: `{ kind:"favorites"; sort: PhotoSort }`; `collectionForScope` → endpoint `/photos?favorite=true&sort=…`, baseUrl `/favorites`; `locate-photo` `scopeWhereFor` → `{ isFavorite: true }`. So `favorites-view` migrates as `makeScope={(sort)=>({kind:"favorites",sort})}`.

### Migrate four views (preserve current behavior exactly)

- `photos/library-view.tsx` → `makeScope=(sort)=>({kind:"library",sort})`, title "Photos".
- `albums/[id]/album-view.tsx` → `makeScope=(sort)=>({kind:"album",albumId,sort})`, title = album name, `actionOptions:{ albumCover, excludeAlbumId, onTrashed }`; keep smart-album read-only nuance.
- `albums/folder/[id]/photos/folder-photos-view.tsx` → `makeScope=(sort)=>({kind:"album",albumId,sort})`, title = folder name, `actionOptions:{ onTrashed: router.refresh }`.
- `favorites/favorites-view.tsx` → `makeScope=(sort)=>({kind:"favorites",sort})`, title "Favorites", favorites `empty`, `actionOptions:{ dropOnUnfavorite:true }`.

⚠️ If any of these needs something `PhotoLibraryView` can't express cleanly via props, **stop and report** — leave that view unmigrated rather than bending the component.

---

## Phase 3 — The `/folders` page

```tsx
<PhotoLibraryView
  makeScope={(sort) => ({ kind: "folder", dir: rel, sort })}
  title={<FolderBreadcrumb slug={slug} rel={rel} />}
  empty={/* folder-aware Empty */}
  aboveGrid={<FoldersSection slug={slug} dirs={subfolders} />}
/>
```

- **Server page** gates via `isFeatureEnabled`, lists immediate **subfolders** for `rel` (filesystem), passes them + `rel` to the client explorer. No file listing/stat/photo-match.
- **`FolderBreadcrumb`** mirrors the albums trail, from `catalogBreadcrumbs(rel)`; root "Library" → `/folders`, segments → `?path=`, last plain.
- **`FoldersSection`** — heading "Folders" + count; subfolder tiles (icon + name) → `/folders?path=childRel`; sorted by name; hidden if none. (Optional per-subfolder photo count via a `dirPath` group query — defer to plan.)
- One window scroll: sticky toolbar, then `aboveGrid` (folders), then the window-virtualized grid.

### Scope simplification + cleanup
- `detail-scope.ts`: folder variant → `{ kind:"folder"; dir; sort }` (drop `fsort` from type/parse/serialize/`RawSearchParams`).
- `photo-collection-scope.ts`: folder params → `{ path, sort }`.
- `api/.../fs/photos/route.ts`: `where { dirPath }`, `orderBy photoOrderBy(sort)`.
- `locate-photo.ts`: delete the special folder branch; `scopeWhereFor` folder → `{ dirPath: scope.dir }` (generic cursor handles indexing).
- `photos-service.ts`: revert `listPhotosForWhere` to `(catalogId, where, { limit, offset, sort })` using `photoOrderBy` (it backs the `/fs/photos` folder endpoint). The `favorites` scope needs nothing new — it points at the existing `/photos?favorite=true` list (`PhotosQuery.favorite`).
- `photo-order.ts`: remove `folderPhotoOrderBy`.

### Removals (last round's folder-specific UI/state)
- Delete `lib/folder-prefs.ts` (+test), `lib/use-folder-prefs.ts`.
- Delete `api/.../fs/search/route.ts`; remove `searchCatalogTree` + `CatalogSearchResult` from `catalog-fs-service.ts`.
- Replace `readCatalogDir` (dirs+files+stat+photo-match+counts) with a lean **`listSubfolders(catalog, rel)`** (one traversal-guarded `readdir`, returns sorted `{name, rel}[]`). Drop dead `catalog-fs.ts` pieces: `buildCatalogListing`, `folderCountLabel`, `sortFolderItems`, `FolderSort`/`FolderSortField`/`FolderSortDir`, `folderSortToParam`, `parseFolderSortParam`, and `CatalogListing`/`CatalogFileChild`/`RawEntry`/`DirChildCounts` (+ their tests). Keep `joinRel`, `catalogBreadcrumbs` (+ `FsCrumb`).
- `folders/page.tsx`: stop reading the folder-prefs cookie; render breadcrumb + `FoldersSection` + `PhotoLibraryView`.

**Keep:** `Photo.dirPath` + migration, `parentDir` (shared), gated `/folders` page + `/api/.../fs/photos` + Folders sidebar item (FeatureGate), `listSubfolders`.

---

## Implementation order (each phase independently verifiable)

1. **Phase 1** (mutation module + reroute callers) — pure refactor, no UX change. Verify: tests + every existing view still favorites/trashes/adds-to-album in browser.
2. **Phase 2** (`PhotoLibraryView` + `SelectionActions` + move toolbar + favorites scope + migrate 4 views) — verify each migrated view matches its old behavior.
3. **Phase 3** (folders page + scope simplify + cleanup/removals) — verify the new `/folders`.

Doing Phase 1 first means Phases 2–3 build on already-DRY actions.

## Testing & verification
- Unit: `photo-mutations` (method/URL/body per fn, mocked fetch); `catalog-fs` `joinRel`/`catalogBreadcrumbs`; `paths.parentDir`; `detail-scope` folder + favorites parse/serialize (no `fsort`); `listSubfolders` (fake readdir + traversal block); `locate-photo` generic path + folder `{dirPath}` + favorites `{isFavorite}`.
- `PhotoLibraryView` verified via the four migrated views + browser pass on `/photos`, an album, an album-folder, favorites, and `/folders` (folders navigate; grid select/lightbox/context-menu/bulk actions; film strip = folder siblings; counts; empty states).
- Gates: `pnpm -r test`; `tsc` (ignore pre-existing `calendar.ts`); eslint clean for changed files; `@lumio/web build`.

## Out of scope / deferred
- Migrating `search-view` and `trash-view` onto `PhotoLibraryView` (divergent action sets).
- Recursive folder search (removed here).
- Surfacing supported-but-unindexed images.
