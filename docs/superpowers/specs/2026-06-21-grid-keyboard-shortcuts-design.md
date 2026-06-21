# Grid keyboard shortcuts — design

## Goal

Add three keyboard shortcuts to the photo **grid** views (not the open lightbox):

- **`f`** — toggle favourite for the current selection. Works on **any** selection
  size ≥ 1 (single or multiple).
- **`Enter`** — open the selected photo's detail (lightbox) on the **Info** tab.
  Only when **exactly one** photo is selected.
- **`e`** — open the selected photo's detail on the **Edit** tab. Only when
  exactly one photo is selected.

The lightbox itself already has its own keyboard handling (`f` toggles the open
photo's favourite, arrows navigate, Escape closes, ⌘Z/⌘⇧Z undo/redo) and a
permanently-visible Info/Edit/EXIF sidebar — it is unchanged by this work except
for the small "open on a given tab" addition below.

## Scope

Applied to the five grid views that share the same wiring (a `useGridSelection`
selection, a `usePhotoActions` favourite action, and a `PhotoCollectionProvider`
whose `open(index)` launches the lightbox):

- Library (`/photos`)
- Favorites
- Album (`/albums/[id]`)
- Search
- Folder photos (`/albums/folder/[id]/photos`)

**Trash is excluded** — it has no lightbox detail view and no favourite action.

## Components

### New: `GridShortcuts`

`apps/web/src/components/photo-grid/grid-shortcuts.tsx` — a client component that
renders `null` and installs a single document-level `keydown` listener. It mirrors
the existing `useLightboxKeyboard` pattern: the listener is registered once and
reads the latest props/handlers through a `ref` so it never re-binds.

Props:

```ts
{ selectedIds: Set<string> }
```

Internally it reads:

- `usePhotoCollection()` → `open`, `getLoadedIds`, `getPhotos`, `openIndex`
- `usePhotoActionsContext()` → `favorite`

It is rendered inside both providers in each view, next to `<PhotoGrid />`:

```tsx
<GridShortcuts selectedIds={sel.selected} />
```

#### Key handling

| Key     | Condition              | Action                                                                       |
| ------- | ---------------------- | ---------------------------------------------------------------------------- |
| `f`     | `selectedIds.size ≥ 1` | `favorite([...ids], computeFavoriteTarget(getPhotos(ids)))`                   |
| `Enter` | `selectedIds.size === 1` | resolve index via `getLoadedIds().indexOf(id)`, then `open(index)`         |
| `e`     | `selectedIds.size === 1` | resolve index, then `open(index, { tab: "edit" })`                         |

`computeFavoriteTarget` is the existing smart-toggle from `@lumio/shared`
(favourite all unless every selected photo is already favourited, in which case
unfavourite all) — the exact behaviour of each view's toolbar Favourite button.

#### Guards (apply to every key)

The handler returns early — doing nothing — when any of these hold:

- `openIndex !== null` — the lightbox is open and owns the keyboard.
- A modifier is held (`metaKey || ctrlKey || altKey || shiftKey`), so browser/OS
  shortcuts such as ⌘E pass through untouched. (Matches the lightbox's `f`
  handler, which also requires no modifiers.)
- `e.repeat` — ignore auto-repeat from a held key.
- Focus is in a text-entry context: `document.activeElement` is an
  `HTMLInputElement` / `HTMLTextAreaElement`, or the target is `contentEditable`
  (covers the search box, EXIF search, album-name fields, etc.).
- A Radix overlay is open: `document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]')`
  — the same check `useGridSelection` uses for Escape.

For **`Enter`**, the handler calls `e.preventDefault()` so a focused tile anchor
doesn't also activate its `href` (a grid tile is an `<a>`; Enter on a focused
anchor would otherwise fire a click → toggle selection).

For `Enter`/`e` with `size !== 1` (zero or 2+ selected): no-op. For `f` with an
empty selection: no-op.

