# Sort photo grid by custom metadata Date fields — design

## Summary

The photo grid sort dropdown today offers six fixed orderings over three Photo
columns (Date taken / Date imported / File created, each newest- or oldest-first).
This adds, **per catalog**, one ordering pair for every enabled custom metadata
field of type **Date** — so a catalog with a "Shoot date" or "Licensed until"
field can sort the grid by it, newest- or oldest-first.

The chosen sort threads end-to-end exactly like the existing sorts: it reorders
the grid listing *and* the detail view's prev/next + film-strip navigation, in
**every** scope (Library, Folder, Album, Smart album, Search), so opening a photo
walks the same sequence the grid showed.

The key implementation idea: custom metadata values live in the
`PhotoMetadataValue` child table, which a Prisma `orderBy` on the `Photo` query
cannot reach. Instead of raw SQL, the custom-field branch **queries from the value
side** (`photoMetadataValue.findMany`) and nests each scope's *existing*
`Prisma.PhotoWhereInput` verbatim under `photo:`. Because all scopes already funnel
through `listPhotosForWhere` + `getNeighborsForWhere`, the branch lives in those
two functions only and every scope gets it for free — no raw SQL, no re-encoding
the search/smart-album compiler.

## Goals

- The sort dropdown lists each enabled Date custom field for the current catalog,
  with "Newest first" (desc) / "Oldest first" (asc), below the existing fixed sorts.
- Sorting by a Date field works in all five scopes, since they share one ordering
  choke point.
- Grid order and detail-view navigation order stay in lockstep, as for existing sorts.
- Photos with no value for the chosen field always sort **last** (nulls-last), in
  both directions, ordered among themselves by `id`.
- A stale/invalid field reference falls back cleanly to the default sort.

## Non-goals (YAGNI)

- **Only Date fields.** No Number, Text, Textarea, or Choice sorts.
- No range operators, no date-range filtering changes.
- **No schema migration.** No typed `dateValue` shadow column; date values stay
  text and sort as ISO strings (see *Data integrity*).
- No per-view sort persistence (the existing single global `lumio:grid-sort`
  setting is reused).
- No new sort UI; the existing `GridSortMenu` is extended.

## Sort encoding & semantics

The fixed sorts stay a closed union (`PHOTO_SORTS`). Metadata sorts are dynamic
strings:

```
meta:<fieldId>:<dir>      dir ∈ { asc, desc }      e.g. "meta:clx123abc:desc"
```

`fieldId` is the `MetadataField.id` (a cuid). Two pure helpers, in
`packages/shared/src/api.ts` next to `PHOTO_SORTS` (shared by the client menu and
the server):

```ts
export function metadataSort(fieldId: string, dir: "asc" | "desc"): string {
  return `meta:${fieldId}:${dir}`;
}
export function parseMetadataSort(sort: string | undefined):
  { fieldId: string; dir: "asc" | "desc" } | null {
  const m = /^meta:([a-z0-9]+):(asc|desc)$/.exec(sort ?? "");
  return m ? { fieldId: m[1], dir: m[2] as "asc" | "desc" } : null;
}
```

`PhotoSort` widens to `(typeof PHOTO_SORTS)[number] | \`meta:${string}:${"asc"|"desc"}\``.
`photosQuerySchema.sort` accepts `z.enum(PHOTO_SORTS)` **or** a string matching the
`meta:` pattern; invalid values are rejected by the schema (route falls back to the
default). `searchQuerySchema.sort` gets the same treatment.

**Ordering semantics for a Date field:**

- Photos *with* a value: ordered by `PhotoMetadataValue.value` in `dir`, tiebreak
  `photoId` in `dir`. Date values are stored as ISO `YYYY-MM-DD` (see *Data
  integrity*), and ISO text sorts chronologically; `@@index([fieldId, value])`
  on `PhotoMetadataValue` backs it.
- Photos *without* a value (no row for this `fieldId`): always **after** the
  valued photos, ordered by `id` in `dir`.

## Architecture

### Server: resolving the sort

A new server helper centralizes validation so both the grid and the detail-view
neighbor query share one definition of "is this a real metadata sort":

**`apps/web/src/lib/server/metadata-sort.ts`** (new)

