# Toolbar: count under title (with selection)

## Goal

Show a photo/album count beneath each toolbar title, and shrink the title font.
In selection mode, keep the title and count and append the selected tally
(e.g. `1,234 photos · 3 selected`) instead of replacing the title with
`N selected`.

## Affected toolbars

| View | Title | Count source | Count noun |
|------|-------|--------------|------------|
| Library | "Library" | `PhotoCollectionProvider.total` | photo(s) |
| Favorites | "Favorites" | `PhotoCollectionProvider.total` | photo(s) |
| Album detail | album name | `PhotoCollectionProvider.total` | photo(s) |
| Albums listing | "Albums" | `albums.length` | album(s) |
| Search | (no toolbar title) | existing `useSearchCount` | photo(s) |

## Changes

### 1. `lib/count-label.ts` (new)
`countLabel(n, singular, plural)` → `"1 photo"`, `"1,234 photos"`, `"12 albums"`.
Uses `n.toLocaleString()` for grouping (matches Search's current inline format).

### 2. `components/header-bar.tsx`
- New optional prop `subtitle?: React.ReactNode`.
- Title font `text-2xl` → `text-xl`.
- Title + subtitle stack in a left-hand column (subtitle `text-sm text-muted-foreground`);
  actions stay right-aligned and vertically centered. No subtitle → renders as today.

### 3. `components/photo-grid/collection-total-reporter.tsx` (new)
Renders `null`. Reads `usePhotoCollection().total` and reports it via an
`onTotal(total)` callback inside a `useEffect([total, onTotal])`. Placed inside
each `PhotoCollectionProvider`; the parent view holds the value in state and
feeds it to both the normal and selection toolbars. Reuses the total the grid
already fetched (no extra request); stays correct after deletes because
`removeIds` decrements `total`.

Lint: calling the `onTotal` function prop (not a named `setState`) satisfies
`react-hooks/set-state-in-effect`.

### 4. `app/(app)/photos/selection-toolbar.tsx`
- `title` becomes the real page title (callers stop passing "Select photos"/"Select albums").
- New `totalLabel?: string` prop.
- Subtitle = `totalLabel ? `${totalLabel} · ${count} selected` : `${count} selected``.
- Right-side actions unchanged.

### 5. Views (Library, Favorites, Album detail)
- Add `total` state + `<CollectionTotalReporter onTotal={setTotal} />` inside the provider.
- Normal `HeaderBar`: `subtitle={total != null ? countLabel(total, "photo", "photos") : undefined}`.
- `SelectionToolbar`: pass real title + `totalLabel={total != null ? countLabel(...) : undefined}`.

### 6. Albums listing (`albums-view.tsx`)
- `const total = albums.length` (regular + smart).
- Normal `HeaderBar`: `subtitle={countLabel(total, "album", "albums")}`.
- `SelectionToolbar`: title "Albums", `totalLabel={countLabel(total, "album", "albums")}`.
- Empty state (0 albums) keeps its current empty-screen treatment; no subtitle.

### 7. Search (`search-view.tsx`)
- Use `countLabel` for the count text.
- Selection mode: show `${countLabel} · ${sel.count} selected` (was just `N selected`).
- Hero "Search library" heading left untouched.

## Out of scope
- Search hero heading size.
- Any change to count semantics (month filter already narrows `total`, which is desired).
