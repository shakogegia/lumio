# Metadata Search & Smart Albums (Photo Metadata, Phase 2) — Design

**Date:** 2026-06-26
**Branch:** `gego/photo-metadata`
**Status:** Approved design → ready for implementation plan
**Builds on:** Phase 1 (per-catalog custom metadata — `MetadataGroup` / `MetadataField` / `PhotoMetadataValue`, the standard/custom field model, settings builder, lightbox + upload editors) and the parked PR #68 search engine (`gego/search-images-by-exif`, single commit `cd99db30`).

## 1. Goal

Make a catalog's metadata searchable and usable in smart albums. Concretely: in the catalog search box (and the filter panel) the user can find photos by the fields **they configured** — e.g. *Film Stock = Portra 400*, *Developer contains D76*, *Format in {6×6, 6×7}*, *Camera = Hasselblad 500C/M* — and use those same predicates as smart-album rules. This **replaces** the EXIF-only search idea: the searchable surface is the catalog's metadata schema, not raw EXIF.

## 2. Decisions (resolved during brainstorming)

1. **Foundation = reuse PR #68's engine** (not a fresh build). It is a single self-contained commit and merges with a 5-file additive conflict surface. We get `RuleOp`, `FilterSet`, `buildPhotoWhere`, the token parser, the filter-panel shell, the smart-album delegation, and the promoted EXIF columns for free.
2. **Searchable fields = the catalog's configured metadata schema only** (standard + custom). No open-world raw-EXIF (`exif.<anyKey>`) escape hatch.
3. **Standard (EXIF-backed) fields search their *effective* value** — the user's override if set, otherwise the EXIF value — so search is correct for film (hand-typed), digital (EXIF), and mixed catalogs.
4. **Scope cut for v1:** `PhotoMetadataValue.value` is stored as text, so range comparisons (`>`, `<`, between) on **custom** number/date fields would be lexicographically wrong. v1 gives custom number/date fields **equality / in-list / exists** only. Range filtering works on **standard** numeric/date fields via their typed EXIF columns. A typed shadow column for custom numerics is deferred until there's a real need.

## 3. Architecture

### 3.1 Foundation — bring PR #68 onto this branch

Cherry-pick `cd99db30`. Resolve the 5 overlapping files (all additive): `shared/src/enums.ts` (RuleOp expansion vs the metadata enums), `shared/src/index.ts` + `db/src/index.ts` (export appends), `db/prisma/schema.prisma` (promoted columns vs the 3 metadata models — different sections), and `app/(app)/c/[catalog]/search/search-view.tsx` (the one real merge). After the pick: full engine present, existing EXIF tests green.

**Promoted EXIF columns stay, but as an internal search index only** — they back standard/EXIF-backed fields' WHERE clauses and are never surfaced as a user-facing "promoted fields" UI. The user-facing model remains 100% the metadata schema. This keeps faith with the earlier rejection of a user-visible promoted-columns model while reusing the columns where they're genuinely useful (indexed, typed EXIF search).

### 3.2 Catalog-aware field registry

PR #68's static `FIELD_REGISTRY` is replaced by a **per-catalog registry built from `getCatalogSchema`**:

```ts
// shared: built per request from the catalog's enabled fields
type SearchFieldDef = {
  key: string;            // MetadataField.key (stable slug, unique per catalog) — used in tokens & rules
  label: string;          // MetadataField.label — chip/facet label
  type: FieldType;        // text | textarea | number | choice | date
  options: string[];      // choice options (empty otherwise)
  storage:
    | { kind: "metadata"; fieldId: string }                       // custom field
    | { kind: "standard"; fieldId: string; builtinKey: StandardFieldKey }; // EXIF-backed
  ops: RuleOp[];          // gated by type (see §4)
};

function buildSearchRegistry(schema: MetadataSchema): Map<string /*key*/, SearchFieldDef>;
```

