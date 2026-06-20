# Calendar month-filter — design

## Summary

Add a single calendar icon to the photo toolbar that opens a two-pane flyout: a
list of years on the left, and a grid of month cover tiles for the selected year
on the right (styled after macOS Photos / the supplied inspiration). Clicking a
month **filters** the grid to show only photos from that month. The filter works
on the **Library**, **Album detail**, and **Search** views (not Trash).

Months are grouped by `sortDate` (`takenAt ?? importTime` — the canonical
chronological field the grid sort and album covers already use), bucketed by UTC
boundaries so results are deterministic and server-timezone-independent. Each
month tile shows the newest photo in that month as its cover.

## Goals

- One toolbar control (calendar icon) that opens a year/month flyout with cover
  thumbnails per month.
- Selecting a month filters the grid to that month; an "All photos" entry clears
  the filter.
- Works uniformly across Library, Album (regular + smart), and Search scopes by
  reusing the existing `where`-builders, so facets can never drift from what the
  grid shows.
- No schema migration.

## Non-goals (v1)

- Filtering by a whole year (year list is navigation only; filtering is
  month-granular).
- URL-syncing the selected month (it is component state; resets on navigation).
- Calendar filter on the Trash view.
- A dedicated small-thumbnail endpoint for covers (reuse the existing display
  image; optimization can come later).

## Architecture

Every view already resolves its photo set to a single `Prisma.PhotoWhereInput`:

- **Library** → `{}`
- **Album** → `albumPhotoWhere(id)` (membership, or a smart-album rule predicate)
- **Search** → `buildSearchWhere(params)`

The calendar reuses those exact builders, mirroring how `getNeighborsForWhere`
already serves all scopes from a `where`.

### Data approach: server-side JS bucketing (chosen)

Prisma cannot `groupBy`/`distinct` on a date expression like
`date_trunc('month', sortDate)`, and a hand-written raw-SQL `where` cannot
reproduce smart-album rules or `buildSearchWhere`. So the facet builder fetches
minimal rows for the scope and buckets them in JS on the server; the client only
ever receives the small tree.

Trade-off: O(N) scan per flyout-open over `id`+`sortDate` (indexed column, tiny
payload). Acceptable for a self-hosted personal library. The service interface is
identical to a future persisted-`sortYear/sortMonth`-columns implementation, so
the internals can be swapped behind the same endpoint without touching the UI if
the library ever grows huge.

## Components

### 1. Facet service — `apps/web/src/lib/calendar-service.ts`

```ts
buildCalendarFacets(where: Prisma.PhotoWhereInput, db = prisma): Promise<CalendarFacets>
```

- Query: `photo.findMany({ where, select: { id: true, sortDate: true },
  orderBy: [{ sortDate: "desc" }, { id: "desc" }] })`.
- Reduce newest-first rows into the tree: the first id seen for each
  `(year, month)` is that month's `coverId`; the running tally is `count`. Year
  totals are the sum of their months.
- Years sorted descending; months within a year sorted descending.
- Year/month derived from `sortDate` using **UTC** (`getUTCFullYear` /
  `getUTCMonth`).

### 2. Shared types — `packages/shared/src/calendar.ts`

```ts
interface CalendarMonthFacet { month: number; count: number; coverId: string } // month 1–12
interface CalendarYearFacet  { year: number; count: number; months: CalendarMonthFacet[] } // months desc
interface CalendarFacets     { years: CalendarYearFacet[] } // years desc
```

Exported from `packages/shared/src/index.ts`.

### 3. Query param + `monthRange` helper

- Add optional `month` (`YYYY-MM`) to `photosQuerySchema` and `searchQuerySchema`,
  validated by regex `^\d{4}-(0[1-9]|1[0-2])$`.
- Shared helper `monthRange(month: string): { gte: Date; lt: Date }` returns UTC
  month boundaries (`Date.UTC(y, m-1, 1)` .. `Date.UTC(y, m, 1)`), correctly
  rolling December into the next January.
- `listPhotos` / `listAlbumPhotos` / `searchPhotos` apply it:
  ```ts
  where: month ? { AND: [scopeWhere, { sortDate: monthRange(month) }] } : scopeWhere
  ```
  (AND-combine rather than spread, so a smart album that itself constrains
  `sortDate` is not clobbered.) The album photos route already parses
  `photosQuerySchema`, so it accepts `month` with no route change.

### 4. Route handlers (thin)

Each computes its scope `where` exactly like its sibling list endpoint, then
returns `buildCalendarFacets(where)`:

- `GET /api/photos/calendar` → `{}`
- `GET /api/albums/[id]/calendar` → `albumPhotoWhere(id)`; 404 when null
- `GET /api/search/calendar?…` → `buildSearchWhere(parsed)`; reuses the search
  route's `album`-repeat parsing (`searchParams.getAll("album")`)

### 5. UI — `apps/web/src/components/grid-calendar-menu.tsx`

A client component beside `GridViewMenu` / `GridSortMenu`, using a shadcn
**Popover** (custom two-pane layout, not a radio dropdown).

- **Trigger**: `outline` `icon-sm` button with the `CalendarDays` icon. When a
  month is active, it renders in an active style and shows the label
  (e.g. `Jun 2026`).
- **Left pane**: an "All photos" reset entry at the top (clears the filter), then
  years descending; the selected year is highlighted. Defaults the visible year
  to the active filter's year, else the most recent year.
- **Right pane**: a 3-column grid of month tiles for the selected year. Each tile
  is the cover image (`/api/photos/{coverId}/display`, `object-cover`) with the
  month abbreviation overlaid (bottom-left, like the inspiration). Clicking a
  tile applies `{year, month}` (`YYYY-MM`) and closes the popover; the active
  month tile gets a ring.
- Facets are fetched **lazily on open** from a `facetsEndpoint` prop, with
  loading / error / empty states. The facet fetch excludes `month`, so all months
  in the scope always appear.

Props (scope-agnostic):

```ts
{ facetsEndpoint: string; value: string | null; onChange: (month: string | null) => void }
```

### 6. View wiring

Each view holds `const [month, setMonth] = useState<string | null>(null)`, folds
`month` into the `PhotoCollectionProvider` `params` **and** its remount `key`, and
renders `<GridCalendarMenu>` in the (non-select-mode) toolbar:

- **Library** (`library-view.tsx`) → `facetsEndpoint="/api/photos/calendar"`
- **Album** (`album-view.tsx`) → `facetsEndpoint={`/api/albums/${albumId}/calendar`}`
- **Search** (`search-view.tsx`) → `facetsEndpoint={`/api/search/calendar?` + current filter params}`;
  `month` also folds into `paramsFor(...)`. Selecting/clearing a month resets the
  selection the same way a query change does.

Trash view is untouched.

## Data flow

1. User opens the flyout → component fetches `facetsEndpoint` (scope's `where`,
   no month) → server buckets rows → returns `{ years: [...] }`.
2. User clicks a month tile → `onChange("YYYY-MM")` → view sets `month` state →
   `PhotoCollectionProvider` remounts (key change) and refetches the list
   endpoint with `?month=YYYY-MM` → grid shows only that month.
3. "All photos" → `onChange(null)` → provider remounts without `month`.

## Error handling

- Facet fetch failure → error state in the flyout with a retry affordance; the
  grid is unaffected.
- Album calendar for a missing album → 404 (matches the album photos route).
- Invalid `month` query param → 400 from the Zod schema (matches existing
  validation behavior).
- Empty scope (no photos) → flyout shows an empty state.

## Testing

- **Unit**
  - `calendar-service.test.ts`: years/months descending; counts; cover = newest in
    month; cross-year bucketing; empty scope; single photo.
  - `monthRange` helper: UTC boundaries; December → January rollover; leap-year
    February.
  - `month` schema validation (accept `2026-06`; reject `2026-13`, `2026-6`,
    junk).
  - `listPhotos` / `listAlbumPhotos` / `searchPhotos` honor `month` (extend the
    existing service test files), including AND-combination with a scope `where`.
- **Browser-verify** the flyout UI: open on Library / Album / Search, pick a
  month, confirm the grid filters and cover thumbnails render; confirm "All
  photos" clears.

## Files

New:
- `apps/web/src/lib/calendar-service.ts` (+ test)
- `packages/shared/src/calendar.ts`
- `apps/web/src/components/grid-calendar-menu.tsx`
- `apps/web/src/app/api/photos/calendar/route.ts`
- `apps/web/src/app/api/albums/[id]/calendar/route.ts`
- `apps/web/src/app/api/search/calendar/route.ts`

Changed:
- `packages/shared/src/api.ts` (add `month` to `photosQuerySchema` /
  `searchQuerySchema`; `monthRange` helper)
- `packages/shared/src/index.ts` (export calendar types)
- `apps/web/src/lib/photos-service.ts`, `albums-service.ts`, `search-service.ts`
  (apply `month`)
- `apps/web/src/app/(app)/photos/library-view.tsx`,
  `apps/web/src/app/(app)/albums/[id]/album-view.tsx`,
  `apps/web/src/app/(app)/search/search-view.tsx` (state + wiring + toolbar)
