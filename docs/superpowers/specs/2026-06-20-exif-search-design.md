# EXIF Search — Design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)
**Author:** brainstormed with user

## Summary

Let users search/filter the photo library by **any EXIF field**, using a rich set
of operators (`eq`, `ne`, `contains`, `gt`, `gte`, `lt`, `lte`, `between`,
`exists`, `not_exists`, `in_album`, `not_in_album`, `last_30_days`, …). The same
filter model powers **ad-hoc search** and **saved smart albums** — one predicate
engine instead of the two hardcoded ones we have today.

EXIF data is already extracted and stored (the `Photo.exif` JSONB column), so this
is mostly a query/engine/UI feature plus a targeted denormalization of the
fields people filter and sort by most.

## Goals

- Filter photos by any EXIF key present in the data (camera, lens, ISO, aperture,
  focal length, shutter speed, date taken, orientation, GPS-presence, film stock,
  and every other key in the `exif` blob — `WhiteBalance`, `Flash`,
  `MeteringMode`, `filmexif:*`, etc.).
- A rich, extensible operator set; album membership is just another operator.
- **Hybrid UI**: a faceted filter panel *and* typed tokens in the search box, both
  driving one filter model.
- **Dynamic discovery**: the panel surfaces fields and values that actually exist
  in the library (with counts), so any field is reachable without knowing its name.
- **Unify with smart albums**: the search engine and the smart-album engine become
  one, so a filter built in search can later be saved as a smart album.

## Non-Goals (deferred)

- **Place-name reverse-geocoding** ("Paris", "Yosemite") — needs a geocoder /
  offline gazetteer + place-name indexing. Its own future feature. v1 only does
  GPS *presence* and raw coordinate bounds.
- **UI to view/manage promoted columns** — showing the promoted EXIF on the photo
  detail page, and an admin to configure *which* keys get promoted. Wanted "later";
  the data model here does not preclude it.
- **Full-text / materialized search index** (the heavier Approach #3). Revisit only
  if JSONB + promoted columns prove insufficient at scale.
- **"Save this search as a smart album" button** — trivial once the engine is
  unified, but out of v1 scope; called out as an immediate follow-up.

## Current State (what exists today)

- **`Photo.exif` JSONB** (`packages/db/prisma/schema.prisma`) holds the full
  flattened, sanitized EXIF dump. Curated aliases overlaid by ingest:
  `takenAt`, `cameraMake`, `cameraModel`, `orientation`. The dump also contains
  `Make`, `Model`, `FNumber`, `ISO`, `FocalLength`, `LensModel`, `ExposureTime`,
  GPS (`latitude`/`longitude`), `Orientation`, and namespaced XMP keys like
  `filmexif:FilmStock`.
- **Ingest** (`packages/ingest/src/metadata.ts`) — `extractMetadata()` parses all
  blocks with `exifr`, flattens/namespaces them (`flattenMetadata`), sanitizes for
  JSONB (`sanitizeMetadata`), and overlays the curated aliases. `takenAt` is also
  promoted to its own `Photo.takenAt` column.
- **Smart albums** (`packages/db/src/smart-albums.ts`) — `smartAlbumWhere(rules, now)`
  handles exactly two rule shapes: `takenAt last_30_days` and
  `exif.cameraModel eq`. `RuleOp` enum = `{ eq, last_30_days }`. Rule model:
  `SmartAlbumRule { field, op, value? }`, `SmartAlbumRules { match, rules[] }`.
  Validation: narrow `smartRuleSchema` discriminated union (`packages/shared/src/albums.ts`).
- **Search** (`packages/db/src/search.ts`) — `buildSearchWhere({ q, album })`:
  filename `contains` (case-insensitive) + album membership. API:
  `GET /api/search` (`apps/web/src/app/api/search/route.ts`) validated by
  `searchQuerySchema` (`q`, `album[]`, `limit`, `offset`, `sort`, plus a `count=1`
  mode). Service: `searchPhotos` / `countSearchPhotos` (`apps/web/src/lib/search-service.ts`).
- **Search UI** (`apps/web/src/app/(app)/search/`) — `search-view.tsx`,
  `search-input.tsx` (parses `@album` tokens + free text), `filters.ts`
  (`SearchFilters { albums, q }` → `paramsFor` query string). Grid is the shared
  `PhotoGrid` fed by `usePhotoPages`.

## Approach (selected: #2 — JSONB engine + promoted columns)

One generic rule engine over a **field registry**. The fields people filter and
sort by constantly get real, typed, indexed columns; every other EXIF key stays
queryable through JSONB. This keeps the "literally all fields" promise while making
the hot path correct and fast (JSONB numeric range queries + sorting are the weak
spot of a JSONB-only approach).

Rejected alternatives: **#1 JSONB-only** (range/sort correctness + performance
risk), **#3 full denormalized index** (overkill for a self-hosted MVP).

