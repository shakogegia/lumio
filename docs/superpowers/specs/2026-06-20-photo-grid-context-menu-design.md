# Photo grid right-click context menu — design

## Goal

Add a right-click context menu to photos in the grid, offering **Download**,
**Add to album**, **Color label**, and **Delete**, each with a lucide icon.
Built on the shadcn `context-menu` primitive.

## Scope

The menu appears on every "real library photo" grid — the three views that
already share these four actions:

- Library (`/photos`)
- Search (`/search`)
- Album (`/albums/[id]`)

It does **not** appear in Trash. Trash photos are already deleted, so
download / add-to-album / color-label don't apply; Trash keeps its existing
Restore / Delete-permanently toolbar untouched.

## Behavior decisions

- **Selection-aware targeting.** Right-clicking a photo that is part of the
  current multi-selection acts on the whole selection; otherwise it acts on
  just that one photo. The menu never *changes* the selection (right-click is
  not a toggle).
- **Delete confirms.** Menu Delete uses the same confirm dialog as the toolbar
  ("Move N photos to Trash?"), for consistency and because right-click delete
  is easy to hit by accident.
- **Color label** is offered in the menu in all three views — including Album,
  whose toolbar currently has no color-label control. Album's toolbar is left
  as-is; only its context menu gains the action.

## Architecture

The four actions already exist, but as three near-duplicate copies of
`handleDelete` / `handleDownload` / `applyLabel` living at the view level and
operating on the toolbar's `sel.selected`. This design unifies the **core
operation** (network call + optimistic grid update + error toast + pending
guard) into one hook, and leaves each caller's **aftermath** (what happens to
selection / count / route after success) as an explicit per-call callback.

### 1. UI primitive — `components/ui/context-menu.tsx`

Added via the shadcn registry, not hand-authored (repo rule: don't modify
`ui/*`; add via the registry). Run in `apps/web`:

```
pnpm dlx shadcn@latest add @shadcn/context-menu
```

This writes `src/components/ui/context-menu.tsx` (style `radix-maia`) and adds
the `@radix-ui/react-context-menu` dependency.

### 2. Shared action layer — `usePhotoActions`

`apps/web/src/components/photo-actions/use-photo-actions.tsx`

Mirrors the existing `useConfirm` idiom: returns the action functions **and** an
`element` to render once. Selection-agnostic — it only ever receives explicit
id arrays.

```ts
type ActionOpts = { onSuccess?: () => void };

interface PhotoActions {
  download: (ids: string[], opts?: ActionOpts) => Promise<void>;
  applyLabel: (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => Promise<void>;
  trash: (ids: string[], opts?: ActionOpts) => Promise<void>;
  addToAlbum: (ids: string[], opts?: ActionOpts) => void; // opens the dialog
  pending: { download: boolean; label: boolean; trash: boolean };
  element: React.ReactNode; // AddToAlbumDialog + trash confirm dialog, mounted once
}

function usePhotoActions(config: {
  gridRef: React.RefObject<PhotoGridHandle | null>;
  excludeAlbumId?: string;
}): PhotoActions;
```

Internals (each guards on its `pending` flag and toasts on failure):

- **download** → `downloadSelection(ids)` (from `@/lib/download-client`) →
  `onSuccess`.
- **applyLabel** → `POST /api/photos/color-label` `{ photoIds, label }` →
  `gridRef.current?.patchPhotos(new Set(ids), { colorLabel: label })` →
  `onSuccess`. (`patchPhotos` takes a `Set`.)
- **trash** → `confirm({ title: "Move N photos to Trash?", ... destructive })`
  → `POST /api/photos/trash` `{ ids }` →
  `gridRef.current?.removePhotos(new Set(ids))` → `onSuccess`.
- **addToAlbum** → stores `{ ids, onSuccess }` and opens `AddToAlbumDialog`
  (`photoIds = ids`, `excludeAlbumId`); on added, runs `onSuccess` and closes.
- **element** → renders the `useConfirm` dialog element + the
  `AddToAlbumDialog`.

The hook owns the confirm dialog only for its own trash. Album keeps its
separate `useConfirm` for remove-from-album (not one of the four actions);
the two idle AlertDialogs coexist fine since only one opens at a time.

### 3. Delivery to tiles — `PhotoActionsContext`

`apps/web/src/components/photo-actions/photo-actions-context.tsx` (or colocated
with the hook): a context carrying the `PhotoActions` value. Each view wraps
`<PhotoGrid>` in the provider so deeply-nested tiles can reach `actions`.
Toolbars do **not** use the context — they call `actions.*` directly from the
hook return in the same component scope.

`usePhotoActionsContext()` returns the value or `null` when no provider is
present (Trash), which the menu treats as "render no menu".

### 4. The menu — `PhotoContextMenu`

`apps/web/src/components/photo-grid/photo-context-menu.tsx`

