# Search Page — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

A dedicated **search page** (`/search`, new sidebar entry) for finding photos by **structured tags**
plus **free text**. The defining interaction:

- The page opens with the search box **centered** in the viewport (hero state) with a heading and a
  hint.
- On **Enter**, the box **smoothly slides up** to where the app's sticky header normally sits, and a
  **results photo grid** fades in below.

Tagging is powered by **TributeJS**: typing the trigger char (`@`) opens an autocomplete menu of
*things you can tag*. The first (and only, for now) facet is **Album** — tagging an album filters to
photos in that album. The tagging layer is built as an **extensible facet registry** so future facets
(EXIF camera/lens, date, etc.) are added by dropping in one object, with no changes to the input,
parsing, or animation code.

## Non-goals (YAGNI)

- **Facets beyond Album** (camera, lens, date range, source). The registry is designed for them but
  only Album ships now.
- **URL-synced / shareable filters.** Results live in client state; refreshing clears them. Flagged as
  a follow-up (it interacts with the no-navigation animation, so it's deliberately deferred).
- **Ranking / relevance scoring / full-text search** over EXIF or content. Free text is a simple
  case-insensitive filename match.
- **Search history, saved searches, suggestions-as-you-type for free text.**

## Filtering semantics (the query model)

A photo matches when it satisfies **every facet group** present (AND across facet *types*), and within
the album facet it matches **any** selected album (OR within a facet). Free text ANDs on top:

```
match = (albums.length ? photo ∈ any(albums) : true)
        AND
        (q ? photo.path contains q, case-insensitive : true)
```

With only Album + text today this reads: *"photos in (album A or B) whose filename contains 'beach'."*
The AND-across-types / OR-within-type rule is the standard faceted-search convention and is what future
facets will follow.

## UX

### Layout & animation
One client page, **two visual states** driven by a `searched` boolean — **no route navigation and no
new animation dependency** (pure CSS).

- **Hero (pre-search):** the search box is wrapped in a `sticky top-0` container that is translated down
  (~38vh) and rendered larger, vertically centered. Above/around it: an `h1` ("Search your photos") and
  a muted hint ("Type `@` to filter by album"). 
- **Results (post-search):** `searched` flips true → a `transition-transform duration-500 ease-out`
  animates the box's `translateY` to `0`, so it settles into the normal sticky-header position and pins
  while results scroll beneath. The hero copy fades out (`opacity` transition); the results grid
  fades/slides in below. Only `transform` + `opacity` animate (GPU-friendly, smooth).

Submitting again while already in the results state just re-runs the search (the box is already at the
top; no re-animation needed).

### The search box (shadcn look, Tribute-powered)
A single `<div contentEditable>` — **not** an `<input>`, because Tribute needs to insert inline chip
markup and free text together.

- **Styling matches a shadcn `Input` exactly.** The shadcn input classes (pill `rounded-4xl`,
  `bg-input/30`, `border-input`, focus ring `focus-visible:border-ring focus-visible:ring-[3px]`,
  placeholder color, etc.) are extracted into a shared **`fieldClassName`** constant (in
  `apps/web/src/lib/field-style.ts`) so the real `Input` component and the contenteditable box stay
  visually identical. The hero state adds size modifiers (taller, larger text) on top.
- An empty contenteditable shows a CSS **placeholder** via `:empty::before` (data-attribute driven),
  since native `placeholder` doesn't apply to contenteditable.
- The box is **uncontrolled** — React renders it empty once and never re-renders its children, so
  Tribute's direct DOM mutations don't fight React's reconciler.

### Tagging with Tribute
- **One trigger (`@`), one Tribute collection.** Its values are the **union of every facet's options**,
  each carrying its facet `key` and labelled by type — menu rows read `Album · Vacation`. Adding a
  future facet just contributes more options under the same trigger (one char for the user to learn).
- Selecting an option inserts an **inline chip**: a `contenteditable=false` `<span>` carrying
  `data-facet="album"` and `data-value="<albumId>"`, showing `Album: <name>` with a small `×`. The chip
  sits inline among free text. **Backspace** at the chip boundary deletes it as a unit (native
  contenteditable behavior); the `×` removes it explicitly.
- Tribute is imported and instantiated **inside `useEffect`** (browser-only; it touches `document`) and
  destroyed on unmount. Its dropdown is **restyled to match our popover / `DropdownMenu`** (background,
  border, radius, shadow, hover via theme tokens) rather than shipping Tribute's stock CSS.

### Empty / loading / error
- **Loading & error** are handled by `PhotoGrid` (existing skeleton tiles + retry affordance).
- **No matches:** `PhotoGrid`'s `empty` slot renders a search-specific empty state ("No photos match
  your search").

## Architecture

The contenteditable/Tribute messiness is isolated inside `SearchInput`; everything else consumes clean
structured `SearchFilters`. New code is grouped under `apps/web/src/app/(app)/search/`.

**New dependency:** `tributejs` (+ `@types` are bundled with it) added to `apps/web`. It is imported
only inside a client component, lazily within `useEffect`, so it never runs during SSR.

### Frontend

1. **Sidebar entry** (`apps/web/src/components/app-sidebar.tsx`)
   Add `{ href: "/search", label: "Search", icon: Search, match: ["/search"] }` as the **first**
   `PRIMARY` item. (`Search` from `lucide-react`.)

2. **`/search` route** (`apps/web/src/app/(app)/search/page.tsx`)
   Thin server component rendering `<SearchView />` inside the standard `<main className="w-full px-6
   pb-6">` wrapper used by other pages.

3. **`SearchView`** (new client, `apps/web/src/app/(app)/search/search-view.tsx`)
   Owns `searched: boolean` and `submitted: SearchFilters | null` (the filters at last Enter). Renders
   the animated hero/sticky wrapper around `<SearchInput onSubmit={...}>` and, once searched, the
   results `<PhotoGrid>`. On submit: set `searched=true`, store filters, build the query params.
   Renders `<PhotoGrid key={serialize(submitted)} endpoint="/api/search" params={paramsFor(submitted)}
   empty={<SearchEmpty/>} />` — **keying by the serialized filters** remounts the grid each new search,
   cleanly resetting its paging state.

4. **`SearchInput`** (new client, `apps/web/src/app/(app)/search/search-input.tsx`)
   Renders the styled contenteditable, wires Tribute against the facet registry, and on **Enter**
   (without the menu open) parses its own DOM → `SearchFilters` and calls `onSubmit(filters)`. Reads
   chips (`[data-facet]` spans → `{ facet, value }`) and concatenated text nodes (→ trimmed `q`).
   Exposes nothing else; fully self-contained.

5. **Facet registry** (new, `apps/web/src/app/(app)/search/facets.ts`)
   ```ts
   export interface FacetOption { value: string; label: string; }   // album: value=id, label=name
   export interface SearchFacet {
     key: string;                                  // "album" — the filter discriminator
     label: string;                                // "Album" — menu group + chip prefix
     loadOptions: () => Promise<FacetOption[]>;    // album → GET /api/albums
   }
   export const FACETS: SearchFacet[] = [albumFacet];
   ```
   `albumFacet.loadOptions` fetches `GET /api/albums` and maps `AlbumSummaryDTO[]` →
   `{ value: id, label: name }`. The Tribute collection's async `values` callback resolves
   `Promise.all(FACETS.map(f => f.loadOptions()))` **once** (cached), flattens with each option tagged by
   `key`, and lets Tribute filter client-side by label.

6. **Filter parsing & serialization** (new, `apps/web/src/app/(app)/search/filters.ts`)
   `SearchFilters = { albums: string[]; q: string }`. `parseEditor(el): SearchFilters` (DOM → filters),
   `paramsFor(filters): URLSearchParams` (appends repeated `album` + `q`), `serialize(filters): string`
   (stable key for the grid). Pure and unit-testable.

7. **`PhotoGrid` param support** (`apps/web/src/app/(app)/photos/photo-grid.tsx`)
   Add one optional prop `params?: URLSearchParams`. In `fetchPage`, build the query from a **clone** of
   `params` (so `limit`/`cursor` don't mutate the caller's object) plus the existing `limit`/`cursor`.
   Existing callers (no `params`) are unchanged. `URLSearchParams` handles the repeated `album` key.

### Backend

8. **Shared schema & types** (`packages/shared/src/api.ts`)
   ```ts
   export const searchQuerySchema = z.object({
     q: z.string().trim().min(1).optional(),
     album: z.union([z.string(), z.array(z.string())]).optional()
       .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v])),
     limit: z.coerce.number().int().min(1).max(100).default(50),
     cursor: z.string().min(1).optional(),
   });
   export type SearchQuery = z.infer<typeof searchQuerySchema>;   // { q?, album: string[], limit, cursor? }
   ```
   Reuses the existing `PhotosPage` response shape. (Repeated `album` params arrive via
   `searchParams.getAll`, see route.)

9. **`buildSearchWhere`** (new, `packages/db/src/search.ts`) — pure `Prisma.PhotoWhereInput` builder,
   sitting beside `smartAlbumWhere` and matching its style:
   ```ts
   export function buildSearchWhere(p: { q?: string; album: string[] }): Prisma.PhotoWhereInput {
     const clauses: Prisma.PhotoWhereInput[] = [];
     if (p.album.length) clauses.push({ albums: { some: { albumId: { in: p.album } } } });
     if (p.q) clauses.push({ path: { contains: p.q, mode: "insensitive" } });
     return clauses.length ? { AND: clauses } : {};
   }
   ```
   Empty filters → `{}` (matches everything, same as the unfiltered library). Exported from
   `packages/db/src/index.ts`.

10. **`searchPhotos` service** (new, `apps/web/src/lib/search-service.ts`)
    Mirrors `listPhotos`: `db.photo.findMany({ where: buildSearchWhere(params), take: limit, …cursor,
    orderBy: PHOTO_ORDER })`, returns `PhotosPage` via `toPhotoDTO`. Same keyset-cursor logic as the
    library (cursor stays valid because the `where` only narrows the same `PHOTO_ORDER` sequence).

11. **`GET /api/search`** (new, `apps/web/src/app/api/search/route.ts`)
    `withAuth`, `runtime=nodejs`, `dynamic=force-dynamic`. Builds the parse input from
    `searchParams`: spread `Object.fromEntries(searchParams)` for scalars but override
    `album: searchParams.getAll("album")` so repeats survive. `safeParse` with `searchQuerySchema` →
    400 on failure; else `searchPhotos(parsed.data)` → `NextResponse.json(page)`. Mirrors
    `/api/photos`.

## Data flow

```
SearchView (/search)
  state: searched, submitted: SearchFilters
  ┌─ hero/sticky wrapper (translateY 38vh → 0 on searched) ─┐
  │  SearchInput (contenteditable + Tribute @album)         │
  │    onSubmit(filters) ─────────────────────────────────► set searched, submitted
  └──────────────────────────────────────────────────────────┘
  PhotoGrid(key=serialize(submitted), endpoint="/api/search",
            params=paramsFor(submitted), empty=<SearchEmpty/>)
            │
            └─► GET /api/search?album=<id>&album=<id>&q=<text>&limit&cursor
                  searchQuerySchema.safeParse  →  searchPhotos
                    db.photo.findMany({ where: buildSearchWhere, orderBy: PHOTO_ORDER, cursor })
                  → PhotosPage

Facet options:  Tribute @  →  FACETS[*].loadOptions()  →  albumFacet → GET /api/albums
```

## Error handling

- **Tribute fails to init / options fetch fails:** the box still works as a plain text search (typing +
  Enter); the `@` menu just shows nothing. Logged to console, not surfaced as a blocking error.
- **Search request fails / 4xx:** handled by `PhotoGrid`'s existing error state (retry link).
- **Empty submit** (no chips, no text): `buildSearchWhere` returns `{}` → grid shows the whole library.
  Acceptable; treated as "no filter." (Hero→results animation still runs.)
- **Album deleted between tagging and search:** `{ albumId: { in } }` simply matches nothing for that id;
  no error.
- **Malformed query params:** schema `safeParse` → 400.

## Testing

- **Unit — `buildSearchWhere`** (`packages/db`): no filters → `{}`; albums only → `{ AND:[{albums:
  {some:{albumId:{in}}}}] }`; q only → path-contains insensitive; both → AND of both; multiple albums →
  single `in` (OR).
- **Unit — `searchQuerySchema`** (`packages/shared`): single `album` → `[id]`; repeated → array; absent →
  `[]`; `q` trim + empty-string rejected/omitted; limit coercion + bounds.
- **Unit — `searchPhotos`** (`apps/web`): forwards `where`/cursor/limit, maps DTOs, computes
  `nextCursor` (against a fake `db.photo`, like existing service tests).
- **Unit — `filters.ts`** (`apps/web`): `parseEditor` over a DOM fragment with chips + text → correct
  `{ albums, q }`; `paramsFor` emits repeated `album` + `q`; `serialize` is stable/order-independent
  enough to key the grid.
- **Browser-verify:** centered box → type `@` → menu styled like our popover, lists `Album · …` →
  pick one → inline chip appears → add free text → Enter → box slides smoothly to the top, grid fades
  in with matching photos; `×` and backspace remove a chip; no-match shows the empty state; the box
  looks identical to a shadcn input.
