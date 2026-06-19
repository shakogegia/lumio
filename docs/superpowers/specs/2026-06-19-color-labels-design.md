# Color Labels — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Add Lightroom-style **color labels** to photos. A photo can carry at most one label from a fixed
pastel palette of 8 colors. Labels are applied to a multi-selection from the Library's selection
toolbar via a flyout of swatches, and displayed in the grid's **card** view by tinting the card mat
with the label's color.

The palette (names are placeholders and freely editable — see Config):

| # | Name   | Slug     | Hex       |
|---|--------|----------|-----------|
| 1 | Gray   | `gray`   | `#DBCBCE` |
| 2 | Pink   | `pink`   | `#FFD2CE` |
| 3 | Orange | `orange` | `#FAD5B4` |
| 4 | Yellow | `yellow` | `#F8E9B7` |
| 5 | Green  | `green`  | `#D0E3C9` |
| 6 | Cyan   | `cyan`   | `#B3DDE0` |
| 7 | Blue   | `blue`   | `#CAD2EE` |
| 8 | Purple | `purple` | `#E4C8E7` |

## Non-goals (YAGNI)

- **No filtering/search by label.** Applying + displaying only. (Clean follow-up — `buildSearchWhere`
  already composes filters, so this is a small later add.)
- **No single-photo labeling** in the photo detail/modal view. Toolbar (multi-select) path only.
- **No keyboard shortcuts** (the 1–8 numbering is documentation/ordering, not bound to keys yet).
- **No label chrome in `fill`/`fit` modes.** A labeled photo shows its color **only in card view**.
  Fill and fit stay chrome-less.
- **No multiple labels per photo.** One label or none (matches "selected color", singular).
- No new label management UI (the palette is a fixed code constant, not user-editable at runtime).

## Palette config (single source of truth)

A new ordered constant, **`COLOR_LABELS`**, lives in `@lumio/shared` and is the only place colors,
names, and order are defined. Everything else derives from it.

- **New** `packages/shared/src/color-labels.ts`:
  - Add a `ColorLabel` string enum (slugs above), mirroring a Prisma enum 1:1 — exactly how
    `PhotoSource` mirrors its Prisma counterpart in `enums.ts`.
  - Export `COLOR_LABELS: ReadonlyArray<{ slug: ColorLabel; name: string; hex: string }>` in palette
    order. The array index (+1) is the displayed number.
  - Export a `colorLabelSchema` Zod enum built from the **same literal slug tuple** that backs the
    `ColorLabel` enum and `COLOR_LABELS` (define the slugs once as a `const` tuple; derive the TS
    enum/union, the `COLOR_LABELS` rows, and `z.enum(SLUGS)` from it) so validation can never drift
    from the palette.
  - Re-export from `packages/shared/src/index.ts`.

Renaming a color or tweaking a hex = edit this file only, **no migration**. Adding/removing a color =
edit this file **and** the Prisma enum (a migration). Slug (storage) is decoupled from name+hex
(presentation), which directly addresses the "names might not be correct" caveat.

## Data model

- **`packages/db/prisma/schema.prisma`** — add a Prisma enum mirroring the slugs and a nullable
  column on `Photo`:

  ```prisma
  enum ColorLabel {
    gray
    pink
    orange
    yellow
    green
    cyan
    blue
    purple
  }

  model Photo {
    // ...existing fields...
    colorLabel ColorLabel?
  }
  ```

  `null` = unlabeled. New Prisma migration adds the enum type + nullable column (no backfill).

- **`packages/shared/src/types.ts`** — `PhotoDTO` gains `colorLabel: ColorLabel | null`.
- **`packages/db/src/mappers.ts`** — `toPhotoDTO` maps `row.colorLabel` (Prisma enum value) onto the
  DTO field. (No change needed at `GET /api/photos`/album/search call sites — they all flow through
  `toPhotoDTO`, so the field rides along automatically.)

## API / mutation

A single batch endpoint that sets (or clears) the label on many photos at once.

- **New** `apps/web/src/app/api/photos/color-label/route.ts` — `POST`, wrapped in `withAuth` like the
  other photo routes. Body validated by a shared schema:

  - **`packages/shared/src/api.ts`** — `setColorLabelSchema = z.object({ photoIds:
    z.array(z.string()).min(1), label: colorLabelSchema.nullable() })`. `label: null` clears.

  Handler calls the service and returns `{ count }` (rows updated), mirroring the album-photos route's
  shape and error handling.

- **New** service `setPhotoColorLabel(photoIds, label, db = prisma)` in
  `apps/web/src/lib/photos-service.ts` (next to the existing photo services) →
  `db.photo.updateMany({ where: { id: { in: photoIds } }, data: { colorLabel: label } })`, returns
  `result.count`. Passing `label = null` clears.

## UI — toolbar flyout

- **New** `apps/web/src/app/(app)/photos/color-label-menu.tsx` (`"use client"`):
  `ColorLabelMenu({ photoIds, onApplied })`.
  - A `DropdownMenu` (same primitive as `GridViewMenu`) whose trigger is a `Button size="sm"`
    labeled **"Label"** (with a small swatch/tag icon), `disabled` when `photoIds.length === 0` —
    matching the existing "Add to album" button's disabled rule.
  - Content: the 8 swatches rendered from `COLOR_LABELS` (each a round/rounded chip filled with its
    `hex`, with its `name` as label/`aria-label`), plus a **"None"** item that clears the label.
  - On pick: `POST /api/photos/color-label` with `{ photoIds, label }` (label is the slug, or `null`
    for None). On success, call `onApplied(label)`; on failure, surface a lightweight error (no
    optimistic change committed).

