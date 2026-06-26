# Selection Inspector Panel — Design

**Branch:** `gego/photo-metadata` · **Date:** 2026-06-26

## Goal

Give the photo grid a docked, Lightroom-style **detail/inspector panel**, opened from the
selection toolbar, that shows and edits the selected photos' info **without entering the
lightbox**. The headline workflow is **bulk metadata filling** — select a whole roll, set
Film Stock / Camera once, applied to all — but the panel is the full "Info" experience for a
single photo too.

A second, equally important goal: **extract the lightbox's Info-tab body into a shared
component** so its design lives in exactly one place. Redesign it once and it updates in both
the lightbox and the inspector.

## Decisions (locked during brainstorming)

1. **Docked, non-modal panel** (not an overlay sheet). It pushes the grid left and stays open
   while you keep clicking/selecting in the grid; it live-updates to the current selection.
2. **Two distinct modes by selection size:**
   - **1 selected** → the full Info tab, *identical* to the lightbox (standard EXIF summary,
     file rows, editable custom metadata, album membership).
   - **2+ selected** → a **bulk-edit** view: editable custom metadata fields only, each showing
     the shared value or a "Mixed" placeholder. Read-only per-photo rows (Hash, file dates,
     "Appears in") are hidden because they can't be a single value.
3. **Bulk saving is live per-field.** Committing a field (blur/enter) writes it to *all*
   currently-selected photos immediately — no Apply button. The single-photo view is also live
   autosave (unambiguously that one photo), exactly like the lightbox today.
4. **Wire into all grid views**, including the bespoke search view.

## Key finding: the backend and the bulk editor already exist

The live-per-field bulk model (decision 3) is **already built and shipped** for the upload page:

- **DB** (`packages/db/src/metadata.ts`): `aggregatePhotoMetadataValues(photoIds)` → per-field
  `{ value, mixed }` (shared value when all selected agree, else `mixed: true`);
  `bulkUpsertPhotoMetadataField(photoIds, fieldId, value)` → set/clear one field across many
  photos in a transaction.
- **Route** (`/api/c/[catalog]/metadata/selection`): `POST` returns the aggregate;
  `PUT` writes one field across the (catalog-scoped, ownership-filtered) selection.
- **UI** (`upload/upload-metadata-form.tsx`): `UploadMetadataForm` is already a selection-bound,
  Mixed-aware, live-per-field editor with the tricky edge cases handled (never wipe differing
  values on a bare blur; re-selecting always shows actually-saved values).

**Consequence:** this is almost entirely a **frontend composition + extraction** job. No DB
changes, no new routes, no migration.

**This supersedes the `1f-bulk-fill` plan** (`docs/superpowers/plans/2026-06-26-photo-metadata-1f-bulk-fill.md`),
which proposed a *dialog* plus a new `bulkSetPhotoMetadataValues` + `/metadata/bulk` route. We
do **not** build any of that — the panel + existing `/metadata/selection` cover it. That plan
file should be marked superseded (or deleted) as part of this work.

## Architecture

New feature dir: `apps/web/src/features/photo-info/`.

### 1. `PhotoInfoPanel({ photo })` — the shared single-photo Info tab

The single source of truth for "what the Info tab shows for one photo." Extracted from the body
of `lightbox-sidebar.tsx`'s `LightboxTab.Info` content, composing the existing parts with the
same feature gates:

- `StandardMetadata` (EXIF summary) under `FeatureGate(StandardMetadata)`
- File rows: Source (Badge), File created, File modified, Hash
- `MetadataPanel` (custom fields, per-photo editable) under `FeatureGate(Metadata)`, `key={photo.id}`
- `AlbumMembership` ("Appears in" + add/remove), `key={photo.id}`

The currently-inline pieces in `lightbox-sidebar.tsx` move into `features/photo-info/`:
`album-membership.tsx` (extracted) and a small `info-rows.tsx`/`Row` helper. `StandardMetadata`,
`MetadataPanel`, and `metadata-field-row.tsx` **move** from `features/lightbox/` into
`features/photo-info/` (re-exported if needed). The lightbox imports `PhotoInfoPanel` and its
`Info` tab body becomes just `<PhotoInfoPanel photo={photo} />`. The **EXIF tab stays in the
lightbox** (it is a separate tab, not part of "Info").