## Architecture

### 1. Operators — extend `RuleOp` (`packages/shared/src/enums.ts`)

```
enum RuleOp {
  eq, ne, contains,
  gt, gte, lt, lte, between,
  exists, not_exists,
  in_album, not_in_album,
  last_30_days,           // kept; relative-date family can grow (before/after, last_N)
}
```

Album membership is modeled as an operator, so it lives in the same rule model as
everything else.

### 2. Field registry — the central abstraction (`packages/shared`)

A single declarative table describing every searchable field. One source of truth
for **(a)** the WHERE compiler, **(b)** Zod validation, and **(c)** which UI widget
to render.

Each entry: `key` (stable id), `label`, `type` (`string | number | date | bool |
enum`), `storage` (a **promoted column** name, or a **JSONB path** such as
`["LightSource"]` / `["filmexif:FilmStock"]`, or a **special** handler like album
membership / filename), and `ops` (the operators valid for that field).

Curated entries (first-class): `cameraMake`, `cameraModel`, `lensModel`, `iso`,
`aperture` (fNumber), `focalLength`, `exposureTime`, `takenAt`, `orientation`,
`hasGps`, plus the special `album` and `filename`. Any EXIF key **not** in the
registry is reachable generically as field `exif.<Key>` with a default operator set
inferred from the value's JSON type — this is the "literally all fields" guarantee.

### 3. Storage — promoted columns + backfill (`packages/db`, `packages/ingest`)

New nullable, indexed `Photo` columns, populated at ingest:

| Column         | Type     | Source (exif key)               |
| -------------- | -------- | ------------------------------- |
| `cameraMake`   | String?  | `cameraMake` / `Make`           |
| `cameraModel`  | String?  | `cameraModel` / `Model`         |
| `lensModel`    | String?  | `LensModel`                     |
| `iso`          | Int?     | `ISO` / `ISOSpeedRatings`       |
| `fNumber`      | Float?   | `FNumber`                       |
| `focalLength`  | Float?   | `FocalLength`                   |
| `exposureTime` | Float?   | `ExposureTime`                  |
| `hasGps`       | Boolean? | `latitude` && `longitude` set   |
| `gpsLat`       | Float?   | `latitude`                      |
| `gpsLng`       | Float?   | `longitude`                     |

(`takenAt` already exists; add an index on it.) Indexes on the fields used for
filtering/sorting (`cameraModel`, `lensModel`, `iso`, `fNumber`, `focalLength`,
`takenAt`).

- **`derivePromotedFields(exif): PromotedFields`** — a single pure helper in
  `@lumio/ingest`, the *only* place mapping `exif` → columns. Used by the ingest
  pipeline (`process.ts`) on create and by the backfill.
- **Migration + backfill**: a migration adds the columns; a one-off backfill script
  (`packages/db`) reads existing rows' `exif` and populates the new columns via
  `derivePromotedFields`. Idempotent, batched.

### 4. The unified compiler — `buildPhotoWhere(filterSet, now)` (`packages/db`)

