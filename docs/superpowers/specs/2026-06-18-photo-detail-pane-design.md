# Photo detail right-side pane — design

**Date:** 2026-06-18
**Status:** Approved (pending user spec review)

## Problem

The photo detail page (`/photo/[id]`, and its intercepting modal overlay) shows
the image full-width with a **"Details" button** that opens a slide-out `Sheet`.
Metadata, album membership, and raw EXIF are hidden behind that button. We want
the details visible at a glance: a small persistent pane to the **right** of the
image showing metadata, which albums the photo belongs to, and EXIF.

## Scope

Pure presentational refactor of `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`
plus a one-line wrapper width bump in the two pages that render it. **No** changes
to the data layer, API routes, DTOs, album-membership mutation logic, or the
modal-overlay scroll-locking.

## Design

### Layout

`PhotoDetail` becomes a responsive two-column layout:

- **Wide (`lg` and up):** `flex-row` — the image area is `flex-1 min-w-0`
  (image keeps `max-h-[80vh] w-full rounded-lg object-contain`); the details
  pane is a fixed-width `<aside className="w-full shrink-0 lg:w-80">` to its right.
- **Narrow (`< lg`):** `flex-col` — image on top, pane stacks below at full width.

The `Sheet`, `SheetTrigger`/"Details" `Button`, the `open` state, and the
`Sheet*` imports are removed.

### Pane contents (top → bottom)

A styled `<aside>` (`rounded-lg border bg-card p-4`) with sections separated by
the existing `Separator` component:

1. **Header** — filename (basename of `photo.path`, e.g. `photo.path.split("/").pop()`)
   as the heading, with the `source` `Badge` and `width×height` beneath it
   (reusing today's badge + dimensions row).
2. **Metadata rows** — `Taken`, `Camera` (`cameraMake` + `cameraModel`, falling
   back to model-only or `—`), `Hash` (truncated). Rendered with the existing
   `Row` helper.
3. **Albums** — the existing `AlbumMembership` component, **unchanged**: the full
   checkbox list of regular albums with inline POST/DELETE toggle and
   `router.refresh()`. Still hidden when `regularAlbums.length === 0`. (A future
   pass will redesign this into chips + an add control; out of scope here.)
4. **All EXIF** — a native `<details><summary>Show all EXIF</summary>` block,
   collapsed by default, revealing the raw `JSON.stringify(photo.exif, null, 2)`
   in the existing `<pre>`. Dependency-free and accessible.

### Wrapper width

Both files that render `PhotoDetail` bump their wrapper from `max-w-5xl` to
`max-w-6xl` so the image isn't cramped beside the pane:

- `apps/web/src/app/(app)/photo/[id]/page.tsx`
- `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx`

## Components used

All already in `apps/web/src/components/ui/`: `Badge`, `Separator`. No new
dependencies. `Sheet` is no longer imported by this component.

## Out of scope

- Album-membership redesign (chips + popover/add control) — deferred per user.
- EXIF normalization (ISO/aperture/lens are only in the raw passthrough today).
- Any change to routing, scroll-locking, or the data layer.

## Verification

- Wide viewport: image left, details pane right, all sections visible; EXIF
  collapsed until clicked.
- Narrow viewport: pane stacks below the image, full width.
- Album checkboxes still toggle membership (add + remove) and refresh.
- Modal overlay (soft-nav from the grid) renders identically to the standalone
  page; Escape/back still works.

## Post-implementation deviations

Three refinements were requested during browser verification and supersede the
"Design" section above:

1. **Full-height divider, not a card box.** The pane dropped its
   `rounded-lg border bg-card p-4` card treatment. Image and pane are now
   separated by a single full-height divider — `lg:border-l` on the `<aside>`
   (which stretches to the row height), switching to a top border when stacked.
2. **Fills the viewport.** On `lg+` the layout is `h-[calc(100dvh-2rem)]` (the
   `2rem` offsets the `<main>` `p-4`), the image is vertically centered in the
   left column, and the pane scrolls internally (`lg:overflow-y-auto`).
3. **Full width.** Both `<main>` wrappers dropped `mx-auto max-w-*` so the view
   spans the full area beside the fixed 76px sidebar.