Reuse is clean — none of these pieces depend on lightbox-only context: `MetadataPanel` uses
`useCatalog`/`useCatalogMetadataSchema`; `AlbumMembership` uses `usePhotoCollection`,
`useLibraryTree`, `useAddToAlbum` — all available wherever the inspector mounts (inside the
collection provider, app-wide library tree).

### 2. `SelectionMetadataForm` — the shared bulk editor

Generalize `UploadMetadataForm` → `features/photo-info/selection-metadata-form.tsx`, lifting the
upload-specific copy ("Select photos to fill in metadata.", header text) into props with sensible
defaults. Behavior is unchanged (aggregate load, Mixed placeholders, live per-field commit to all
selected via `PUT /metadata/selection`). The upload page becomes a thin consumer:
`upload-metadata-form.tsx` re-exports / wraps `SelectionMetadataForm` so the upload page keeps
working untouched.

### 3. `SidePanel` — reusable docked-panel chrome (new UI primitive)

`components/ui/side-panel.tsx`: a right-docked column — sticky, full content height, `w-80`,
`border-l`, own vertical scroll — with a header slot (title + close `X` button) and a scrollable
body. No knowledge of photos; reusable for any future docked inspector. Mirrors the visual
language of the lightbox `aside` (`w-80 border-l`, scrollable body).

### 4. `SelectionInfoPanel` — the orchestrator

`features/photo-info/selection-info-panel.tsx`. Renders inside `PhotoCollectionProvider` so it
reads selection + photos from context (`usePhotoCollection().getPhotos`) — **never reads
`gridRef` during render** (hard lint rule). Given the current `selectedIds`:

- **0 selected** → muted empty state ("Select photos to see details").
- **1 selected** → resolve the `PhotoDTO` via `getPhotos(new Set([id]))[0]` (the selected tile is
  loaded in the store) and render `<PhotoInfoPanel photo={photo} />`. If the id isn't loaded yet
  (rare), show a brief skeleton.
- **2+ selected** → `<SelectionMetadataForm selectedIds={selectedIds} />`.

Wrapped in the `SidePanel` chrome with a selection-aware title (e.g. "Details" for one, "N photos"
for many).

### 5. Layout + toggle integration

**`PhotoLibraryView`** restructures its return into a flex row:

```
<PhotoCollectionProvider>
  <div className="flex">
    <div className="min-w-0 flex-1">   {/* grid column */}
      {toolbar (HeaderBar | SelectionToolbar)}
      reporters, PhotoActionsProvider, aboveGrid, PhotoGrid, Lightbox, GridShortcuts
    </div>
    {panelOpen && (
      <SidePanel ...><SelectionInfoPanel selectedIds={sel.selected} /></SidePanel>
    )}
  </div>
</PhotoCollectionProvider>
```

- The provider moves up to wrap **both** columns so the inspector can read collection context.
  The toolbar stays atop the grid column; its full-bleed (`-mx-4 px-4`) now bleeds only across the
  grid column, not under the inspector.
- A view-level `panelOpen` (`useState`, default `false`) gates the inspector.
- A new **toggle button** (`PanelRight` / `Info` icon, "active" styling when open) is added to the
  selection toolbar via `SelectionActions` (or alongside it), flipping `panelOpen`.
- The inspector **persists when the selection clears** (shows the empty state) rather than
  flickering open/closed; it closes via its own `X` or the toggle.

**`search-view.tsx`** has a bespoke layout (sticky hero search box, inline two-state toolbar). It
gets the same treatment: wrap its grid area + inspector in a flex row under its existing provider,
add the toggle to its inline selection toolbar, reuse `SidePanel` + `SelectionInfoPanel` verbatim.
The only per-view work is the layout glue; the panel components are shared.

## Data flow

- **Selection** flows from the view's `useGridSelection` (`sel.selected`) into `SelectionInfoPanel`.
- **Single-photo info**: `PhotoInfoPanel` → `MetadataPanel` fetches per-photo values
  (`GET /metadata/photo/:id`) and saves per-field (`PUT /metadata/photo/:id`); `AlbumMembership`
  fetches/edits membership. (All existing.)
