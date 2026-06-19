# Sidebar Albums Hover Flyout — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Add a hover-revealed flyout to the **Albums** item in the sidebar rail. Hovering the Albums item
opens a small panel to the right listing the user's albums (cover thumbnail + name + photo count);
clicking each row navigates to that album. This mirrors the *visual* flyout feel of the existing
**More** menu, but is triggered on **hover** rather than click.

The Albums item itself stays a normal navigation link: **clicking the "Albums" label still navigates
to `/albums`** (the full albums page), exactly as today. The flyout is an additive quick-access
shortcut layered on top of that link.

## Non-goals (YAGNI)

- Any extra chrome in the flyout — **no** header label, **no** "＋ New album" action, **no**
  "View all albums" footer. Just the list of album rows.
- An empty-state message. When there are **zero albums the flyout never opens** (hovering does
  nothing extra).
- Touch/click-to-open behavior for the flyout. It is a hover affordance for the desktop rail; the
  click-to-navigate path (`/albums`) remains the universal entry point.
- Changing any other sidebar item (Photos / Upload / More / brand-back-button) or the rail layout.
- Creating, renaming, reordering, or deleting albums from the flyout.

## UX

### The Albums rail item
Unchanged in appearance: the same `NavLink` markup as today (centered `GalleryVerticalEnd` icon over
the "Albums" label, `w-14`, `py-2.5`, `rounded-2xl`, same color/hover/active treatment). Its active
state (route is `/albums` or `/albums/...`) is preserved. The only change is that it now also acts as
the hover trigger for the flyout.

### The flyout
Opens on hover with `side="right"` and `align="center"`, `sideOffset={8}` — appearing to the right of
the narrow rail, vertically centered on the Albums item (the More menu also opens to the right, but
bottom-anchored with `align="end"`; Albums sits mid-rail, so centering it on the icon reads as
balanced). Snappy timing: `openDelay ≈ 120ms`, `closeDelay ≈ 100ms`. It closes on mouse-leave (Radix
HoverCard default) and on selecting a row (navigation dismisses it). Radix collision handling shifts
the panel to stay in the viewport if a long list would otherwise overflow above/below.

The panel is a card, roughly `w-64`, with a capped max-height (~360px) that scrolls when there are
many albums. Each album is a `<Link href="/albums/{id}">` row containing, left to right:

1. **Cover thumbnail** — a small `aspect-[4/3]` image (~44px wide, `rounded-sm`, `object-cover`)
   loaded from `/api/thumbnails/{coverPhotoId}`. When `coverPhotoId` is `null`, show the `Images`
   placeholder icon on a `bg-muted` tile (same placeholder treatment the albums page uses).
2. **Name** — `truncate`, single line.
3. **Photo count** — muted, e.g. `128 photos` / `1 photo` (singular/plural like the albums page).

Rows get the standard hover highlight (`hover:bg-muted`). Both regular and smart albums are listed —
the same set the albums page shows — in the same order (`createdAt asc`).

### Empty state
When `items.length === 0`, the flyout does not open at all. Hovering the Albums item behaves exactly
like today (just the nav link). See Architecture for how this is enforced.

## Architecture

### HoverCard primitive
- **New** `apps/web/src/components/ui/hover-card.tsx` — the standard shadcn `hover-card` primitive set
  (Radix `HoverCard`), added via the shadcn CLI/registry to match the other `ui/` components. Exports
  `HoverCard`, `HoverCardTrigger`, `HoverCardContent`. No HoverCard/Tooltip exists in the codebase
  yet; this is the first.

### Shared NavLink
`NavLink` and `isActive` currently live **inside** `apps/web/src/components/app-sidebar.tsx`. Extract
them into a small shared module so both `app-sidebar` and the new `SidebarAlbums` render the identical
rail-item markup and active-state styling without duplication.

- **New** `apps/web/src/components/sidebar-nav-link.tsx` — exports the `NavItem` type, `isActive`, and
  the `NavLink` component (moved verbatim from `app-sidebar.tsx`).
