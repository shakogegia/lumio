# File Extension Storage & Search — Design

**Date:** 2026-06-27
**Branch:** `gego/ingest-file-metadata`
**Status:** Approved design → ready for implementation plan
**Builds on:** the metadata search engine (`buildPhotoWhere`, `buildSearchWhere`, the static `FIELD_REGISTRY`, the per-catalog metadata registry, the search filter panel + facets) and the ingest/upload pipeline (`ingestPath` → `storePhoto`).

## 1. Goal

Store each photo's **file extension** as a first-class, indexed, queryable field, and let users **filter the grid by it** (e.g. "show only `cr2`", or `jpg` + `heic`). Extension is treated as a **built-in system field** — a hard file fact — not as user-editable catalog metadata. The exact (literal) extension is stored now; a coarse RAW/JPEG/HEIC "kind" grouping is a future pure-derivation follow-up that needs no schema change.

## 2. Decisions (resolved during brainstorming)

1. **Store the literal extension, lowercased, no dot** — `cr2`, `nef`, `jpeg`. Case is normalized (`.JPG` → `jpg`) but format identity is preserved: `jpg` ≠ `jpeg`. This is the whole reason for a normalized column over `LIKE '%.cr2'` on `path` (case-folding + indexability).
2. **System field, not metadata.** Extension lives in the static `FIELD_REGISTRY` and a new `SYSTEM_FIELD_KEYS` allowlist — **not** in the per-catalog metadata schema. Users must not rename, disable, reorder, override, or delete it. (The metadata schema is deliberately empty-by-default and user-curated; a file fact does not belong there, and the standard-field override-via-`PhotoMetadataValue` machinery is meaningless for it.)
3. **Backfill in the migration**, derived from `path` — no re-ingest. The migration is purely additive (add column with default + index + one `UPDATE`), safe for the shared dev DB.
4. **Future "kind" grouping is out of scope** — a static `extension → kind` lookup computed at query/display time, no new column.

## 3. Architecture

### 3.1 Data model

One new column on `Photo` (`packages/db/prisma/schema.prisma`):

```prisma
extension String @default("")   // literal ext, lowercased, no dot: "cr2", "jpeg"; "" = none

@@index([catalogId, extension]) // catalog-scoped filtering + distinct-values facet
```

- **Non-null, default `""`.** Every real ingested file has an extension (the `isSupportedImage` gate guarantees one), so a nullable column buys nothing; `""` cleanly represents the no-extension edge case.
- **`TrashedPhoto` is left untouched** — trashed photos are not searched.

### 3.2 Extraction & normalization helper

Single source of truth in `@lumio/shared`, beside `isSupportedImage` (`packages/shared/src/formats.ts`):

```ts
/** Last ".xxx" segment of a filename/path, lowercased, without the dot. "" if none.
 *  Pure string op (no fs) so the browser, ingest, and tests all share it. */
export function fileExtension(nameOrPath: string): string {
  const base = nameOrPath.slice(nameOrPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no dot, or dotfile (".gitignore")
  return base.slice(dot + 1).toLowerCase();
}
```

Normalization rule: **lowercase only.** No `jpg`→`jpeg` folding (exact extension is the requirement). `a.tar.gz` → `gz` (last segment). `photo.` → `""`. `.gitignore` → `""`.

### 3.3 Population (ingest + upload)

Both ingest entry points (`ingestPath` for the filesystem watcher, and the upload service which calls `ingestPath` with `source: upload`) funnel through `storePhoto`. One line there covers **both**:

In `packages/ingest/src/store.ts`, add to the `data` object (lands on both `create` and `update`):

```ts
extension: fileExtension(relPath),
```

`relPath` is the catalog-relative path already in `StoreInput.path`. Derived from the path (not EXIF), so it stays inline in `store.ts` rather than going through `derivePromotedFields`. The upload service already computes `path.extname(...)` for *validation* (`upload-service.ts:37`); the **stored** value comes solely from `store.ts`, keeping a single write path.

### 3.4 Backfill migration

Hand-edited Prisma migration (generate the column with `prisma migrate dev`, then add the `UPDATE` + index, since Prisma will not author the backfill):

```sql
ALTER TABLE "Photo" ADD COLUMN "extension" TEXT NOT NULL DEFAULT '';

-- Derive from the stored relative path: chars after the final dot, excluding any
-- that are dots or slashes, anchored to end-of-string. substring() returns NULL
-- when there is no extension; COALESCE keeps the NOT NULL column valid.
UPDATE "Photo" SET "extension" = COALESCE(lower(substring("path" from '\.([^./]+)$')), '');

CREATE INDEX "Photo_catalogId_extension_idx" ON "Photo" ("catalogId", "extension");
```

Additive + idempotent; safe to apply to the shared Postgres (port 5433). No data is destroyed or moved.

### 3.5 Search integration — the system-field gate

The web search API gates every user filter rule against the **per-catalog metadata registry** (`search-service.ts` → `buildSearchRegistry(getCatalogSchema(...))`), silently dropping any rule whose field is not a configured metadata field (`packages/db/src/search.ts:38-43`). A built-in column alone is therefore **not** searchable on the search page. We admit extension as an explicit system field:

1. **Register in the static `FIELD_REGISTRY`** (`packages/shared/src/filters.ts`):
   ```ts
   extension: {
     key: "extension", label: "File type", type: ValueType.string,
     storage: { kind: "column", column: "extension" },
     ops: [RuleOp.eq, RuleOp.ne, RuleOp.in_list, RuleOp.not_in_list],
     aliases: ["ext", "filetype"],
   },
   ```
   This makes `compileRule` → `columnClause` emit `{ extension: { in: [...] } }` for free, and also lights up smart albums (registry-less, via `resolveField`) and `ext:cr2` token search.

