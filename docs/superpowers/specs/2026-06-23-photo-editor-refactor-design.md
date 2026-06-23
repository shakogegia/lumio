# Photo-editor refactor (Phase A) — design

**Date:** 2026-06-23
**Status:** Approved for planning
**Scope:** A behavior-preserving refactor that turns today's lightbox editor into one self-contained, swappable feature with a hardened, versioned edit model — so the upcoming pixi.js renderer drops into a clean seam instead of a 442-line god component. Full structural split of `components/photo-grid/` into `photo-grid` / `lightbox` / `photo-editor`; edit-model hardening (`version`, single source of truth, pure params vs CSS renderer); the `ZoomableImage` decomposition; save-path unification; and two correctness fixes on the editor surface.
**Out of scope:** pixi.js itself (this is the prep for it); any change to *what* the editor does (tools, recipe semantics, baked output) — output must be byte-identical; local edits / masks / brushes / a reorderable op stack (deferred until that capability is committed); Phase B (flat `lib/` split, route `parseJson`/`mapServiceError` helpers, search/trash/upload reuse, full cache/trash path-layout dedup) and Phase C (lint-enforceable polish + the catalog-ownership decision). These are catalogued in `.context/code-quality-audit.md`.

## 1. Goal

The codebase audit (`.context/code-quality-audit.md`) found the editor is the one area that will directly bite the pixi.js rebuild: its code is scattered across three trees with no "editor home," its preview geometry is duplicated 3×, `ZoomableImage` is a 442-line god component, and its persisted edit model is flat, version-less, and declared in four files in lockstep. This phase fixes exactly that — and nothing else — so the rebuild becomes "replace one folder behind a stable contract" rather than open-heart surgery across `lib/` and `photo-grid/`.

This refactor **builds on** the existing editor design (`2026-06-21-unified-edit-preview-zoom-design.md`): the editor already renders a single live preview via CSS from an edit-free base, with crop mode keeping its interactive overlay. Phase A does not change that pipeline; it *factors the CSS-render step into a named, swappable renderer* and tidies the surrounding structure.

## 2. Decisions (from brainstorming)

1. **Edit model: versioned + extensible, no local-edit machinery (option d).** Keep today's fixed struct (D4 geometry + 8 global color scalars). Add a schema `version`; make it extensible by deriving from a single source. Do **not** build masks / op-stack / layers until local edits are committed — that would be premature.
2. **Folder move: full restructure (option a).** Split `components/photo-grid/` into three sibling features: `photo-grid` (grid only), `lightbox` (shell + chrome), `photo-editor` (the rebuild target). Accept the wider import diff for the cleaner end state.
3. **Renderer seam: pure-params contract + thin CSS renderer + one swap point (Approach 1).** The renderer-agnostic edit math is the contract; today's CSS emit is one implementation; a single `PreviewStage` component is the one thing pixi replaces. **No formal `PreviewRenderer` interface** is introduced now — the CSS preview (filter-on-`<img>` + overlay divs) and a pixi GL canvas are structurally too different for an interface guessed in advance to be right.
4. **Data compatibility: zero migration.** Keep the flat `Photo.edits` JSON exactly as-is and add `version: 1` (stamped on write). Existing edited rows simply lack `version` → read as v1 by the already-lenient `coercePhotoEdits`. No backfill.
5. **Pure modules live in `packages/shared`** (alongside `crop-geometry.ts`), so the sharp bake *and* any future renderer can call them without importing web/React.
6. **Behavior-preserving.** No UX change, no recipe-semantics change, identical baked output. The safety net is the existing test suite + before/after parity snapshots.

## 3. Current-state grounding (verified)