```ts
type ResolvedSort =
  | { kind: "standard"; sort?: PhotoSort }
  | { kind: "metadata"; fieldId: string; dir: "asc" | "desc" };

// Validates the field exists, is enabled, and is type Date in this catalog.
// Falls back to { kind: "standard" } (default ordering) otherwise.
async function resolveSort(catalogId: string, sort: PhotoSort | undefined, db): Promise<ResolvedSort>;
```

Validation is one cheap lookup:
`prisma.metadataField.findFirst({ where: { id: fieldId, catalogId, enabled: true, type: FieldType.Date }, select: { id: true } })`
(`MetadataField.type` is stored as the `FieldType` string, so compare to
`FieldType.Date` = `"date"`). A `null` result → `{ kind: "standard" }`, i.e. the
default `photoOrderBy()` ordering. This covers deleted fields, disabled fields,
wrong-type fields, and fields belonging to another catalog (stale URL/localStorage).

### Server: the grid reader (two-segment, nulls-last)

**`apps/web/src/lib/server/photos-service.ts`** — `listPhotosForWhere` becomes:

```
full = { catalogId, ...LIVE_PHOTO, ...where }
resolved = await resolveSort(catalogId, params.sort, db)
if resolved.kind === "standard":
    // unchanged: findMany({ where: full, skip, take, orderBy: photoOrderBy(sort) }) + count
else:
    return listPhotosByMetadata(full, resolved, { limit, offset }, db)
```

`listPhotosByMetadata(full, { fieldId, dir }, { limit, offset }, db)`:

1. `total = db.photo.count({ where: full })` — unchanged page total.
2. `seg1count = db.photoMetadataValue.count({ where: { fieldId, photo: full } })`
   — how many in-scope photos have a value. (`@@unique([photoId, fieldId])`
   guarantees ≤1 row per photo, so no dedup.)
3. `slice = metadataPageSlice(offset, limit, seg1count)` — a **pure** helper
   returning `{ seg1: { skip, take } | null, seg2: { skip, take } | null }` for the
   requested window across the concatenation `[valued ++ unvalued]`.
4. Read the needed segment(s):
   - **seg1:** `db.photoMetadataValue.findMany({ where: { fieldId, photo: full },
     orderBy: [{ value: dir }, { photoId: dir }], skip, take, include: { photo: true } })`
     → map `r.photo` through `toPhotoDTO`.
   - **seg2:** `db.photo.findMany({ where: { ...full, metadataValues: { none: { fieldId } } },
     orderBy: [{ id: dir }], skip, take })` → `toPhotoDTO`.
5. Return `{ items: [...seg1items, ...seg2items], total }`.

`metadataPageSlice` is the only non-trivial arithmetic and is unit-tested in
isolation (cases: window fully in seg1, straddling the boundary, fully in seg2,
empty seg1, empty seg2, offset beyond total).

### Server: detail-view navigation (full support)

**`apps/web/src/lib/server/photos-service.ts`** — `getNeighborsForWhere(current,
where, sort, window, db)` branches the same way. For a metadata sort it reuses the
grid reader:

1. `full = { ...where, ...LIVE_PHOTO }`.
2. `index = await metadataSortIndexOf(current, full, { fieldId, dir }, db)` — the
   current photo's global position in the ordered sequence:
   - Look up the current photo's value:
     `db.photoMetadataValue.findUnique({ where: { photoId_fieldId: { photoId: current.id, fieldId } }, select: { value: true } })`.
   - **Has a value (seg1):** `index = count of seg1 rows strictly before current` =
     `db.photoMetadataValue.count({ where: { fieldId, photo: full, OR: beforeCursor(dir, value, current.id) } })`
     where `beforeCursor` is `[{ value: {lt|gt} value }, { value, photoId: {lt|gt} current.id }]`
     (`lt` for asc, `gt` for desc).
   - **No value (seg2):** `index = seg1count + (count of unvalued rows before current by id)`.
3. Read the window `[index − window, index + window + 1)` via the **same**
   `listPhotosByMetadata`-style reader, but selecting only `{ id, path }`. Derive
   `prevId` / `nextId` / `strip` from the returned slice exactly as the existing
   keyset path does.

