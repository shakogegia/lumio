# Favorites — Design

**Date:** 2026-06-20
**Status:** Approved (design phase)

## Summary

Add a "Favorites" feature to Lumio. A photo can be marked as a favorite (♥). Users
can favorite/unfavorite a single photo or many at once, from the grid hover overlay,
the selection toolbar, the right-click context menu, and the lightbox sidebar. A
dedicated `/favorites` view lists favorited photos, and a Favorites entry appears in
the sidebar nav. Favorited photos show a persistent heart badge in the main grid.

## Decisions (from brainstorming)

- **Spelling:** American — "Favorite" / "Favorites" everywhere (route `/favorites`,
  DB field `isFavorite`, label "Favorites").
- **Icon:** Heart (♥), matching the dominant photo-app convention.
- **Multi-select behavior:** Smart toggle. If any photo in the selection is not
  favorited, favorite all of them; if all are already favorited, unfavorite all.
- **Grid visibility:** Persistent when favorited. Favorited photos always show a
  filled heart bottom-left; non-favorited photos show a faint outline heart only on
  hover.
- **Data model:** Boolean flag on `Photo` (mirrors the existing `colorLabel` field).
  Single global library — the `Photo` model has no `userId`.

## Rejected alternatives

- **Smart album:** Smart albums are predicate-based (auto-populated). Favorites are
  manually marked, so this is the wrong abstraction.
- **Regular hidden album (join table):** The persistent heart badge would require
  per-photo album-membership lookups, and "favorite" would leak into album lists.
  More machinery, less clarity.

## Design

### 1. Data layer (`packages/db`)

- **Schema (`prisma/schema.prisma`):** add `isFavorite Boolean @default(false)` to the
  `Photo` model. Add `@@index([isFavorite, sortDate])` so the favorites listing
  (sorted by `sortDate`, like the main grid) stays fast. Generate a Prisma migration.
- **`mappers.ts`:** include `isFavorite` in the Photo→DTO mapping.

### 2. Service layer (`apps/web/src/lib/photos-service.ts`)

- **`setPhotoFavorite(photoIds: string[], isFavorite: boolean)`** — batch update,
  mirrors `setPhotoColorLabel`.
- **`listPhotos`** — add an optional `favorite?: boolean` filter to its params; when
  set, adds `isFavorite: true` to the `where`. Both the API and the `/favorites` page
  reuse the same pagination/month logic.

### 3. API (`apps/web/src/app/api/photos`)

- **`POST /api/photos/favorite`** — body `{ ids: string[], isFavorite: boolean }`,
  mirrors `/api/photos/color-label`. Returns the updated state.
- **`GET /api/photos?favorite=true`** — extend the existing route's query schema with
  an optional `favorite` flag.

### 4. Shared (`packages/shared`)

- **`PhotoDTO.isFavorite: boolean`** in `types.ts`.
- Zod request schema for the favorite mutation in `api.ts` (mirrors color-label).
- **`computeFavoriteTarget(photos): boolean`** — pure helper for the smart toggle:
  returns `true` (favorite all) unless every photo is already favorited, in which
  case `false`. Unit-tested.

### 5. Shared photo-actions layer (`components/photo-actions`)

- Add **`favorite(ids, isFavorite, opts?)`** to the `PhotoActions` interface plus
  `pending.favorite` in-flight state. Calls the new API and optimistically
  `patchPhotos` to flip `isFavorite`. This single addition powers the toolbar,
  context menu, grid hover, and lightbox.

### 6. UI integration points

- **Grid tile (`photo-grid-tile.tsx` / `photo-thumb.tsx`):** heart button,
  bottom-left. Filled white heart (with drop-shadow) shown persistently when
  favorited; faint outline heart appears on `group-hover/tile` when not favorited.
  Clicking toggles that one photo and `stopPropagation`s so it does not select or
  open the photo.
- **Selection toolbar (`photos/selection-toolbar.tsx` via `library-view.tsx`):**
  Heart icon button using the smart toggle (`computeFavoriteTarget` over the selected
  photos). Icon is filled when all selected photos are already favorited.
- **Context menu (`photo-context-menu.tsx`):** entry with a dynamic label —
  "Favorite N photos" / "Remove N from Favorites" — using the same smart toggle.
- **Lightbox sidebar (`lightbox-sidebar.tsx`):** a favorite toggle button alongside
  Download / Delete.

### 7. Navigation + page

- **Sidebar (`app-sidebar.tsx`):** add a Favorites nav item (Heart icon) → `/favorites`,
  placed after Albums. Plain link, no flyout (it is a single collection, unlike Albums).
- **`app/(app)/favorites/page.tsx` + `favorites-view.tsx`:** reuse the existing library
  grid + lightbox + selection + photo-actions, fetching the favorites collection, with
  a "Favorites" header and an empty state ("No favorites yet"). Within this view,
  unfavoriting a photo optimistically removes it from the grid (it no longer belongs),
  the same way trash/album-removal already works. On the main `/photos` grid, toggling
  just updates the badge in place.

### 8. Testing

TDD for the pure/service logic: `computeFavoriteTarget`, `setPhotoFavorite`, the
`listPhotos` favorite filter, the mapper, and the API Zod schema — following the
existing `*.test.ts` patterns in each package.
