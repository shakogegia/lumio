# Grid keyboard navigation + album/folder selection parity

**Date:** 2026-06-21
**Status:** Approved (design)

## Goal

Bring the `/albums` listing (folders + album cards) to the same selection model
the photo grid got in #64, and add arrow-key navigation that **moves the
selection** across both the photo grid and the album/folder listing.

## Part 1 — Click semantics on album/folder cards

Today `album-card.tsx` and `folder-card.tsx` call `onToggle(id)` on a plain
click (old toggle behavior) and fall through to the native link on ⌘/Ctrl-click
(open in new tab). Change them to match the photo grid:

| Gesture | Behavior |
| --- | --- |
| Plain left click | Select only that card, clearing any previous selection |
| ⌘ click (Mac) / Ctrl click (Win/Linux) | Toggle that card in/out (multi-select) |
| Shift click | Extend a range from the anchor (additive) |
| Double click | Open (navigate into album/folder) — unchanged |
| Middle click | Open in a new tab — unchanged |
| Right click | Context menu — unchanged |

The listing is a flat ordered id list in reading order: **Folders → Albums →
Smart Albums**. The `computeSelection` reducer (already shared) drives it,
indexed against that flat list, with a shift anchor — exactly like the grid.

## Part 2 — Arrow-key navigation (photo grid + album/folder listing)

Finder / Apple Photos model, applied to both surfaces:

- **Arrow keys** move the selection to the neighbor — ←/→ by one, ↑/↓ by one
  row (the column count) — *replacing* the selection with that one item. The
  target scrolls into view.
- **Shift + arrow** extends the selection to the inclusive range from the
  anchor to the new cursor (replace-with-range, so the range grows and shrinks
  as you arrow).
- **Enter** opens the cursor item (photo → detail/lightbox; album/folder →
  navigate in).
- If nothing is selected, the first arrow press selects the first item.
- Arrows are handled only when the grid owns the keyboard (there is a cursor /
  selection) and no text field, dialog, or menu is focused — so they never
  hijack ordinary page scrolling or typing. Movement is clamped (no wrap) at the
  grid edges.

### Cursor + anchor model

Two refs, shared between mouse and keyboard so they stay in sync:

- **anchor** — the fixed end of a shift range. Set on every plain click and
  plain arrow move.
- **lead (cursor)** — the moving end. Set on every click and every arrow move.

A plain click or plain arrow sets both anchor and lead to that index. A shift
click or shift arrow moves only the lead and recomputes the range from the
anchor. Both reset when the selection empties (Escape / toolbar clear / after a
bulk action), mirroring the existing anchor-reset effect.

## Architecture

A single shared hook consolidates mouse + keyboard selection so both surfaces
behave identically:

`useGridSelectionNav({ count, columns, idAt, selectedIds, onSelectionChange, onOpen?, scrollToIndex })`
→ returns `handleItemClick(index, event)` and installs a guarded `keydown`
listener.

- `idAt(index) => string | undefined` — lets the photo grid back it with its
  sparse, virtualized loaded-ids while the listing passes a dense array.
- `scrollToIndex(index)` — grid passes
  `virtualizer.scrollToIndex(Math.floor(index / columns))`; the listing scrolls
  the card element into view (`block: "nearest"`).
- `onOpen?(index)` — grid opens the lightbox/detail; the listing navigates into
  the album/folder. Omitted where there is no open target.

Pure, unit-tested helpers in `grid-selection.ts`:

- `nextGridIndex(current, key, columns, count) => number` — clamped neighbor
  index for an arrow key (`current === null` → first item).
- Keyboard selection: plain arrow → `new Set([idAt(lead)])`; shift arrow →
  inclusive range `[anchor..lead]`. Shares an `inclusiveRange` helper with the
  existing shift-click path.

### Integration points

- `photo-grid.tsx` — replace the inline `handleTileClick`/`anchorRef` with the
  hook; wire `scrollToIndex` to the existing `useWindowVirtualizer`.
- `folder-browser.tsx` — build the flat `[folders, regular, smart]` id list,
  replace `toggle(id)` with the hook's `handleItemClick`, pass an
  `onSelect(id, event)` to the cards, and supply `onOpen`/`scrollToIndex`.
- `album-card.tsx` / `folder-card.tsx` — swap `onToggle(id)` for
  `onSelect(id, event)`; intercept ⌘/Ctrl left-click for selection instead of
  the new-tab fall-through (middle click still opens a new tab). Update the doc
  comments.

## Edge cases

- **Virtualized holes (photo grid):** stepwise arrowing starts from a loaded,
  visible item, so the neighbor is virtually always already loaded (overscan +
  read-ahead). If the target id is briefly unloaded, the cursor still moves and
  scrolls into view; selection lands once it is loaded. Acceptable for v1.
- **Section boundaries (listing):** ↑/↓ move by the column count over the flat
  order, so at a section's partial last row the vertical target is approximate
  but predictable. Pixel-accurate cross-section tracking is intentionally out of
  scope.
- **Empty grid:** no cursor, arrows are no-ops.

## Testing

- Unit tests for `nextGridIndex` (all four directions, clamping at every edge,
  null cursor) and the keyboard selection helper (plain replace, shift range
  both directions, range grow/shrink) in `grid-selection.test.ts`.
- Existing `computeSelection` tests stay green (click path unchanged).
- Manual browser pass on `/photos`, an album detail page, and `/albums`.

## Out of scope

- The upload page grid (keyboard nav not requested there).
- Home/End, PageUp/PageDown, type-ahead, and drag-to-select.
- Pixel-accurate vertical tracking across listing sections.