Wraps a tile's interactive element as the context-menu trigger:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
  <ContextMenuContent>…</ContextMenuContent>
</ContextMenu>
```

Props: `targetIds: string[]` (already resolved, selection-aware) and
`onTrashed?: () => void` (so the grid can drop trashed ids from the selection).
Reads `usePhotoActionsContext()`.

Items, each with a lucide icon:

- **Download** (`Download`) → `actions.download(targetIds)`
- **Add to album** (`FolderPlus`) → `actions.addToAlbum(targetIds)`
- **Color label** (`Palette`) → `ContextMenuSub` with the `COLOR_LABELS`
  swatches + a separator + **None**, each → `actions.applyLabel(targetIds, slug | null)`
- `ContextMenuSeparator`
- **Delete** (`Trash2`, destructive variant) →
  `actions.trash(targetIds, { onSuccess: onTrashed })`

When `targetIds.length > 1`, a disabled `ContextMenuLabel` header shows
"N photos".

**Graceful absence:** if `usePhotoActionsContext()` is `null`, the component
renders `children` unwrapped — so `PhotoGrid` stays usable in Trash with no
provider.

### 5. Selection-aware targeting + tile integration

A pure helper (unit-tested, alongside `grid-selection`):

```ts
function resolveTargets(selectedIds: Set<string> | undefined, photoId: string): string[] {
  return selectedIds?.has(photoId) ? [...selectedIds] : [photoId];
}
```

`PhotoGrid` already holds `selectedIds` and `onSelectionChange`. It passes each
`PhotoGridTile` the `selectedIds` set and a stable `onTilesTrashed(ids)` that
removes those ids from the selection via `onSelectionChange`. `PhotoGridTile`
computes `targetIds = resolveTargets(selectedIds, photo.id)` and wraps both its
select-mode `<button>` and its link `<a>` in `PhotoContextMenu`, passing
`onTrashed={() => onTilesTrashed(targetIds)}`.

Right-click never toggles selection (contextmenu ≠ click). Left-click,
shift-click, and the link navigation are unchanged — Radix only intercepts the
`contextmenu` event.

### 6. View wiring (Library, Search, Album)

Each view:

1. `const actions = usePhotoActions({ gridRef, excludeAlbumId? });`
2. Renders `{actions.element}` and drops its own `AddToAlbumDialog`,
   delete-confirm usage, and the `downloading` / `deleting` / `labelPending`
   booleans (now `actions.pending.*`).
3. Points toolbar buttons + `ColorLabelMenu` at `actions.*`, **preserving each
   existing aftermath via `onSuccess`**:
   - Library: download `→ sel.clear`; label `→` (none, keep selection);
     add-to-album `→` (none); trash `→ sel.cancel`.
   - Search: same, plus trash `onSuccess` also decrements `searchCount`.
   - Album: download `→ sel.clear`; add-to-album `→` (none); trash `→
     sel.cancel` + `setReloadKey` + `router.refresh()`. Album's toolbar has a
     Download button but no color-label control — leave the label button out;
     color-label appears in the menu only.
4. Wraps `<PhotoGrid>` in `PhotoActionsContext`.

Album keeps its own `useConfirm` + remove-from-album handler unchanged.

### 7. Testing

- **Unit:** `resolveTargets` — in-selection returns the whole set; not-in
  returns the single id; `undefined` selection returns the single id.
- **Browser verification** (per dev-workflow): in each of the three views, in
  both select and non-select mode — open the menu, run each action, confirm
  multi-select targeting (right-click a selected vs unselected photo), the
  delete confirm dialog, optimistic label repaint and tile removal, and that
  Album's add-to-album excludes the current album.

## Files

New:
- `apps/web/src/components/ui/context-menu.tsx` (generated)
- `apps/web/src/components/photo-actions/use-photo-actions.tsx`
- `apps/web/src/components/photo-actions/photo-actions-context.tsx`
- `apps/web/src/components/photo-grid/photo-context-menu.tsx`
- `apps/web/src/lib/resolve-targets.ts` (+ test)

Changed:
- `apps/web/src/components/photo-grid/photo-grid.tsx` (pass `selectedIds` +
  `onTilesTrashed` to tiles)
- `apps/web/src/components/photo-grid/photo-grid-tile.tsx` (wrap in
  `PhotoContextMenu`)
- `apps/web/src/app/(app)/photos/library-view.tsx`
- `apps/web/src/app/(app)/search/search-view.tsx`
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

## Risks / things to preserve

The three toolbars have subtle, already-bug-fixed aftermaths — notably commit
`cc3a95d` "keep selection after color label + add-to-album". The unification
must keep label / add-to-album from clearing the selection, keep download's
`sel.clear`, keep trash's `sel.cancel`, and keep Search's count decrement and
Album's refresh. These are verified individually in step 7.