- **`apps/web/src/components/app-sidebar.tsx`** — import `NavLink`/`isActive`/`NavItem` from the new
  module instead of defining them locally. Render the Albums entry as `<SidebarAlbums>` while Photos
  and Upload continue to render plain `<NavLink>`s. The simplest shape: keep the `PRIMARY` array and,
  in the `.map`, branch on `item.href === "/albums"` to render `<SidebarAlbums item={item}
  active={...} />`.

### Sidebar Albums component
- **New** `apps/web/src/components/sidebar-albums.tsx` (`"use client"`) — `SidebarAlbums({ item, active
  })`:
  - Renders a `HoverCard` whose `HoverCardTrigger asChild` wraps the shared `<NavLink item={item}
    active={active} />` (Next `<Link>` forwards a ref, so `asChild` works and click-to-navigate is
    preserved).
  - `HoverCardContent` holds the scrollable album list described in UX.
  - Owns album state: `const [items, setItems] = useState<AlbumSummaryDTO[]>([])`. Fetches `GET
    /api/albums` (`{ items }`) on mount, and re-fetches when the card opens (so a newly-created album
    appears) via the controlled `onOpenChange` handler.
  - **Empty guard:** the component controls `open`. `onOpenChange` only sets `open = true` when
    `items.length > 0`; otherwise it stays closed. This guarantees "no albums → never opens" even on
    the first hover before/just-after the fetch resolves.

### Data flow

```
AppSidebar (client)
  nav: Photos (NavLink) | Albums → <SidebarAlbums/> | Upload (NavLink)
    SidebarAlbums (client)
      state: items (AlbumSummaryDTO[]), open (controlled)
      effect: GET /api/albums on mount  → setItems
      HoverCard open={open} onOpenChange={(o) => setOpen(o && items.length > 0); if (o) refetch()}
        HoverCardTrigger asChild → <NavLink href="/albums">   [click → /albums, unchanged]
        HoverCardContent (side=right, align=start)
          scroll list of rows:
            <Link href="/albums/{id}">
              [thumbnail /api/thumbnails/{coverPhotoId} | Images placeholder]
              name (truncate)
              "{photoCount} photos"
```

`AlbumSummaryDTO` (`id`, `name`, `isSmart`, `photoCount`, `coverPhotoId`, …) and the
`GET /api/albums → { items }` endpoint already exist and back the albums page; the flyout reuses them
as-is. No new API, service, or DB work.

## Error handling / edge cases

- **Empty / not-yet-loaded:** before the first fetch resolves `items` is `[]`, so the empty guard
  keeps the card closed; it can open on a subsequent hover once albums are loaded. Acceptable — the
  list is a shortcut, and the Albums link still works immediately.
- **Fetch failure:** on a failed `GET /api/albums`, leave `items` empty (card simply won't open). No
  error UI in the rail — the user can still click through to `/albums`, which surfaces its own state.
- **Staleness / new albums:** re-fetching on open keeps the list fresh after creating an album
  elsewhere, without a global store. The sidebar persists across `(app)` route changes, so a
  mount-only fetch would otherwise go stale.
- **Many albums:** the capped-height, scrollable content prevents the flyout from overflowing the
  viewport.
- **Keyboard / focus:** Radix HoverCard is hover/focus-driven; the underlying Albums link remains
  fully keyboard-navigable for the navigate-to-`/albums` action. The flyout is an enhancement, not the
  only path to any album (each album is also reachable from `/albums`).

## Testing

- **Browser-verify:** hover the Albums item → flyout appears to the right with cover thumbnails,
  names, and photo counts for each album (regular + smart). Click a row → navigates to that
  `/albums/{id}`. Click the **Albums** label itself → still navigates to `/albums`. Create a new
  album, return, hover again → the new album appears (re-fetch on open). With **no albums**, hovering
  Albums does nothing (no flyout). The placeholder icon shows for albums without a cover.
- **No unit tests:** this is a presentational/wiring change reusing an existing endpoint; there's no
  new pure logic to isolate. The empty guard and fetch wiring are verified in the browser.