`getPhotoNeighbors` already receives `catalogId` and `sort`; it resolves the sort
once and passes the resolved descriptor down. If the current photo no longer
exists, degrade to `{ prevId: null, nextId: null, strip: [current] }` as today.

**Detail-scope serialization** (the parse/serialize that carries `sort` in the
`/photo/{id}?…&sort=…` URL and rebuilds prev/next/strip hrefs) needs **no new
logic** — it already round-trips `sort` as a `PhotoSort`. Because `meta:` widens
that type and the route schema now accepts it, the existing scope plumbing carries
a metadata sort unchanged. A `meta:` sort is never the default, so it is always
emitted in the URL (the "omit when default" path is untouched).

This reuses the grid reader's segmentation, so "full support" is the grid logic
plus one index computation — not a second ordering implementation.

### Shared schema

**`packages/shared/src/api.ts`**: widen `PhotoSort`, accept `meta:` in
`photosQuerySchema.sort` and `searchQuerySchema.sort`, export `metadataSort` /
`parseMetadataSort`. `PHOTO_SORTS` and `DEFAULT_PHOTO_SORT` are unchanged.

### Client: the sort hook

**`apps/web/src/lib/use-grid-sort.ts`** — `parseGridSort(stored)` currently
validates against the six fixed values. Widen it to also accept a syntactically
valid `meta:<id>:<dir>` string (via `parseMetadataSort`). It cannot verify the
field exists for the current catalog (it has no schema) — that resolution happens
where the date-field list is available (next section). Default remains
`DEFAULT_PHOTO_SORT`.

### Client: the menu

**`apps/web/src/components/grid-sort-menu.tsx`** gains a prop:

```ts
dateFields: { id: string; label: string }[]   // enabled Date fields for this catalog
```

When non-empty, render a `DropdownMenuSeparator` then, for each field, a
`DropdownMenuLabel` with the field's label and two `DropdownMenuRadioItem`s with
values `metadataSort(id, "desc")` ("Newest first") and `metadataSort(id, "asc")`
("Oldest first"). The `onValueChange` guard accepts a value that is either in
`PHOTO_SORTS` or equals one of the rendered date-field option values. No
`dateFields` → the menu is exactly as today.

### Client: sourcing the date fields & view wiring

The catalog metadata schema (with field types) is already available client-side —
the search facet panel renders custom fields from it and already branches on
`FieldType.Date` (`apps/web/src/app/(app)/c/[catalog]/search/metadata-facets.tsx`).
The grid views source `dateFields` from that same schema (enabled fields where
`type === FieldType.Date`, mapped to `{ id, label }`), gated on the metadata
feature being enabled for the catalog.

Each view (Library, Folder, Album, Search) that renders `<GridSortMenu>`:

- Passes `dateFields`.
- Computes an **effective sort** for display + fetch: if the stored sort is a
  `meta:` sort whose `fieldId` is **not** in this catalog's `dateFields`, treat it
  as `DEFAULT_PHOTO_SORT` (keeps the radio selection and the grid order
  consistent; the server would fall back anyway). Otherwise use the stored sort.
- Threads the effective sort into the grid `params` and the grid React `key`
  (remount-on-sort-change) and into tile hrefs — all of which already exist for the
  fixed sorts; the `meta:` string flows through unchanged because it is just a
  `PhotoSort` value.

## Data integrity (the ISO invariant)

Text sort over `PhotoMetadataValue.value` is chronological **only** if Date values
are ISO `YYYY-MM-DD`. The metadata Date picker writes exactly that —
`format(next, "yyyy-MM-dd")` in `apps/web/src/components/metadata/metadata-value-input.tsx`.

The implementation plan must **verify no non-picker write path** (e.g. the NLP /
preset metadata extraction, autocomplete free-text commit) can persist a Date
field as non-ISO text. If such a path exists, normalize to ISO at that write
boundary (parse + reformat; drop if unparseable). No generic change to
`upsertPhotoMetadataValue` is made unless a violating writer is found — the picker
is the only known writer and is already compliant.

## Data flow