2. **Export an allowlist** (`packages/shared/src/filters.ts`):
   ```ts
   export const SYSTEM_FIELD_KEYS = new Set<string>(["extension"]);
   ```

3. **One surgical gate change** in `packages/db/src/search.ts` (the `filterRules` filter, ~line 38): keep a rule when it's in the per-catalog `registry` **or** in `SYSTEM_FIELD_KEYS`, validating its op via `resolveField`:
   ```ts
   const filterRules = registry
     ? (p.filter?.rules ?? []).filter((r) => {
         const d = registry.get(r.field) ?? (SYSTEM_FIELD_KEYS.has(r.field) ? resolveField(r.field) : undefined);
         return !!d && (d.ops.length === 0 || d.ops.includes(r.op));
       })
     : (p.filter?.rules ?? []);
   ```
   Deliberately admits **only** the system-field allowlist — not all of `FIELD_REGISTRY` — so we don't accidentally re-enable the otherwise-gated EXIF token fields.

### 3.6 File-type facet UI

- **DB helper** `distinctExtensions(catalogId)` (`packages/db/src/extensions.ts`): distinct non-empty `extension` values present in the catalog, sorted. (Uses the `@@index([catalogId, extension])`.)
- **Route** `GET /api/c/[catalog]/extensions` → `{ extensions: string[] }`, catalog-scoped like the other search facet endpoints.
- **Component** `<FileTypeFacet>`: fetches that list and renders the existing **`FacetMultiselect`** with `fieldKey="extension"`, `label="File type"`, `staticOptions={extensions}`. `FacetMultiselect`'s `applyMultiselect`/`readMultiselect` (`panel-rules.ts`) already emit and read `in_list` rules on the field key — **no new rule plumbing**.
- **Placement:** rendered in `filter-panel.tsx` alongside `<MetadataFacets>`, as an always-present "File type" section (it is not part of the metadata schema, so it is added explicitly, not via the schema map).

## 4. Data flow

```
ingest/upload ─ ingestPath ─ storePhoto ─ data.extension = fileExtension(relPath) ─ Photo.extension
                                                                                         │
search box / File-type facet ─ FilterRule{field:"extension", op:in_list, value:[...]} ──┤
                                                                                         ▼
  search.ts gate (registry ∪ SYSTEM_FIELD_KEYS) ─ buildPhotoWhere ─ columnClause ─ { extension: { in: [...] } }
```

## 5. Error handling & edge cases

- **No extension** (no dot / dotfile / trailing dot): stored `""`; `distinctExtensions` filters out `""` so it never appears as a facet option.
- **Case folding:** `.JPG` and `.jpg` unify to `jpg`; `jpg` and `jpeg` stay distinct (exact, by design).
- **Re-ingest:** `path` is unchanged on a content re-import, so the recomputed extension is stable (and the `update` branch sets it anyway).
- **Backfill NULL guard:** `COALESCE(..., '')` keeps the `NOT NULL` column valid for extension-less rows.

## 6. Testing

- **Unit — `fileExtension()`** (`packages/shared`): upper/lower-case, no-dot, dotfile, multi-dot (`a.tar.gz`→`gz`), trailing dot, full directory paths.
- **Unit — search gate** (extend `packages/db/src/search.test`): an `extension` `in_list` rule **survives** the per-catalog gate even with an empty/unrelated metadata schema; an unknown non-system field is still **dropped**; the rule compiles to `{ extension: { in: [...] } }`.
- **Unit — store** (`packages/ingest` store test): `extension` is populated from `path` on both `create` and `update`.
- **React render tests skipped** for the facet (no render harness for these components, per existing convention) — coverage lives in the pure `fileExtension` + gate + `panel-rules` logic.

## 7. Out of scope (easy follow-ups)

- Showing extension in the photo-info panel (next to #111's folder / resolution / megapixels / file size).
- The RAW/JPEG/HEIC **"kind"** grouping — a static `extension → kind` lookup, no schema change.
- Adding extension to the search box `@`-autocomplete (`facets.ts` `FACETS`).
- Storing MIME type / color space / bit depth (the broader "file facts" pass).

## 8. Files touched

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | `extension` column + `@@index([catalogId, extension])` |
| `packages/db/prisma/migrations/<new>/migration.sql` | add column + backfill `UPDATE` + index |
| `packages/shared/src/formats.ts` | `fileExtension()` helper |
| `packages/shared/src/filters.ts` | `extension` `FIELD_REGISTRY` entry + `SYSTEM_FIELD_KEYS` |
| `packages/shared/src/index.ts` | export `fileExtension`, `SYSTEM_FIELD_KEYS` (as needed) |
| `packages/db/src/search.ts` | gate admits `SYSTEM_FIELD_KEYS` |
| `packages/ingest/src/store.ts` | set `extension: fileExtension(relPath)` |
| `packages/db/src/extensions.ts` (+ index export) | `distinctExtensions(catalogId)` |
| `apps/web/src/app/api/c/[catalog]/extensions/route.ts` | distinct-extensions endpoint |
| `apps/web/src/app/(app)/c/[catalog]/search/file-type-facet.tsx` | `<FileTypeFacet>` |
| `apps/web/src/app/(app)/c/[catalog]/search/filter-panel.tsx` | render `<FileTypeFacet>` |
| tests | `fileExtension`, search-gate, store |