### Changed: open the lightbox on a chosen tab

The sidebar's `<Tabs>` is currently uncontrolled (`defaultValue="info"`). Thread
a requested tab through the existing open path so `e` can land on Edit:

- **`photo-collection.tsx`**
  - `PhotoCollectionValue.open` becomes
    `open(index: number, opts?: { tab?: LightboxTab }) => void`.
  - Add `openTab` state (a `LightboxTab`, default `"info"`). Every `open` call
    sets it: `setOpenTab(opts?.tab ?? "info")`. Because it always resets to
    `"info"` unless a tab is given, double-click, film-strip jumps, and deep-link
    opens stay on Info.
  - Expose `openTab` on the context value.
- **`lightbox.tsx`** — read `openTab` from the collection and pass it to
  `LightboxSidebar`.
- **`lightbox-sidebar.tsx`** — accept an `initialTab` prop and use it as the
  `<Tabs>` `defaultValue`. `defaultValue` is read only on mount; the sidebar
  mounts fresh on each open-from-grid (closed → open) but is **not** remounted
  during arrow/film-strip navigation, so this sets the initial tab without
  clobbering a manual tab switch made mid-session.

`LightboxTab` is a small union type `"info" | "edit" | "exif"`. Define it once
(in `lightbox-sidebar.tsx`, exported) and reuse it in `photo-collection.tsx`.

The `open` signature change is backward-compatible: `opts` is optional and every
existing caller (`PhotoGrid` double-click, `FilmStrip` `onPick`, the deep-link
provider) passes no second argument and gets the Info tab.

## Data flow

```
grid keydown ─▶ GridShortcuts
                 ├─ f      ─▶ favorite([...ids], computeFavoriteTarget(getPhotos(ids)))  ──▶ POST /api/photos/favorite
                 ├─ Enter  ─▶ open(getLoadedIds().indexOf(theId))                         ──▶ Lightbox (Info)
                 └─ e      ─▶ open(getLoadedIds().indexOf(theId), { tab: "edit" })        ──▶ Lightbox (Edit)
```

No new API routes, no DB changes, no new dependencies. `f` reuses the existing
`/api/photos/favorite` endpoint via `usePhotoActions().favorite`; `Enter`/`e`
reuse the existing client-side `open`.

## Edge cases

- **Favorites view**: `f`-unfavouriting drops the tile from the grid (the view's
  `usePhotoActions({ dropOnUnfavorite: true })`), identical to its toolbar
  Favourite button today.
- **Selection across an unloaded gap**: selection only ever contains loaded ids
  (selection happens on rendered tiles), so `getLoadedIds().indexOf(id)` for the
  single-selected `Enter`/`e` target always resolves. If, defensively, it returns
  `-1`, the handler no-ops.
- **In-flight favourite**: `usePhotoActions().favorite` already guards against a
  concurrent call (`favoritePending`), so a rapid `f` repeat is naturally
  debounced; `e.repeat` is also ignored.
- **Lightbox open**: every grid shortcut is suppressed (`openIndex !== null`), so
  the lightbox's own `f`/navigation keys are never doubled.

## Testing

- **Unit (pure logic)**: `computeFavoriteTarget` is already covered in
  `@lumio/shared`. No new pure logic worth isolating beyond it.
- **Manual / browser verification** (the project's standard for UI):
  - On `/photos`: select one photo → `Enter` opens the lightbox on Info; close →
    `e` opens on Edit; close → with no selection `Enter`/`e` do nothing.
  - Select several → `f` favourites all (hearts fill); `f` again unfavourites all
    (smart toggle); `Enter`/`e` do nothing with 2+ selected.
  - Type in the Search box → `e`/`f` don't fire. Open a dialog/menu → shortcuts
    don't fire. Open the lightbox → grid shortcuts don't fire.
  - Repeat the favourite + open checks on Favorites, an Album, Search results,
    and a Folder photos page.
```
