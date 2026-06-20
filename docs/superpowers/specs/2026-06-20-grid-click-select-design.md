# Grid click-to-select, double-click-to-open

**Date:** 2026-06-20
**Status:** Approved, pending implementation plan

## Problem

In the photo grid, a single click opens the photo detail (lightbox), and
selecting photos requires first entering a separate "select mode" via a toolbar
button. Selection is shown with a checkmark icon. This makes selecting multiple
photos a two-step, modal interaction.

We want selection to be the default click gesture across every grid, with the
detail view promoted to a double-click. The separate "select mode" and its
toolbar toggle are removed everywhere.

This supersedes `2026-06-18-photos-select-mode-design.md`.

## Goals

- Single click toggles selection. Double click opens the detail view.
- Selection is always available — no "select mode" to enter or exit.
- Remove every "Select" toolbar button and the modal select-mode toolbar split.
- Selected tiles show a **blue outer ring**, no checkmark, no shrink animation.
- Apply to all grids: photo grids (Library, Album, Search), the Albums grid,
  the Upload grid, and Trash.

## Non-goals

- No "click empty space to clear selection" affordance (YAGNI). Escape and the
  toolbar's X clear the selection.
- No new ARIA machinery beyond what exists today.
- No change to shift-click range selection or its anchor logic.

## Interaction model

Selection is always on. Per gesture:

| Gesture | Photo grids (Library/Album/Search) | Albums grid | Upload / Trash |
|---|---|---|---|
| Single click | Toggle select | Toggle select | Toggle select |
| Double click | Open lightbox | Open album page | — (no detail view) |
| Shift-click | Range select (unchanged) | Range select | Range select |
| ⌘/Ctrl-click | Open photo page in new tab (keep `<a href>`) | Open album in new tab | — |
| Enter (keyboard) | Opens detail via the link's href | Opens album | — |

Photo and album tiles remain `<a href>` so ⌘/Ctrl-click and right-click
"open in new tab" keep working and keyboard Enter opens the detail. A plain
left mouse click selects instead of navigating. Upload tiles have no detail
view, so they stay non-link interactive elements (single click selects only).

### Double-click vs. single-click reconciliation

A double-click dispatches two `click` events before `dblclick`. We use the
**net-zero toggle** approach:

- A single left click (no modifiers, not shift) toggles the tile immediately.
- During a double-click, the two clicks toggle the same tile twice — net no
  change — and then `dblclick` opens the detail. Prior selection state is
  preserved.
- No timers; selection feedback is instant. The only artifact is a sub-second
  ring blink during a deliberate double-click, which is acceptable.

Rejected alternatives: debounced click (adds ~200ms latency to every
selection), and detail-gating on `event.detail === 1` (breaks double-clicking
an already-selected tile — it would deselect it).

Because double-clicks are always without shift, `computeSelection` simply
toggles twice; the anchor ends at the clicked index, which is correct for
subsequent shift-clicks.

## Visual design

Selected tiles change from the current inset primary ring + checkmark + shrink
to a **blue outer ring**:

- Remove `CheckCircle2` / `Circle` icons.
- Remove the `scale-[0.92]` shrink wrapper.
- Replace `ring-2 ring-inset ring-primary` with
  `ring-2 ring-offset-2 ring-offset-background ring-blue-500` (explicit blue,
  not the theme `primary`).
- The exact ring width/offset will be tuned in the browser so it reads as an
  outer ring without overlapping neighboring tiles in any grid mode.

## Component / state changes

### `useGridSelection` (`apps/web/src/lib/use-grid-selection.ts`)

- Remove `selectMode`, `enter`, and `cancel`.
- Keep `selected`, `setSelected`, `clear`, and `count`.
- Escape now simply clears the selection (no mode to exit). Keep the existing
  guards that let text fields, open dialogs, and menus keep Escape for
  themselves.

### `PhotoGrid` / `PhotoGridTile`

- Remove the `selectMode` prop. Tiles are always selectable.
- Merge `PhotoGridTile`'s two render branches (button in select mode, link
  otherwise) into a single `<a href>` element that:
  - toggles selection on plain left click (`preventDefault` + `onTileClick`),
  - opens the lightbox on `onDoubleClick` (`onOpen(index)`),
  - falls through to the native link for ⌘/Ctrl/shift/middle clicks.
- Apply the selected-ring styles to this element; drop the checkmark span and
  the shrink wrapper.

### Albums grid (`AlbumCard`)

- Remove `selectMode`. Single `<a href={/albums/[id]}>`:
  - toggles selection on plain left click,
  - navigates to the album on `onDoubleClick` (Next router push, since the
    plain click is prevented),
  - native link behavior for modifier clicks.

### Upload grid (`UploadTile`)

- Remove `selectMode`. Uploaded (selectable) tiles are always interactive and
  toggle selection on click. No double-click action.

### Toolbars

Stop gating on `selectMode`. The selection action bar (count + actions + X)
shows whenever `count > 0`; otherwise the normal browse toolbar shows. Affected
views and their action sets are unchanged from today:

- **Library** (`library-view.tsx`): color label, add to album, download,
  delete. Remove the `SquareCheckBig` Select button.
- **Album** (`album-view.tsx`): add to album, remove from album (non-smart),
  download, delete.
- **Search** (`search-view.tsx`): color label, add to album, download, delete.
  Remove the inline Select button.
- **Albums** (`albums-view.tsx`): delete. Remove the `SquareCheckBig` Select
  button.
- **Upload** (`upload-client.tsx`): existing actions. Remove its Select button.
- **Trash** (`trash-view.tsx`): already count-based; just drop the now-dead
  `selectMode` prop passed to `PhotoGrid`.

`SelectionToolbar` keeps its API; callers switch their conditional from
`sel.selectMode` to `sel.count > 0` and pass `onCancel={sel.clear}`.

## Testing

- Update/extend unit tests around `computeSelection` and `useGridSelection`
  (Escape now clears rather than exiting a mode).
- Browser verification (per project workflow): in Library, Album, Search,
  Albums, Upload, Trash — confirm single click toggles a blue outer ring,
  double click opens the detail (or album), shift-click ranges, ⌘-click opens
  a new tab, Escape clears, and the action toolbar appears on selection and
  reverts to the browse toolbar when the selection empties.

## Risks

- Net-zero double-click leaves a brief ring blink — accepted.
- Outer ring offset could overlap neighbors in tight grid modes — mitigated by
  tuning in the browser across all grid sizes/modes.
- Accessibility of click-to-select on an `<a>` is unchanged from the current
  pragmatic baseline; Enter still opens the detail.