```
catalog metadata schema ──► dateFields[{id,label}]
                                   │
useGridSort() ──sort──► view: effectiveSort(sort, dateFields)
                                   │
                                   ├─► <PhotoGrid params{sort=meta:…} key=…sort…>
                                   │        │
                                   │        ▼  GET /api/c/{cat}/photos?sort=meta:fid:desc&offset=…
                                   │   listPhotos → listPhotosForWhere(full, {sort})
                                   │        │
                                   │        ▼  resolveSort → {metadata, fieldId, dir}
                                   │   listPhotosByMetadata:
                                   │     seg1 = photoMetadataValue.findMany({where:{fieldId, photo:full},
                                   │              orderBy:[{value:dir},{photoId:dir}], include:{photo}})
                                   │     seg2 = photo.findMany({where:{...full, metadataValues:{none:{fieldId}}}})
                                   │
                                   └─► tile href /photo/{id}?…&sort=meta:fid:desc
                                            │
                                            ▼  parseDetailScope → scope{sort}
                                       getNeighborsForWhere(current, where, sort):
                                         resolveSort → metadataSortIndexOf(current) → window via same reader
```

## Edge cases

- **No value for the field** → photo sorts last, ordered by `id`; never disappears
  (the unvalued segment is part of the page total).
- **Field deleted / disabled / wrong catalog** → `resolveSort` returns standard,
  grid falls back to default ordering; the view drops the menu selection to default
  so the UI matches.
- **Ties (same date)** → broken by `photoId` in the sort direction, stable across
  pages and matching the detail-view sequence.
- **Sort change** → reuses the existing `key={…sort…}` remount, so the grid
  refetches from offset 0 under the new ordering; no stale pages mixed in.
- **Empty value** → `upsertPhotoMetadataValue` deletes the row for empty input, so
  an "empty" field is genuinely unvalued and lands in seg2 — consistent.
- **Global setting, per-catalog field** → a `meta:` sort chosen in one catalog is
  invalid in another lacking that field; handled by the effective-sort fallback
  (client) and `resolveSort` (server).
- **Page total** stays `photo.count(full)` and is unaffected by segmentation.

## Testing

Unit (pure):

- `metadataSort` / `parseMetadataSort` — round-trip; reject malformed / fixed-sort
  strings.
- `parseGridSort` — accepts well-formed `meta:` values, rejects garbage, defaults.
- `metadataPageSlice(offset, limit, seg1count)` — window in seg1, straddling the
  boundary, in seg2, empty seg1, empty seg2, offset ≥ total.
- effective-sort resolution — stored `meta:` field absent from `dateFields` →
  default; present → unchanged.

Integration / service (extend existing `listPhotosForWhere` / neighbor tests):

- `resolveSort` validation: valid Date field → metadata; disabled / non-Date /
  foreign-catalog / missing → standard.
- Grid ordering for a Date field (asc & desc): valued photos chronological by ISO
  value, ties by `photoId`, unvalued photos last — across at least Library, a Smart
  album, and Search (proving scope reuse).
- `getNeighborsForWhere` for a metadata sort: `metadataSortIndexOf` matches the
  grid position; prev/next/strip walk the same sequence as the grid.

Per repo convention, favor pure-function and service-ordering coverage over heavy
component rendering.

## Files touched

New:

- `apps/web/src/lib/server/metadata-sort.ts` — `resolveSort`, `listPhotosByMetadata`,
  `metadataSortIndexOf`, `metadataPageSlice`.

Modified:

- `packages/shared/src/api.ts` — widen `PhotoSort`, `meta:` in schemas,
  `metadataSort` / `parseMetadataSort`.
- `apps/web/src/lib/server/photos-service.ts` — `listPhotosForWhere` +
  `getNeighborsForWhere` / `getPhotoNeighbors` branch on resolved sort.
- `apps/web/src/lib/server/search-service.ts` — `searchPhotos` passes `sort`
  through (already does; ensure `meta:` validated).
- `apps/web/src/lib/use-grid-sort.ts` — `parseGridSort` accepts `meta:`.
- `apps/web/src/components/grid-sort-menu.tsx` — `dateFields` prop + radio groups.
- The grid views rendering `<GridSortMenu>` (Library / Folder / Album / Search) —
  pass `dateFields`, compute effective sort. Exact files pinned during planning.
- Test files alongside the above.

No migration. No change to `packages/db/prisma/schema.prisma`.
