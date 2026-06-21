# Photo crop & straighten — design

**Date:** 2026-06-21
**Status:** Approved for planning
**Scope:** Interactive crop (freeform + aspect-ratio presets) and straighten (free-angle tilt),
added to the existing non-destructive edit recipe. Shares one Apply / Reset / Undo / Redo with
the current rotate/flip controls.
**Out of scope (later):** dial/ruler straighten UI; adjustments (brightness/contrast/saturation/
temperature); per-edit reset.

## 1. Goal

Extend Lumio's non-destructive editor (see `2026-06-20-photo-editing-design.md`) with **crop**
and **straighten**. Both become fields on the existing `PhotoEdits` recipe, are baked into the
display/thumbnail renditions + edited download by the same `sharp` pipeline as rotate/flip, and
are edited inline in the existing lightbox **Edit** tab. The editor previews live in the browser
and persists only on **Apply**, exactly like rotate/flip today.

Aspect-ratio presets: **Free · Original · Square · 5:4 · 4:5 · 4:3 · 3:4 · 3:2 · 2:3 · 16:9 · 9:16**.

## 2. Decisions (from brainstorming)

1. **Inline, not a separate mode** — crop box + aspect chips + straighten slider live in the
   right-hand Edit sidebar, beside the existing Transform (rotate/flip) controls. One working
   recipe, one undo/redo history, one Apply/Reset for all geometry edits.
2. **Crop + straighten in scope; adjustments later.** Straighten is the *fine* tilt; the existing
   90° rotate buttons remain the *coarse* rotate.
3. **Straighten UI = a sidebar slider** (degree readout, double-click resets to 0°). A draggable
   on-image dial/ruler is a later polish, not now.
4. **Straighten auto-fills** — the image rotates behind a fixed crop frame and is clamped so the
   rotated corners are never empty (no background fill ever shows in the output).
5. **Crop is baked everywhere** (grid tiles, lightbox, downloads), like rotate/flip — consistent
   and reversible by re-entering the editor (the original file is always preserved).
6. **Editing previews from an edit-free base image**, not the baked rendition, so the user can
   freely expand/shrink an already-saved crop.

## 3. Data model & types

### 3.1 Shared type (`packages/shared/src/types.ts`)
Extend `PhotoEdits` with two **optional** fields (keeps every existing DB row valid — no
migration; `edits` is already a free-form `Json?` column):

```ts
export interface CropRect {
  x: number; y: number; w: number; h: number; // all normalized 0..1, in the O′ frame (see §4)
}

export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270; // existing coarse rotate (clockwise, after EXIF auto-orient)
  flipH: boolean;
  flipV: boolean;
  straighten?: number;        // NEW — fine tilt in degrees, clamped to [-45, 45]; default/absent = 0
  crop?: CropRect | null;     // NEW — null/absent = full frame
}
```

### 3.2 Schema (`packages/shared/src/api.ts`)
Extend `photoEditsSchema`; both new keys optional so existing clients/recipes still validate:

```ts
export const cropRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const photoEditsSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  straighten: z.number().min(-45).max(45).optional(),
  crop: cropRectSchema.nullable().optional(),
});
```
(`editPhotoSchema` is unchanged — it wraps `photoEditsSchema`.)

### 3.3 Defensive coercion (`packages/shared/src/photo-edits.ts`)
Extend `coercePhotoEdits` to read `straighten` (finite number in range, else 0) and `crop` (valid
`CropRect` with each field in [0,1] and `w,h > 0`, else null). Unknown/invalid → the safe default,
never throw. `NO_EDITS` gains `straighten: 0, crop: null`.

## 4. Geometry / transform stack (the core)

One canonical pipeline, implemented identically client-side (CSS preview) and server-side
(`sharp` bake):

```
original
  → EXIF auto-orient
  → flipH (flop)  → flipV (flip)  → coarse rotate r        = oriented image O  (Wo × Ho)
  → straighten by θ  (rotate content θ°, canvas auto-expands) = O′ (W′ × H′)
  → extract crop rect                                         = final
```

**Invariants:**

- **Crop is axis-aligned in the straightened frame.** After O is rotated by θ to produce O′, the
  user's crop rectangle is axis-aligned *in O′*, so `sharp.extract` applies directly. `crop` is
  stored normalized to O′ (`x,y,w,h` ∈ [0,1] of W′,H′). When θ = 0, O′ = O, so `crop` is simply
  "fraction of the oriented image" — intuitive and what the no-straighten case stores.