`FilterRule.field` references the field **`key`** (stable across label renames; readable in tokens like `film-stock:Portra`). Because resolution is now per-catalog, `buildPhotoWhere` and `smartAlbumWhere` take the registry (or schema) as a parameter instead of reaching into a global. Callers (search route, albums-service) already have the `catalogId` and load the schema.

### 3.3 Standard field → EXIF column map

| StandardFieldKey | Promoted column | Type |
|---|---|---|
| `camera` | `cameraModel` (make deduped in display; search matches model) | String |
| `lens` | `lensModel` | String |
| `iso` | `iso` | Int |
| `shutter` | `exposureTime` | Float (seconds) |
| `aperture` | `fNumber` | Float |
| `focal` | `focalLength` | Float |
| `date` | `takenAt` | DateTime |

## 4. The compiler (`buildPhotoWhere` extensions)

Ops allowed per field **type**:

| type | ops |
|---|---|
| text, textarea | `eq`, `contains`, `in_list`, `not_in_list`, `exists`, `not_exists` |
| choice | `eq`, `in_list`, `not_in_list`, `exists`, `not_exists` |
| number, date (**standard**) | `eq`, `gt`, `gte`, `lt`, `lte`, `between`, `exists`, `not_exists` |
| number, date (**custom**) | `eq`, `in_list`, `exists`, `not_exists` *(no range — §2.4)* |
| bool (`hasGps`, standard only) | `eq`, `exists` |

Two new `compileRule` branches:

**(a) Custom field — `storage.kind === "metadata"`** → `PhotoMetadataValue` relation-EXISTS (identical shape to the album predicate already in the engine; `Photo.metadataValues` back-relation already exists, no migration):

```ts
eq          → { metadataValues: { some: { fieldId, value: { equals: v, mode: "insensitive" } } } }
contains    → { metadataValues: { some: { fieldId, value: { contains: v, mode: "insensitive" } } } }
in_list     → { metadataValues: { some: { fieldId, value: { in: vals } } } }
not_in_list → { metadataValues: { none: { fieldId, value: { in: vals } } } }
exists      → { metadataValues: { some: { fieldId } } }
not_exists  → { metadataValues: { none: { fieldId } } }
```

**(b) Standard field — `storage.kind === "standard"`:**

- **String standard fields (camera, lens) — effective value (override ?? EXIF):**
  ```ts
  eq/contains → { OR: [
      { metadataValues: { some: { fieldId, value: <op clause> } } },                 // override matches
      { AND: [ { metadataValues: { none: { fieldId } } }, { <column>: <op clause> } ] } // no override, EXIF matches
  ] }
  in_list     → same OR shape with { in: vals }
  not_in_list → { OR: [ { metadataValues: { some: { fieldId, value: { notIn: vals } } } }, { AND: [ { metadataValues: { none: { fieldId } } }, { <column>: { notIn: vals } } ] } ] }
  exists      → { OR: [ { metadataValues: { some: { fieldId } } }, { <column>: { not: null } } ] }
  not_exists  → { AND: [ { metadataValues: { none: { fieldId } } }, { <column>: null } ] }
  ```
- **Numeric/date standard fields (iso, aperture, focal, shutter, date)** → typed EXIF **column** directly (correct numeric/date ordering). v1 honors overrides on these only implicitly via the column; numeric-override coalescing is deferred (overrides on numeric EXIF fields are rare). Range/eq/between map straight onto the column as PR #68 already does. (There is no bool/`hasGps` standard field — `StandardFieldKey` is exactly camera/lens/iso/shutter/aperture/focal/date.)

Top-level AND/OR aggregation (`match: all | any`) is unchanged from PR #68.

## 5. Search API & value discovery

- **Search route** already accepts `filter=<JSON FilterSet>` (validated by `searchQuerySchema`). It additionally loads the catalog schema → builds the registry → passes it into `buildSearchWhere`/`buildPhotoWhere`. Unknown/disabled field keys in a FilterSet are dropped (defensive).
- **Value discovery:** choice options come straight from the schema (no fetch). Text autocomplete reuses the existing `GET /api/c/[catalog]/metadata/suggest?field=<fieldId>&q=<prefix>` (`suggestFieldValues`, backed by the `@@index([fieldId, value])`). No new discovery endpoint required.