- **Edit model** `PhotoEdits` (`packages/shared/src/types.ts:16`): `rotate|flipH|flipV|straighten|crop` (D4 geometry) + 8 optional color scalars. No `version` field.
- **4-way shape duplication:** the shape/limits are declared in `types.ts:16` (interface), `packages/shared/src/api.ts:76` (`photoEditsSchema` Zod), `packages/shared/src/photo-edits.ts:147` (`coercePhotoEdits` clamp loop), and `packages/shared/src/photo-color.ts:18` (`COLOR_FIELDS` with min/max/neutral).
- **`photo-color.ts` mixes two concerns:** renderer-agnostic bake params (`toneLinear`/`modulateParams`/`tempFadeLinear`/`vignetteStrength`, the tuning constants, `COLOR_FIELDS`) **and** CSS-emit (`colorCssFilter`/`colorOverlays`). Ingest imports only the params half (verified) — the CSS half is editor-only.
- **`effectiveCrop` derivation duplicated 3×:** `zoomable-image.tsx` (display path + the inner `EditorCanvas`) and `edited-result.tsx`. The geometry is the `working.crop ?? (straighten≠0 ? centeredAspectCrop(...) : {0,0,1,1})` form (see `orientedSize` in `photo-edits.ts:124`).
- **`ZoomableImage`** (`components/photo-grid/zoomable-image.tsx`, 442 lines) owns ~6 orthogonal concerns: display double-buffer, edit-preview math, zoom/pan wiring, hi-res-on-zoom swap, blur-up, the crop-mode `EditorCanvas`, plus inner `NavArrow`/`EditorCanvas`. `base-image-stage.tsx` and `edited-result.tsx` already exist as partial extractions.
- **Save-path duplication:** `apps/web/src/lib/photo-edits-service.ts` (`applyPhotoEdits`) reimplements the decode → `buildRenditions` → write-thumbnail / write-edited-display / rm-edited-on-reset dance already in `packages/ingest/src/regenerate.ts` (`regenerateRenditions`); the only real difference is the `prisma.update`.
- **Rendition path triplication:** `thumbnailPath`/`displayPath`/`editedDisplayPath` are reimplemented in `apps/worker/src/config.ts` and `apps/web/src/lib/paths.ts`; `packages/shared/src/paths.ts` exists but only holds `parentDir`.
- **Lightbox race:** `components/photo-grid/lightbox-sidebar.tsx` `resync` fetches `/photos/:id` with **no** cancellation guard (the sibling mount effect has one) → on arrow-nav a late response can `patchPhotos` photo A's data onto photo B.
- **Unvalidated DB JSON:** `packages/db/src/mappers.ts` `toPhotoDTO` does `(row.exif ?? {}) as ExifData` and `row.rules as SmartAlbumRules` with no parse; `edits` already goes through `coercePhotoEdits`.

## 4. Target structure

`components/photo-grid/` (33 mixed files) splits into three cohesive features, each with an `index.ts` barrel as its public surface:

```
apps/web/src/features/
  photo-grid/     grid only: photo-grid, photo-grid-tile, photo-grid-skeleton, photo-thumb,
                  photo-collection (provider), photo-page-store, collection-total-reporter,
                  cell-variants, selection-ring, favorite-heart, use-photo-pages,
                  photo-context-menu, grid-shortcuts
  lightbox/       shell + chrome: lightbox, lightbox-header, lightbox-actions, lightbox-sidebar,
                  film-strip, use-lightbox-keyboard
  photo-editor/   ← the rebuild target, self-contained behind index.ts
    ui/      preview-stage (NEW: the swap point), zoomable-image (slimmed),
             crop-overlay, crop-editor-canvas (extracted from ZoomableImage's EditorCanvas),
             edited-result, base-image-stage, lightbox-edit-panel, zoom-controls, zoom-slider
    hooks/   use-edit-session, use-edit-keyboard, use-zoom-pan, use-blur-box,
             use-display-buffer (NEW), use-hi-res-swap (NEW), use-measured-size (NEW)
    render/  css-preview.ts (today's CSS renderer — the swappable half)
    server/  photo-edits-service.ts (moved from lib/)
```

`lib/zoom-math.ts` moves into `photo-editor/` (its only importers are the editor). `lib/photo-edits-service.ts` moves to `photo-editor/server/`. The broader flat-`lib/` reorganization is **Phase B**; this phase only moves the editor-owned files.

> Implementation note: `features/` is a new top-level dir under `apps/web/src`. If preferred, the three can instead live as `components/{photo-grid,lightbox,photo-editor}/` — the plan should pick one and apply it uniformly. Default: `features/`.

## 5. Edit model + renderer seam (`packages/shared` + `photo-editor/render`)