- **`apps/web/src/app/(app)/photos/library-view.tsx`** — render `<ColorLabelMenu>` alongside the
  existing "Add to album" button inside the `SelectionToolbar` `actions`. Its `onApplied(label)`:
  1. Optimistically patches the grid's in-memory photos (see Data flow) so the card tint repaints
     immediately.
  2. **Keeps select mode active** (deliberately different from Add-to-album's `sel.cancel()`): the
     user sees the tint update on the still-selected tiles and can re-pick if they chose wrong.
     Cancel exits when done.

## UI — card tint

In **card** mode only, a labeled photo's mat shows its label `hex` instead of `bg-muted`.

- **`apps/web/src/components/photo-grid/photo-grid-tile.tsx`** — when `mode === "card"` and
  `photo.colorLabel` is set, look up its hex from `COLOR_LABELS` and apply it as an inline background
  (e.g. `style={{ backgroundColor: hex }}` on the cell, or a `--label` CSS var). cva can't take an
  arbitrary hex, so the dynamic color comes from inline style; `cell-variants.ts`'s `card` variant
  keeps the `p-2` padding and only its default `bg-muted` is overridden when a label is present.
  Applies in both normal (Link) and select-mode (button) tiles — the mat tint is visible while
  selecting, giving immediate feedback. `fill`/`fit` tiles ignore `colorLabel` entirely.

## Data flow (repaint strategy)

The grid is **fully client-fetched**: `usePhotoPages` accumulates `PhotoDTO[]` in React state and only
resets on remount. `router.refresh()` (what Add-to-album uses) refreshes *server* components and would
**not** repaint this client state — and album membership isn't drawn on tiles, so Add-to-album gets
away with it. The card tint **is** drawn on tiles, so it needs a real in-memory update. We use an
**optimistic local patch** (instant tint, preserves scroll, no refetch):

- **`apps/web/src/components/photo-grid/use-photo-pages.ts`** — return an additional
  `patchPhotos(ids: Set<string>, patch: Partial<PhotoDTO>)` that maps over `photos` and merges `patch`
  into matching rows (`setPhotos(prev => prev.map(p => ids.has(p.id) ? { ...p, ...patch } : p))`).
- **`apps/web/src/components/photo-grid/photo-grid.tsx`** — expose `patchPhotos` to the parent via an
  imperative handle on a `ref` (React 19 ref-as-prop; `useImperativeHandle`). Views that don't pass a
  ref (album/search) are unaffected.
- **`library-view.tsx`** — holds the grid ref; `ColorLabelMenu.onApplied(label)` calls
  `gridRef.current.patchPhotos(sel.selected, { colorLabel: label })` after the API 200.

```
LibraryView (client)
  state: useGridSelection (selected: Set<photoId>), gridRef
  SelectionToolbar actions:
    [Add to album]  [Label ▾ → ColorLabelMenu]
       ColorLabelMenu(photoIds=[...selected])
         pick swatch|None → POST /api/photos/color-label { photoIds, label }
           200 → onApplied(label):
                   gridRef.patchPhotos(selected, { colorLabel: label })   // instant tint
                   (select mode stays active)
  PhotoGrid ref={gridRef}
    usePhotoPages → { photos, ..., patchPhotos }
      PhotoGridTile (mode="card" + colorLabel) → mat bg = COLOR_LABELS[label].hex
```

## Error handling / edge cases

- **API failure:** if the POST is non-2xx, do **not** patch the grid; show a small inline error/toast
  consistent with how Add-to-album reports failure. Selection is preserved so the user can retry.
- **Clearing:** picking **None** sends `label: null` → `updateMany` sets the column null → optimistic
  patch sets `colorLabel: null` → card mat reverts to `bg-muted`.
- **Empty selection:** the "Label" trigger is `disabled` at `photoIds.length === 0`, so the menu can't
  fire on nothing (same guard as Add-to-album).
- **Mixed labels in a selection:** the flyout has no "current value" to highlight (a multi-select can
  span several labels); it's a pure write — whatever you pick is applied to all selected photos. No
  indeterminate state shown.
- **Palette/DB drift:** the Prisma enum and `ColorLabel`/`COLOR_LABELS` slugs must stay in lockstep; a
  DTO carrying a slug absent from `COLOR_LABELS` would have no hex. Since both derive from the same
  fixed list and a removal requires a migration, this can't happen in normal operation; the tile
  treats an unknown/`null` label as unlabeled (falls back to `bg-muted`).
- **Non-card modes:** `fill`/`fit` ignore the label by design — no indicator, no layout change.

## Testing

- **Service** (`photos-service` test): `setPhotoColorLabel` sets a label on multiple ids
  (`updateMany` count), and clears with `null`. Follows existing `*-service` test patterns.
- **Schema** (`packages/shared` api test): `setColorLabelSchema` accepts a valid `{ photoIds, label }`
  and a `null` label; rejects an empty `photoIds` array and an unknown slug. `colorLabelSchema` stays
  in sync with `COLOR_LABELS` (e.g. assert the enum values equal the slugs).
- **Tile render:** a `card`-mode tile with a `colorLabel` paints the matching hex as its mat
  background; with `colorLabel: null` (and in `fill`/`fit`) it does not.
- **Browser-verify:** Library → Select → choose a few photos → **Label ▾** → pick a swatch → those
  tiles' mats tint immediately (in card view) while staying selected; pick **None** → tint clears;
  switch to fill/fit → no tint; reload → tint persists (DB round-trip).