## 6. Search UI

Reuse PR #68's two entry points, both now driven by the catalog schema:

- **Filter panel** — one facet per enabled field, chosen by field **type**:
  - choice → multiselect over the field's `options` (no fetch).
  - text/textarea → contains/equals input with autocomplete (`suggest`).
  - number/date (standard) → range facet.
  - bool → toggle.
- **Token box** — `film-stock:Portra`, `camera:Hasselblad`, `iso:>=800`, `format:6×6,6×7`, using each field's `key`. The existing `parseFilterTokens` / `ruleToToken` / `formatRuleLabel` handle `field:op value`, quoted values, and chip labels (small additions for metadata field labels).

## 7. Smart albums

Almost free. Smart albums already persist `rules: Json` and evaluate at query time through `smartAlbumWhere → buildPhotoWhere`. Once the compiler understands metadata fields, smart-album rules referencing them work with **zero new backend** (the same registry is loaded from the album's catalog). The only new work is letting the smart-album rule builder pick metadata fields — reusing the exact type-driven facet components from §6.

## 8. Phasing

Three shippable slices (mirrors the EXIF-search 2a/2b split):

- **2a — Backend.** Cherry-pick PR #68 + resolve conflicts; `buildSearchRegistry(schema)`; the two `compileRule` branches (custom relation + standard effective-value); thread the registry through `buildPhotoWhere` / `smartAlbumWhere` / `buildSearchWhere`; load schema in the search route + albums-service. Pure DI unit tests. **No UI.**
- **2b — Search UI.** Schema-driven filter panel facets (choice/text/number/date/bool) + token chips + autocomplete. Wires to 2a.
- **2c — Smart-album rule builder** over metadata fields, reusing 2b's facet components.

## 9. Testing

- **`buildPhotoWhere` (DI unit tests)** — the core. Cases that matter most:
  - custom choice `in_list` → `some.value.in`; `not_in_list` → `none`.
  - custom text `contains` (insensitive).
  - custom `exists` / `not_exists`.
  - **standard string effective value**: override-present matches override; override-absent falls back to EXIF column; the OR/AND shape for both. (The film-vs-digital correctness cases.)
  - standard numeric `between` → column range.
  - disabled/unknown field key → rule dropped.
- **`buildSearchRegistry`** — maps standard fields to the right column + ops; custom fields to `{kind:"metadata"}`; ops gated by type (custom number excludes range).
- **Smart album** — a metadata rule round-trips through `smartAlbumWhere`.
- Existing EXIF-engine tests from PR #68 stay green after the cherry-pick.

## 10. Out of scope / future

- Range filtering on **custom** number/date fields (needs a typed shadow column or SQL cast) — deferred (§2.4).
- Numeric-override coalescing for standard numeric fields (rare) — deferred.
- Raw arbitrary-EXIF search (`exif.<key>`) — intentionally dropped (decision §2.2).
- Free-text full-catalog metadata search (one box matching across all fields) — possible later; v1 is field-scoped predicates.
- **Persisting metadata-field rules in *smart albums*** needs the write-side rule schema (`smartRuleSchema` in `apps/web/src/.../albums.ts`, currently a hardcoded `last_30_days` + `cameraModel:eq` union) extended to accept registry-validated rules — deferred to **2c** alongside the smart-album rule builder. The read/compile path (`smartAlbumWhere` → `buildPhotoWhere` + registry) is already metadata-aware as of 2a.
- The per-catalog registry is rebuilt per request (one `getCatalogSchema` call per search / smart-album evaluation, and twice in `albumSummary`→`albumCoverId`). Acceptable for now; cache or thread the registry down if it shows up hot.

## 11. Open questions

None blocking. Standard-numeric override coalescing and custom-numeric range are explicit, accepted deferrals.