Replaces and absorbs both `buildSearchWhere` and `smartAlbumWhere`. For each rule,
look up the field descriptor and compile to a `Prisma.PhotoWhereInput`:

- **Promoted column** → typed column predicate, e.g. `{ iso: { gte: 800 } }`,
  `{ fNumber: { lte: 2.8 } }`, `{ cameraModel: { contains, mode: "insensitive" } }`,
  `{ takenAt: { gte, lte } }`, `{ hasGps: true }`.
- **Album** → `{ albums: { some: { albumId: { in } } } }` (in_album) /
  `{ albums: { none: { albumId: { in } } } }` (not_in_album).
- **Filename** → `{ path: { contains, mode: "insensitive" } }`.
- **Arbitrary JSONB key** → Prisma JSON path filters: `{ exif: { path, equals } }`,
  `string_contains`, `gt`/`lt` where supported. For numeric ranges on
  *non-promoted* keys where Prisma's JSON casting is unreliable, fall back to a
  raw SQL fragment (`(exif->>'Key')::numeric > $1`). Documented limitation: heavy
  numeric-range filtering should target promoted columns.

`match: all → { AND }`, `any → { OR }`. Pure, no DB access, `now` injected
(mirrors today's `smartAlbumWhere`).

`smartAlbumWhere` becomes a thin wrapper that calls `buildPhotoWhere`.
`buildSearchWhere` is removed; `searchPhotos`/`countSearchPhotos` call
`buildPhotoWhere` after normalizing `q`/`album` params into rules.

### 5. Validation — `filterSetSchema` (`packages/shared`)

A Zod schema for `{ match, rules[] }` validating each rule against the registry
(field exists or is a well-formed `exif.<Key>`; op is valid for that field's type;
value shape matches the op — e.g. `between` takes a 2-tuple, `exists` takes no
value). Replaces the narrow `smartRuleSchema`; `createAlbumSchema` uses it for
smart-album rules so search and smart albums validate identically.

### 6. Discovery endpoints (powers dynamic facets)

- **`GET /api/exif/fields`** → distinct EXIF keys present across the library (for
  the generic "＋ Add filter" picker). Computed via a `jsonb_object_keys`
  aggregation.
- **`GET /api/exif/values?field=<key>`** → distinct values + counts. Promoted
  columns use Prisma `groupBy`; arbitrary keys use a JSONB distinct query.

Both are scan-heavy ⇒ cached with a short TTL (in-memory, invalidated loosely on
ingest). Curated facets call `values` to populate dropdowns with counts.

### 7. API (`apps/web`)

`searchQuerySchema` keeps `q`, `album`, `sort`, `limit`, `offset` for
back-compat (PR #29's `count=1` toolbar mode keeps working) and gains a `filter`
param: a URL-encoded JSON FilterSet validated by `filterSetSchema`. The service
normalizes the legacy `q`/`album` params into rules, merges with `filter`, and
calls `buildPhotoWhere`. Same path serves list and count modes.

### 8. UI — hybrid facets + tokens (`apps/web/src/app/(app)/search/`)

`SearchFilters` is generalized to carry a `FilterSet` (rules) alongside free text;
`paramsFor` serializes the FilterSet to the `filter` param; `serialize`/`scopeQuery`
updated so grid remount + detail-scope keying account for rules.

- **Facet panel**: curated widgets — camera/lens multiselect *with counts* (from
  `/api/exif/values`), ISO / aperture / focal-length range inputs, date-range
  picker, orientation toggle (portrait/landscape; can also derive from
  width/height), has-GPS toggle — **plus** a generic "＋ Add filter" row: pick a
  field (from `/api/exif/fields`) → pick a valid op (from the registry) → enter a
  value. Each active filter renders as a removable chip.
- **Tokens**: extend `search-input.tsx`'s parser so typed tokens compile to the
  same rules: `camera:"Sony A7 IV"`, `iso:>800`, `aperture:<2.8`, `lens:50mm`,
  `exif.LightSource:Daylight`. Known aliases map to registry fields; an unknown
  `key:value` falls through to `exif.<key>`. Chips ↔ tokens are two views of one
  FilterSet.

### 9. Smart-album reuse

- `smartAlbumWhere` → thin wrapper over `buildPhotoWhere`.
- `smartRuleSchema` → replaced by `filterSetSchema`.
- The smart-album rule-builder dialog reuses the same field/op/value widgets as the
  panel's "＋ Add filter" row. Enables the deferred "save this search as a smart
  album" with minimal extra work.

## Data Flow

```
ingest: file → extractMetadata → exif (JSONB) + derivePromotedFields → Photo columns
search: UI (chips/tokens) → FilterSet → ?filter=<json> → searchQuerySchema
        → normalize q/album into rules → buildPhotoWhere → Prisma → grid
discovery: panel → /api/exif/fields, /api/exif/values → dropdowns w/ counts
smart album: rule-builder → FilterSet → buildPhotoWhere (same engine)
```

## Error Handling

- Bad `filter` JSON or a rule failing `filterSetSchema` → `400` with flattened Zod
  errors (matches existing `/api/search` behavior).
- Unknown EXIF key in a rule → treated as `exif.<Key>` (no error); matches nothing
  if the key is absent. Op not valid for a field's type → `400`.
- Ingest must never fail because a promoted field can't be derived —
  `derivePromotedFields` returns `undefined`/`null` per field on any miss (same
  resilience as `extractMetadata` today).
- Discovery endpoints degrade gracefully (empty list) rather than 500 on a slow
  aggregation timeout.

## Testing

**Pure unit (no DB):**
- Field registry: each field's allowed-ops table; `exif.<Key>` fallthrough.
- `buildPhotoWhere`: a case per operator × field-type (promoted column, album,
  filename, arbitrary JSONB), plus `all`/`any` composition. Inherits the existing
  `smart-albums` test style.
- `filterSetSchema`: valid/invalid rules, op-value shape (`between` tuple, `exists`
  no-value), type mismatches.
- Token parser ↔ FilterSet round-trip (`camera:"..."`, `iso:>800`, quoting,
  `exif.<Key>` fallthrough).
- `derivePromotedFields(exif)` → columns, including missing/garbage values.

**Integration (seeded DB):**
- `searchPhotos`/`countSearchPhotos` for ranges, eq, contains, album in/out,
  arbitrary key, combined `all`/`any`.
- Discovery endpoints return correct distinct values + counts.
- Backfill populates columns correctly from existing rows.

## Affected / New Files (sketch)

- `packages/shared/src/enums.ts` — expand `RuleOp`.
- `packages/shared/src/filters.ts` *(new)* — field registry, `FilterSet` types,
  `filterSetSchema`, token parse/serialize helpers.
- `packages/shared/src/albums.ts` — use `filterSetSchema` for smart-album rules.
- `packages/db/prisma/schema.prisma` + migration — promoted columns + indexes.
- `packages/db/src/photo-where.ts` *(new)* — `buildPhotoWhere`; `smart-albums.ts`
  + `search.ts` reduced to wrappers/removed.
- `packages/db/src/backfill-promoted.ts` *(new)* — one-off backfill.
- `packages/ingest/src/metadata.ts` (or new `promoted.ts`) — `derivePromotedFields`;
  wired in `process.ts`.
- `apps/web/src/app/api/search/route.ts` + `lib/search-service.ts` — `filter` param.
- `apps/web/src/app/api/exif/fields/route.ts`, `.../exif/values/route.ts` *(new)*.
- `apps/web/src/app/(app)/search/filters.ts`, `search-input.tsx`, `search-view.tsx`
  + a new facet-panel component.

## Open Decisions (defaults chosen; flag during review)

1. **`q`/`album` params**: kept at the API boundary for back-compat and normalized
   into rules internally (rather than removing them outright). ✅ default.
2. **Promoted-column set**: the table in §3. Add/remove any field?
3. **Token grammar** for ranges: `iso:>800` / `iso:800..3200` style — confirm
   preferred syntax during plan.
