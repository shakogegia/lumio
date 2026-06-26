# Custom Photo Metadata — Design (Phase 1)

Date: 2026-06-25
Status: Approved for spec → planning
Supersedes the direction of the in-flight EXIF-search work (PR #68). See "Relationship to PR #68".

## Problem

Lumio's libraries mix **digital** photos and **film scans**. Digital photos carry rich,
standardized EXIF (camera, lens, ISO, shutter, aperture, focal length, date) — for them
there's nothing to type. Film scans are different:

- Their meaningful data — film stock, film ISO, format, the *film* camera, light source,
  developer, lab — lives in a **converter-specific XMP namespace** (e.g. Negative Lab Pro
  writes `filmexif:FilmStock`, `filmexif:CameraMake`), and **every converter app names things
  differently**. A hardcoded EXIF→field map is brittle across apps.
- Many scans arrive **bare** (no useful metadata at all), so the user must be able to **enter
  it by hand**.
- The standardized EXIF that *is* present often tells the wrong story: `Make = "NIKON D800"`
  is the **scanning camera**, not the Bronica RF645 that took the frame.

The user wants to (1) **see** a photo's meaningful metadata laid out nicely, and (2) **search /
build smart albums** over it — for both digital and film, without fighting namespaces.

The earlier approach (denormalized "promoted" EXIF columns + a generic EXIF-field search) was
geared to standardized digital tags and did not address authoring data for bare scans or the
per-app namespace problem. This design replaces it with a **user-defined, editable metadata
model** that treats EXIF as one (optional) source rather than the foundation.

## Core idea

Two kinds of fields living side by side in one grouped panel:

- **Standard fields** — camera, lens, ISO, shutter, aperture, focal length, date. Backed by
  **standardized EXIF tags** (reliable), shown **icon-led** (like Apple Photos / the reference
  screenshot). Auto-filled, nothing to type. Per catalog they can be **toggled off** (a film
  catalog hides the scanner's Nikon noise) and their value **overridden** when EXIF is wrong.
- **Custom fields** — film stock, developer, lab, anything. **User-defined** (name + type +
  group), **typed in with autocomplete** from the user's own past values (Lightroom-style),
  EXIF-namespace-independent. Optionally linked to a converter key **later** (Phase 3).

Supporting concepts:

- **Groups** order fields into sections (Film, Process, Camera & exposure…).
- **Presets are starter *schemas*, not value bundles.** Applying the built-in **Film** or
  **Digital** preset instantiates a sensible set of groups + fields + enabled-standard config
  for a catalog; the user edits from there and can **save their own** preset to reuse on
  another catalog. This is the concrete meaning of "film / digital / mixed catalog".
- **Values** for custom fields (and standard-field overrides) are stored per photo; standard
  values without an override are read through from `Photo.exif`. **Bulk-fill** sets a whole
  roll at once.

## Goals (Phase 1)

1. A per-catalog **metadata schema**: groups + fields (standard | custom), types, ordering,
   per-catalog enable/disable, "suggests" toggle.
2. **Presets** as starter schemas: built-in **Film** + **Digital**, plus **save-as-preset**.
3. A **value store** for custom fields and standard overrides, with **manual entry +
   autocomplete** and **bulk-fill** across a selection.
4. **Standard fields auto-filled** from a shared standardized-EXIF registry (no promoted
   columns, no per-app namespaces).
5. **Info-tab rendering**: icon-led standard block + custom groups, with inline editing.
6. **Upload-time entry panel**, shown when the catalog has ≥1 enabled custom field.
7. The whole thing behind a **feature gate** (`FeatureKey.Metadata`, per-catalog scope).

## Non-goals (later phases)

- **Phase 2 — Find:** `@field op value` search box + smart-album rules over metadata values.
  Reuses the existing predicate engine (`buildPhotoWhere`) but pointed at the value store
  instead of promoted columns.
- **Phase 3 — EXIF auto-fill for *custom* fields:** the opt-in "link this custom field to
  `filmexif:FilmStock`" mapping that pre-fills from a converter's namespace. This is the only
  place the namespace mess lives; quarantined here.
- Metadata "housekeeping" page (rename/merge a value across photos) — nice-to-have, deferred.
- Roll entities / first-class roll grouping. Phase 1 approximates "a roll" with a multi-select.

## Always-on baseline (not gated)

Independent of the feature, the **standard registry** (below) is used to render the lightbox
**Info tab** as an **icon-led standard summary** (camera body + shutter/ISO; aperture + focal;
date), improving today's hardcoded rows. This needs no config and works for every photo from
its existing `Photo.exif`. The **feature gate** wraps everything *configurable*: custom fields,
per-catalog standard enable/disable + overrides, presets, the settings page, entry surfaces.

## Data model

New Prisma models in `packages/db/prisma/schema.prisma`. All metadata config is **per catalog**.

```prisma
model MetadataGroup {
  id        String          @id @default(cuid())
  catalogId String
  catalog   Catalog         @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  label     String
  position  String          // fractional index, sorted COLLATE "C" (see Ordering)
  fields    MetadataField[]
  @@index([catalogId])
}

model MetadataField {
  id         String         @id @default(cuid())
  catalogId  String
  catalog    Catalog        @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  groupId    String?
  group      MetadataGroup? @relation(fields: [groupId], references: [id], onDelete: SetNull)
  key        String         // stable slug, unique per catalog (e.g. "film-stock")
  label      String
  type       String         // FieldType enum: text | textarea | number | choice | date
  kind       String         // FieldKind enum: standard | custom
  builtinKey String?        // for kind=standard: links to STANDARD_FIELDS registry key
  enabled    Boolean        @default(true)
  suggests   Boolean        @default(true)
  position   String         // fractional index within its group, COLLATE "C"
  values     PhotoMetadataValue[]
  @@unique([catalogId, key])
  @@index([catalogId])
}

model PhotoMetadataValue {
  id      String        @id @default(cuid())
  photoId String
  photo   Photo         @relation(fields: [photoId], references: [id], onDelete: Cascade)
  fieldId String
  field   MetadataField @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  value   String        // stored as text; interpreted per field.type
  @@unique([photoId, fieldId])
  @@index([fieldId, value]) // backs autocomplete/distinct
}

model MetadataPreset {      // user-saved starter schemas (built-ins are code constants)
  id         String   @id @default(cuid())
  name       String
  definition Json     // groups + fields snapshot (no catalog/photo refs)
  createdAt  DateTime @default(now())
}
```

Notes:

- **One value table for both kinds.** A custom field's value = its stored row. A standard
  field's *displayed* value = its stored override row **if present**, else the EXIF-derived
  value from the registry. So "override a standard field" is just "write a value row for it".
- **Standard fields are rows too** (`kind = standard`, `builtinKey` set). This makes the
  settings UI uniform (one list to toggle/reorder) and gives standard fields a home for
  per-catalog enable/order/group/override. Their *type/label/icon/EXIF-source* come from the
  shared registry via `builtinKey`; the row only carries per-catalog state.
- Use **TS `enum`s** (`FieldType`, `FieldKind`) in `packages/shared/src/enums.ts` style, not
  `as const` arrays, consistent with the codebase.
- **Field-type semantics (v1):** `text` (single line + autocomplete), `textarea` (multi-line
  notes, no autocomplete), `number` (validated numeric), `choice` (single line + autocomplete —
  behaves like `text` with suggestions; **no separately-managed dropdown option-list in Phase
  1**, so NLP's dropdowns like Film Format become free text that suggests prior values), `date`
  (`YYYY-MM-DD`). Constrained option-lists are a later refinement.

### Standard registry (shared)

New `packages/shared/src/metadata-standard.ts`: a constant registry of standard fields, the
single source of truth for the standardized-EXIF mapping (reuses logic already in
`apps/web/src/lib/exif-entries.ts` / `packages/ingest/src/metadata.ts`):

```
STANDARD_FIELDS = [
  { key:"camera",   label:"Camera",       type:text,   icon:"camera",   fromExif: Make+Model },
  { key:"lens",     label:"Lens",         type:text,   icon:"camera",   fromExif: LensModel },
  { key:"iso",      label:"ISO",          type:number, icon:"camera",   fromExif: ISO },
  { key:"shutter",  label:"Shutter",      type:text,   icon:"camera",   fromExif: ExposureTime→"1/100 s" },
  { key:"aperture", label:"Aperture",     type:number, icon:"aperture", fromExif: FNumber→"ƒ/8" },
  { key:"focal",    label:"Focal length", type:number, icon:"aperture", fromExif: FocalLength→"55 mm" },
  { key:"date",     label:"Date",         type:date,   icon:"calendar", fromExif: DateTimeOriginal },
]
```

`fromExif(exif)` is pure and reads only standardized tags. No promoted columns, no namespaces.

### Built-in presets (shared)

`packages/shared/src/metadata-presets.ts` — `Film` and `Digital` as data:

- **Digital**: enable all standard fields, grouped "Camera & exposure". No custom fields.
- **Film**: the canonical preset, mirroring **Negative Lab Pro's film-metadata sections**
  (source: https://www.negativelabpro.com/guide/film-metadata/ — sections 2–5). All custom
  fields (entered by the user; these describe the **film** camera/shoot, distinct from the
  scanner's standard EXIF, which the preset **disables**). Four groups:

  - **Equipment** — Camera Make (text), Camera Model (text), Lens Make (text),
    Lens Model (text), Film Stock (text), Film ISO (number), Film Format (choice),
    Gear Notes (textarea)
  - **Shooting** — Shot at ISO (number), Aperture (number), Shutter Speed (text, e.g. "1/32"),
    Focal Length (number, mm), Date (date), Shooting Notes (textarea)
  - **Digitization** — Scan Method (choice), Scan Equipment (text), Light Source (text),
    Film Holder (text), Digitization Notes (textarea)
  - **Development** — Push-Pull (choice), Developed At (choice), Developer (text),
    Dilution (text), Dev Time / Temp (text), Dev Method (text), Dev Notes (textarea)

  The preset is a **starting point** — the user trims/edits freely after applying.

Applying a preset instantiates `MetadataGroup`/`MetadataField` rows for the catalog
(idempotent-ish: applying replaces or merges — decision below). "Save as preset" snapshots the
catalog's current groups+fields into a `MetadataPreset`.

## Surfaces

### 1. Metadata settings page (schema builder)

Under settings, per catalog (sibling to the existing per-catalog upload-template form at
`apps/web/src/app/(app)/settings/catalogs/[id]/`). Gated by `FeatureKey.Metadata`.

- Empty state: "Start from a preset" → **Film / Digital / Blank**.
- Lists groups (reorderable) each holding fields (reorderable, draggable across groups).
- Per field: label, type, **enabled** toggle, **suggests** toggle. Standard fields show their
  EXIF source read-only; custom fields are fully editable; `+ Add field`, `+ Add group`.
- **Save as preset** button.

### 2. Lightbox Info tab (display + inline edit)

Extend `apps/web/src/features/lightbox/lightbox-sidebar.tsx` (the `LightboxTab.Info` content):

- **Standard block** (always-on baseline): icon-led summary from `STANDARD_FIELDS` + `Photo.exif`,
  honoring per-catalog enabled/override when the feature is on.
- **Custom groups** (gated): each enabled group → rows (`label : value`), **inline-editable**
  with autocomplete; empty rows invite input; value badges show source (`EXIF` vs `you`).
- The existing **EXIF** tab (raw dump) stays as-is for power users.

### 3. Bulk fill (a "roll")

Grid multi-select → a "Edit metadata" action (alongside the existing `SelectionActions`,
`apps/web/src/components/photo-actions/`). Opens the same field form; writing applies the
entered values to all selected photos (`PhotoMetadataValue` upserts). This is the per-roll path
until first-class rolls exist.

### 4. Upload-time entry

In `apps/web/src/app/(app)/c/[catalog]/upload/upload-client.tsx`: when the catalog has ≥1
enabled **custom** field, show a metadata entry panel (same field form + autocomplete) that
applies to the whole upload batch. Thread values through the POST to
`/api/c/[catalog]/uploads` and `handleUpload` (`apps/web/src/lib/server/upload-service.ts`),
which writes `PhotoMetadataValue` rows after the `Photo` insert.

### 5. Autocomplete endpoint

`GET /api/c/[catalog]/metadata/suggest?field=<fieldId>&q=<prefix>` → distinct prior values for
that field (most-used first), via `groupBy` on `PhotoMetadataValue` filtered to the catalog's
photos. Reuse the cached-discovery pattern from `apps/web/src/lib/exif-discovery.ts`.

## Feature gating

Register in `packages/shared/src/features.ts`:

```
FeatureKey.Metadata = "metadata"
FEATURES[Metadata] = { label:"Photo metadata", description:"Custom fields, presets, and
  per-catalog metadata.", scopes:[Catalog], default:false }
```

- **Server:** guard the settings page, the metadata APIs, and value writes with
  `isFeatureEnabled(catalogId, FeatureKey.Metadata)`.
- **Client:** wrap the settings page, the Info-tab custom block, the bulk action, and the
  upload panel in `<FeatureGate feature={FeatureKey.Metadata}>`.
- Toggle lives in the existing per-catalog features form
  (`settings/catalogs/[id]/catalog-features-form.tsx`).

## Ordering

Group and field ordering use **fractional-index strings**. The `position` columns MUST sort
with `COLLATE "C"` (byte order) — `en_US.utf8` mis-sorts uppercase fractional keys and would
reproduce the known "move-to-first reverts" reorder bug. Apply the collation in the migration.

## Migrations & the shared dev DB

This adds four tables. **Do not run `prisma migrate` against the shared dev DB** (all worktrees
share one Postgres on :5433; an unreviewed migration shows up as drift elsewhere). Generate the
migration, review the SQL (including the `COLLATE "C"` on `position`), and apply it deliberately
per the project's migration recipe. `prisma generate` only, until the migration is intentionally
applied.

## Relationship to PR #68

PR #68 (promoted EXIF columns + generic EXIF-field search/facets) is **not merged**. The
promoted-columns + ingest-derive + backfill parts are superseded and should be dropped. The
**predicate engine** (`buildPhotoWhere`, `FilterSet`, the field-registry/op model) is worth
**salvaging for Phase 2** search over metadata values. Recommendation: **park / close PR #68**
(its code remains on the branch) and cherry-pick the engine when Phase 2 starts.
Decision owner: user. (Open.)

## Suggested internal sequencing for Phase 1

To keep the plan reviewable, build in two slices:

- **1a — See:** standard registry + icon-led Info-tab standard block (always-on);
  `MetadataField`/`Group`/`Value` models + migration; feature flag; custom-group display +
  single-photo inline edit + autocomplete endpoint.
- **1b — Configure & fill at scale:** settings/schema-builder page; built-in presets +
  apply/save; bulk-fill selection action; upload-time entry panel; per-catalog standard
  enable/disable + override.

## Decisions (resolved 2026-06-25)

1. **PR #68:** **parked** — not merged; its code stays on `gego/search-images-by-exif`. Only the
   predicate engine is salvaged later, for Phase 2.
2. **Apply-preset semantics:** **replace** when the catalog's schema is empty; **append (with
   confirm)** when it already has fields.
3. **Standard-field rows seeding:** **lazy** — created on first feature-enable / first
   preset-apply, never on catalog creation, so non-film catalogs stay clean.
4. **User-saved presets (`MetadataPreset`):** **kept in 1b**.
5. **Number/date typing:** **stored as text + validated per `type`** on write. Revisit if Phase 2
   range search needs typed columns.

## Testing approach

- **shared:** registry resolvers (`fromExif` formatting: shutter `1/100 s`, aperture `ƒ/8`,
  focal `55 mm`), preset definitions, field/enum validation (Zod), fractional-index ordering.
- **db:** schema CRUD, value upsert + override resolution (stored override beats EXIF),
  distinct-values/autocomplete query, COLLATE "C" ordering round-trip.
- **web:** Info-tab rendering (standard icon-led + custom groups, gated), inline edit + bulk
  fill, upload-panel value threading, feature-gate on/off behavior.
- Browser smoke on a real film scan (`cmqtx7tfj000zms4tfku8w25j`: Bronica / Portra 400 / Raleno)
  and a digital photo.