- **Expanded canvas dims** for a known O and θ:
  `W′ = |Wo·cosθ| + |Ho·sinθ|`, `H′ = |Wo·sinθ| + |Ho·cosθ|`. The visible (non-empty) content is
  the inscribed rotated rectangle of O centered in O′.
- **Auto-fill clamp:** the crop rect must lie entirely within that inscribed region, so the output
  never contains empty corners. The editor clamps interactively; the baker may assume a valid rect
  (and defensively intersect).
- **Coarse rotate/flip transform the stored crop** (and leave straighten magnitude unchanged, sign
  flips under a mirror) so the frame keeps tracking the same content. Pure helpers in
  `photo-edits.ts` (see §6).
- **Output dimensions:** `width = round(crop.w · W′)`, `height = round(crop.h · H′)` (continues the
  existing pattern where edits change a photo's reported `width`/`height`). With no crop, the
  output is the inscribed rect for θ ≠ 0, or O for θ = 0.

**CSS preview equivalent** (editor canvas, §7): on the edit-free base image apply
`transform: scaleX(±1) scaleY(±1) rotate((r+θ)deg) scale(fill)`, with the crop frame drawn as an
axis-aligned overlay; `fill` is the scale-up that keeps the crop frame's content gap-free
(same `cos/sin` relationship as the inscribed-rect clamp).

## 5. Baking (`@lumio/ingest/renditions.ts`) — one chokepoint

`applyEdits`, `buildRenditions`, and `encodeEditedJpeg` are the **only** places a recipe is
rendered, and all three feed every consumer (edit apply, edited download + bulk zip, and the
worker's edits-safe re-ingest). Extend the shared apply step to add straighten + crop:

1. After the existing flop/flip/coarse-rotate, if `straighten` ≠ 0:
   `img.rotate(θ, { background: { r: 0, g: 0, b: 0, alpha: 0 } })` (arbitrary angle; sharp expands
   the canvas and centers the content).
2. If `crop`: compute the pixel rect from `crop` × (W′, H′) and `img.extract({ left, top, width,
   height })`. Intersect with the inscribed region defensively so a slightly-out-of-range rect can
   never request pixels outside the canvas.

Because `extract` needs concrete pixel dims, the apply step must know O's oriented dimensions.
`buildRenditions` already reads `sharp(...).metadata()`; thread the oriented (Wo, Ho) so W′, H′ and
the extract rect are computed without an extra decode round-trip. `encodeEditedJpeg` (full-res, no
resize) follows the same order: orient → flip → coarse-rotate → straighten → extract → JPEG.

**No worker changes** beyond this — re-ingest already replays `photo.edits` through
`buildRenditions`, so crop/straighten ride along automatically (`2026-06-21-reingest-no-clobber-design.md`).

Reported `width`/`height` after a bake follow §4 (post-crop pixel size).

## 6. Recipe helpers (pure, unit-tested) — `packages/shared/src/photo-edits.ts`

Add alongside the existing rotate/flip helpers (same immutable, `as const`-free style):

- `setStraighten(e, deg)` — clamp to [-45, 45].
- `setCrop(e, rect | null)` — set/clear crop.
- `aspectCrop(e, ratio, baseW, baseH)` — given a target ratio (or `"free"` / `"original"`), return
  the recipe with a **centered, max-fit** crop at that ratio within the current straightened frame
  (`"free"` clears the ratio lock but keeps the current rect; `"original"` uses Wo:Ho). Used by the
  aspect chips.
- Crop transforms under geometry: rotating/flipping the recipe must map an existing `crop` (and
  flip the sign of `straighten` under a mirror) so `rotateLeft`/`rotateRight`/`toggleFlipH`/
  `toggleFlipV` keep the crop framing the same content. Extend those existing helpers.
- `hasEdits` / `sameEdits` — extend to consider `straighten` (≠ 0) and `crop` (non-null).
- `orientedSize` — extend so the predicted post-edit `[w,h]` accounts for crop + straighten (used
  for optimistic store patching of grid-tile layout).

The D4 `previewTransform` delta machinery is **only** used to preview rotate/flip over the *baked*
rendition while editing; with the edit-base canvas (§7) the editor applies the *full* working
recipe to an identity baseline, so the delta path is no longer exercised inside the editor. Leave
it in place for now (used by nothing else) unless its removal falls out naturally; do not expand it.

## 7. Editor canvas — the edit-free base (`apps/web`)

The current editor previews rotate/flip as a CSS delta over the baked (already-edited) display
rendition. That breaks for crop: once a crop is baked, you cannot expand back out of it. So while
the **Edit** tab is open, the lightbox center renders an **edit-free base** and applies the full
working recipe live.

### 7.1 New endpoint — `GET /api/photos/[id]/edit-base`
`withAuth`, Node runtime, `force-dynamic`. Returns a display-resolution, EXIF-oriented, **edit-free**
WebP: `decodeToSharpInput(originalPath)` → `sharp(...).rotate()` (EXIF only) → resize `DISPLAY_MAX`
→ WebP q80. This reuses the JXL/HEIC decode path (so it works where raw `/original` can't render in
a browser) and is effectively `buildRenditions(input, null).display`. Cacheable
(`Cache-Control: public, max-age=...`); the base never changes for a given original, so no version
token is needed.

### 7.2 Editor rendering
- When the Edit tab is active, swap the center image source to `/api/photos/[id]/edit-base` and
  apply the §4 CSS transform from the **full** `working` recipe (flip → coarse rotate → straighten,
  with `scale(fill)`), with an interactive crop overlay on top. To avoid a flash on open, keep
  showing the baked rendition until the base has decoded, then swap (same decode-before-swap trick
  already used in `zoomable-image.tsx`).
- While crop is being edited, the zoom/pan engine is disabled; pointer drags manipulate the crop
  box instead (move the rect, drag a corner/edge handle). Outside the Edit tab, viewing/zoom/pan
  is unchanged.

### 7.3 Crop overlay component — `apps/web/src/components/photo-grid/crop-overlay.tsx` (new)
Renders the dim surround, the crop rectangle, rule-of-thirds gridlines, 4 corner + 4 edge handles,
and handles pointer interactions. Reports rect changes back to the edit session in normalized O′
coordinates. Enforces: min crop size, aspect-ratio lock (when a ratio is selected), and the
inscribed-region clamp (§4). Emits **one** history entry per gesture (on pointer-up), not per move.

## 8. Edit session integration (`use-edit-session.tsx`)

The existing session already provides `working`/`saved`/`dirty`/`undo`/`redo`/`apply`/`guard` over
a history of recipes. Crop & straighten plug in as more recipe mutations:

- Add `setStraighten(deg)`, `setCrop(rect | null)`, `setAspect(ratio)` to the context, each pushing
  to the same history (continuous gestures commit a single entry on release — see §7.3; the
  straighten slider commits on pointer-up / change-end).
- `apply()` is unchanged in shape — it POSTs the working recipe to `/api/photos/[id]/edit`, patches
  the store with `{ edits, width, height, thumbhash, updatedAt }`, and re-seeds history. The
  service/route already persist arbitrary recipe fields (they pass `edits` straight through), so no
  API/service changes are required beyond the schema in §3.2.
- The unsaved-changes nav guard already keys off `dirty`, which now also reflects crop/straighten.

## 9. Edit-tab UI (`lightbox-edit-panel.tsx`)

Keep the existing Apply/Reset header and Transform (rotate/flip) + Undo/Redo blocks. Add, between
Transform and Undo/Redo:

- **Straighten** — a slider (−45…+45, step 1°) with a live degree readout; double-click/secondary
  action resets to 0°. Built from existing `ui/*` primitives (do not modify `ui/*`; copy styles per
  project convention). Drives `setStraighten`.
- **Crop** — a wrapped row of aspect-ratio chips: `Free · Original · Square · 5:4 · 4:5 · 4:3 · 3:4
  · 3:2 · 2:3 · 16:9 · 9:16`. The active chip is highlighted. Selecting a ratio calls `setAspect`
  (centered max-fit crop at that ratio, marking the session dirty); **Free** unlocks the ratio.
  Use a TS `enum` for the preset set (per project enum preference), with each preset carrying its
  ratio (or a `free`/`original` marker).

`Reset` continues to clear **all** edits back to the original (rotate/flip/straighten/crop).
Keyboard: leave the existing rotate/apply shortcuts; no new required shortcuts (optional later).

## 10. File-by-file change list

**Shared**
- `packages/shared/src/types.ts` — `CropRect`; `PhotoEdits.straighten`, `.crop`.
- `packages/shared/src/api.ts` — `cropRectSchema`; extend `photoEditsSchema`.
- `packages/shared/src/photo-edits.ts` (+ `.test.ts`) — `NO_EDITS`/`hasEdits`/`sameEdits`/
  `coercePhotoEdits`/`orientedSize` extended; new `setStraighten`/`setCrop`/`aspectCrop`; crop
  transforms under rotate/flip; aspect-preset enum.

**Ingest**
- `packages/ingest/src/renditions.ts` (+ `.test.ts`) — straighten (`rotate θ`) + crop (`extract`)
  in `applyEdits`/`buildRenditions`/`encodeEditedJpeg`; thread oriented dims; compute W′,H′ and the
  clamped extract rect.

**API / web**
- `apps/web/src/app/api/photos/[id]/edit-base/route.ts` (new) — edit-free oriented WebP.
- (`.../[id]/edit/route.ts`, `photo-edits-service.ts` — unchanged; recipe passes through.)

**Client / UI**
- `apps/web/src/components/photo-grid/use-edit-session.tsx` — `setStraighten`/`setCrop`/`setAspect`.
- `apps/web/src/components/photo-grid/crop-overlay.tsx` (new) — interactive crop UI.
- `apps/web/src/components/photo-grid/zoomable-image.tsx` — edit-base canvas swap when Edit tab
  active; full-recipe CSS transform; mount the crop overlay; suppress zoom/pan while cropping.
- `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx` — Straighten slider + Crop chips.
- (Possibly a small `lib/crop-math.ts` for shared overlay/geometry helpers if `photo-edits.ts`
  grows too large — keep files focused.)

## 11. Testing

**Unit** (match existing `photo-edits.test.ts` / `renditions.test.ts` style):
- `photo-edits.ts`: `setStraighten` clamps to ±45; `aspectCrop` produces a centered max-fit rect of
  the requested ratio within bounds; `crop`/`straighten` survive and correctly transform under
  rotate/flip; `hasEdits`/`sameEdits` account for the new fields; `coercePhotoEdits` rejects
  out-of-range straighten and malformed crop.
- `renditions.ts`: a straighten of θ on a known fixture yields the expected W′,H′; a crop rect
  extracts the expected pixel region and reported dimensions; combined rotate+straighten+crop on a
  small fixture composes in the documented order; the no-edits path is byte-for-byte unchanged.
- `api.ts`: `photoEditsSchema` accepts recipes with/without the new fields and rejects out-of-range
  straighten and out-of-[0,1] crop values.

**Browser-verify** (per dev workflow): pick each aspect ratio → centered crop appears; drag
handles/move with ratio locked and freeform; straighten slider tilts with corners staying filled;
Apply bakes (grid tile + lightbox + film strip all reflect the crop via cache-bust); re-enter Edit
and expand the crop back out (edit-base works); Reset clears; undo/redo across crop + straighten +
rotate; edited download and bulk edited zip contain the cropped/straightened JPEG; HEIC/JXL photo's
edit-base renders.

## 12. Implementation phasing (for the plan)

1. **Recipe + bake (backend, headless-verifiable):** types, schema, coercion, `photo-edits.ts`
   helpers + tests, `renditions.ts` straighten+crop + tests, edit-base endpoint.
2. **Crop UI:** edit-base canvas swap + `crop-overlay.tsx` (Free + handles/move + dim + thirds) +
   aspect chips wired through the edit session + Apply.
3. **Straighten UI:** slider + scale-to-fill geometry + inscribed clamp, composed with crop.

## 13. Assumptions / non-goals

- Straighten range ±45° (combined with the coarse 90° rotate buttons, covers all needs).
- Edit-base served at `DISPLAY_MAX` WebP q80, cached; no on-disk persistence beyond HTTP cache
  (regenerate on demand — cheap, deliberate action).
- `crop` normalized to the O′ (post-straighten) frame; when θ = 0 this is just the oriented image.
- No background fill ever appears in output — the crop is always clamped to real pixels.
- Not doing now: on-image straighten dial; adjustment sliders; per-edit (vs all) reset; edit
  history/versioning.