### 5a. Version (zero migration)
- Add `version?: number` to `PhotoEdits` (`types.ts`). `NO_EDITS` carries `version: 1`.
- `coercePhotoEdits` reads `version` (absent → 1) and the write paths stamp `version: 1`. No DB change, no backfill; legacy rows read as v1.

### 5b. Single source of truth for the shape
- `COLOR_FIELDS` (`photo-color.ts`) becomes the **only** declaration of color keys + limits.
- **Derive** the color half of `photoEditsSchema` (`api.ts`) from `COLOR_FIELDS` (build the Zod object by looping the table with `.min(f.min).max(f.max)`).
- **Derive** the `coercePhotoEdits` clamp loop from the same table (it already loops `COLOR_FIELDS` for clamping — remove the parallel hand-maintained limits). Kill the `(out as unknown as Record<string, unknown>)` cast by typing the loop over `ColorKey`.
- Geometry fields stay hand-declared (small, structural).

### 5c. Pure params vs CSS renderer (the seam)
- **Keep in `packages/shared` (the contract):** `toneLinear`, `modulateParams`, `tempFadeLinear`, `vignetteStrength`, `hasColor`, `COLOR_FIELDS`, the tuning constants. Plus geometry: `previewTransform` (exists) and two promoted pure exports — `effectiveCrop(working, orientedBase): CropRect` and `outputSize(working, orientedBase): { w; h }` (consolidating the logic currently inlined in `orientedSize` and duplicated in components).
- **Move to `photo-editor/render/css-preview.ts` (one renderer impl):** `colorCssFilter`, `colorOverlays`, the `ColorOverlay`/`OverlayKind` types, and a geometry→CSS emitter that *consumes* the shared pure `previewTransform` and produces the `rotate()/scaleX()` string. This is the only place that knows about CSS; it imports the shared params (`previewTransform` itself stays pure in `shared`).
- **`PreviewStage`** (`photo-editor/ui/preview-stage.tsx`): the single component that turns `(source image, working recipe, orientedBase, zoom/pan state)` into the on-screen preview, using `css-preview` today. **This is the one file pixi replaces.** Documented as such in-code.

## 6. `ZoomableImage` decomposition

`ZoomableImage` becomes a thin composition over extracted, independently-testable units:
- `use-display-buffer.ts` — the rendition double-buffer state machine → `{ src, recipe, w, h }`.
- `use-hi-res-swap.ts` — zoomed → decode hi-res → swap (also dedupes the copy in `edited-result.tsx`).
- `use-measured-size.ts` — one `ResizeObserver` "measure my box" hook (dedupes the 3–4 inline copies; `use-blur-box`/`use-zoom-pan` may adopt it).
- `crop-editor-canvas.tsx` — the crop-mode `EditorCanvas`, extracted to its own file (consumes `useEditSession` + `effectiveCrop`).
- `preview-stage.tsx` — §5c, the display/preview path.
- `zoomable-image.tsx` — wires zoom/pan + `PreviewStage` + `crop-editor-canvas` + `NavArrow`.

`useEditSession` (`photo-editor/hooks/use-edit-session.tsx`):
- Exposes the derived geometry selectors (`effectiveCrop`/`outputSize`) so the three sites and a future pixi renderer read one source.
- **Splits into state vs actions contexts** — `EditSessionStateContext` (`working`/`saved`/derived) and `EditSessionActionsContext` (the stable callbacks) — so a 60fps pixi consumer reading `working` does not re-render the control panel. Included for pixi-readiness; cheap now, costly to retrofit. `useEditSession()` keeps its current call shape by reading both (back-compat), so consumers don't all change at once.

## 7. Save-path unification

- `@lumio/ingest` owns all rendition writes for an applied edit. Make `regenerateRenditions` (or a thin wrapper it calls) the single function that, given source + recipe + paths, writes the thumbnail + edited-display, removes the edited-display on reset, and returns `{ thumbhash, width, height }`.
- Web `applyPhotoEdits` (`photo-editor/server/photo-edits-service.ts`) calls that function and does **only** the `prisma.update` (edits + dims + thumbhash). The duplicated file-side logic is deleted.
- Centralize the rendition path builders `thumbnailPath`/`displayPath`/`editedDisplayPath` into `packages/shared/src/paths.ts` (pure joins; pass the cache root in as an argument so `shared` stays env-free). Worker `config.ts` and web `paths.ts` import them. (Trash/cache path dedup beyond renditions = Phase B.)