- **Bulk**: `SelectionMetadataForm` loads `POST /metadata/selection` for the aggregate and commits
  each field via `PUT /metadata/selection`. (All existing.)
- **Schema** (field structure) comes from the warm `useCatalogMetadataSchema` cache (seeded
  server-side by `MetadataSchemaProvider`) — instant.

## Edge cases

- **Feature gates**: `StandardMetadata` and `Metadata` features gate their sections exactly as the
  lightbox does today. If `Metadata` is off, the bulk view has nothing to show → the inspector
  shows an empty/"no fields" state (matching `SelectionMetadataForm`'s existing empty handling).
- **Mixed values**: handled by the existing aggregate (`{ mixed: true }` → "Mixed" placeholder;
  bare blur never overwrites differing values).
- **Selection changes mid-edit**: the bulk form is keyed by the selection signature, so switching
  selection remounts fields with fresh aggregated values (existing `UploadMetadataForm` behavior).
- **Single-photo not yet loaded**: brief skeleton until `getPhotos` resolves it.
- **Lightbox unchanged**: the `i`/`e` tab shortcuts and EXIF tab keep working; only the Info tab
  body is swapped for `<PhotoInfoPanel>`.

## Out of scope / non-goals

- No DB schema, migration, or new route work.
- No new bulk endpoint or dialog (the `1f` dialog approach is dropped).
- Album membership is **not** added to the bulk (2+) view — bulk add-to-album already exists in the
  toolbar (`AddToAlbumMenu`). Bulk view = custom metadata fields only.
- No field reorder / save-as-preset, no inspector for non-grid surfaces.

## Files

**New**
- `apps/web/src/components/ui/side-panel.tsx` — docked panel chrome.
- `apps/web/src/features/photo-info/photo-info-panel.tsx` — shared single-photo Info tab.
- `apps/web/src/features/photo-info/album-membership.tsx` — extracted from lightbox sidebar.
- `apps/web/src/features/photo-info/info-rows.tsx` — Source/created/modified/Hash rows (+ `Row`).
- `apps/web/src/features/photo-info/selection-metadata-form.tsx` — generalized bulk editor.
- `apps/web/src/features/photo-info/selection-info-panel.tsx` — 0/1/N orchestrator.
- `apps/web/src/features/photo-info/index.ts` — barrel.

**Moved into `features/photo-info/`** (from `features/lightbox/`)
- `standard-metadata.tsx`, `metadata-panel.tsx`, `metadata-field-row.tsx`.

**Modified**
- `apps/web/src/features/lightbox/lightbox-sidebar.tsx` — Info tab → `<PhotoInfoPanel>`; drop the
  inline `AlbumMembership`/`Row`; keep EXIF tab.
- `apps/web/src/components/photo-library/photo-library-view.tsx` — flex-row layout, `panelOpen`,
  provider wraps both columns, mount `SidePanel`/`SelectionInfoPanel`.
- `apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx` — same integration.
- `apps/web/src/components/photo-actions/selection-actions.tsx` (or the selection toolbars) — add
  the inspector toggle button.
- `apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx` — thin wrapper over
  `SelectionMetadataForm`.

**Superseded**
- `docs/superpowers/plans/2026-06-26-photo-metadata-1f-bulk-fill.md` — mark superseded/delete.

## Testing & verification

- **Typecheck**: `pnpm --filter @lumio/web exec tsc --noEmit` clean.
- **Existing tests** (`@lumio/db` metadata) stay green — no backend change.
- **Browser smoke** (per the project's browser-verify habit):
  - Single select → toggle inspector → Info matches the lightbox Info tab; edit a custom field →
    reflected in the lightbox.
  - Select a roll (N) → inspector shows bulk view; set Film Stock → all N updated; a field where
    photos differ shows "Mixed"; blurring it untouched doesn't wipe values.
  - Clear selection → inspector persists with empty state; close via `X`.
  - Feature off → metadata sections absent; nothing crashes.
  - Repeat the toggle + bulk fill in the **search view**.