## 8. Correctness fixes (both on the editor surface)

- **Lightbox `resync` race** (`lightbox/lightbox-sidebar.tsx`): add a per-photo generation guard (mirror the existing `alive` pattern, keyed on `photo.id`) so a stale `/photos/:id` response is dropped instead of patching the wrong photo. Harden the related stale-`albumIds` closure in `add()` at the same time.
- **Mapper validation** (`packages/db/src/mappers.ts`): parse `exif` and `rules` through their Zod schemas with a `.safeParse` + logged fallback in `toPhotoDTO` (mirroring what `coercePhotoEdits` already does for `edits`). This is the data contract the whole editor consumes.

## 9. Testing & parity

It is a refactor — the bar is *prove no behavior change*.
- All existing tests stay green; `tsc` + `lint` clean for changed code.
- **Parity snapshots captured before the move and asserted after:** `colorCssFilter` / `colorOverlays` output for a representative recipe set, and `effectiveCrop` / `outputSize` over a fixture matrix (rotate × straighten × crop × aspect). Identical in → identical out.
- **New pure shared modules** (`effectiveCrop`, `outputSize`, the derived `photoEditsSchema`, the typed `coercePhotoEdits` loop, `version` defaulting) get unit tests.
- **Save-path:** a test asserting web `applyPhotoEdits` and `regenerateRenditions` produce identical file effects (same thumbnail/edited-display writes, same removal on reset).
- **Correctness fixes:** a test simulating out-of-order `resync` responses asserts the stale one is ignored; a `mappers` test feeds malformed `exif`/`rules` JSON and asserts a safe fallback (no throw, no malformed DTO).
- **Browser visual-parity** check of the editor (open a saved cropped/rotated/straightened + color-adjusted photo; verify preview, zoom hi-res swap, crop mode, apply→baked match) **if** a logged-in session is available — the dev server is auth-gated (per project workflow).

## 10. Sequencing (independently-reviewable units)

The plan should break this into TDD units along these seams; each is a review checkpoint:
1. **Shared model + seam** — `version`; derive `photoEditsSchema` + `coercePhotoEdits` from `COLOR_FIELDS`; promote `effectiveCrop`/`outputSize`; split `photo-color.ts` (params stay, CSS-emit moves out). *Pure logic; parity-tested.*
2. **Save-path unification** — `@lumio/ingest` owns rendition writes; centralize rendition paths; `applyPhotoEdits` does only the DB write. *Pure logic + ingest tests.*
3. **Folder restructure** — create `features/{photo-grid,lightbox,photo-editor}/`, move files, add barrels, update imports. *Mechanical but wide; no logic change.*
4. **`ZoomableImage` split** — extract `use-display-buffer`/`use-hi-res-swap`/`use-measured-size`/`crop-editor-canvas`/`PreviewStage`; slim `zoomable-image`. *Behavior-preserving; parity-tested.*
5. **Edit-session contexts** — derived selectors + state/actions split (back-compat `useEditSession`).
6. **Correctness fixes** — `resync` guard + `mappers` validation.

Units 1–2 are pure logic and land first; 3 is the wide mechanical move; 4–6 build on the new home. A reviewer should be able to verify each unit independently.

## 11. Open implementation notes

- Confirm exact current rendition/route names before wiring §7 — the `2026-06-21-unified-edit-preview-zoom-design.md` spec predates some renames (it references `/edit-base`/`buildEditBase`; the current routes are `/edit`, `/edited`, `/display`, `/original`, `/thumbnail`, and the audit confirmed `regenerateRenditions`/`buildRenditions` in `regenerate.ts`/`renditions.ts`).
- Verify `colorCssFilter`/`colorOverlays` have **no** importers outside the editor before moving them out of `shared` (audit indicates editor-only; the plan must grep to confirm).
- Pick `features/` vs `components/` for the three feature dirs and apply uniformly (§4).
- Follow the project's React-Compiler lint rules during the component split (`"use client"` line 1; no setState-via-intermediate-fn; refs-in-effect).
