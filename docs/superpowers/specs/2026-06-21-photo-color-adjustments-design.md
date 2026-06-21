# Photo editor — color adjustments (design)

Date: 2026-06-21
Status: Approved approach, pending spec review

## Goal

Add eight non-destructive color adjustments to the lightbox photo editor:

**Exposure · Brightness · Contrast · Saturation · Temperature · Hue · Fade · Vignette**

(Vibrance is explicitly out of scope — it has no CSS-filter equivalent and would
force a `<canvas>`/WebGL preview pass; see "Future direction".)

Each adjustment is a slider that previews live in the editor and bakes into the
stored renditions on Apply, exactly like the existing crop/rotate/flip/straighten
edits.

## Chosen approach (and the alternatives we rejected)

**Approach A — CSS-filter preview + sharp bake + a shared formula module.** Picked.

- **Preview**: live in the browser via the CSS `filter` property (per-pixel ops)
  plus blend-mode/gradient overlay `<div>`s (temperature/fade/vignette). No new
  rendering tech — the editor is already pure DOM/CSS + `<img>`.
- **Bake**: server-side with sharp (libvips) in `packages/ingest`, the same place
  geometry is baked today. The baked rendition is the canonical output (grid,
  downloads, zip, non-editing lightbox).
- **One source of truth**: a shared module emits both the CSS preview parameters
  and the sharp bake parameters from the same recipe values, so preview and bake
  stay matched by construction.

Rejected:

- **B — WebGL preview + sharp bake**: worst of both worlds. The canonical output
  is still baked by sharp, so the color math would have to be maintained twice (a
  GLSL shader *and* libvips) and kept pixel-matched. All cost, little gain.
- **C — full client-side WebGL pipeline** (shader previews *and* exports, sharp
  retired): justified only when the toolset outgrows CSS (Vibrance, tone curves,
  HSL/selective color, masks). Documented as the upgrade path, not built now.

Why A is future-safe (verified against the current code):

- The stored recipe is **semantic values, not CSS strings**, so it is
  renderer-agnostic. Every photo edited today renders correctly under a future
  engine, untouched.
- Geometry stays decoupled: color is per-pixel, geometry is spatial. A future
  WebGL color stage slots in *beneath* the existing geometry layer
  (`EditedResult`/`BaseImageStage` CSS transforms, `CropOverlay`) without
  reimplementing crop/rotate/flip/straighten. The geometry math
  (`crop-geometry.ts`, `photo-edits.ts`) is already pure and renderer-agnostic.
- The one coupling — **vignette is position-dependent** — is handled by a fixed
  ordering rule (below), so it behaves identically in CSS, sharp, or a future
  shader.

## Persistence

Bake into renditions, like crop/rotate. On Apply, `applyPhotoEdits` re-runs
`buildRenditions` and rewrites the thumbnail + edited display rendition; the
recipe is persisted to the existing `Photo.n` JSONB column. **No DB migration**
— color fields are extra optional keys in the same JSON blob.

Color-only edits (no geometry) must still trigger a bake and still select the
`/edited` rendition. This is handled by extending `hasEdits` (see below).

## The recipe schema

Extend `PhotoEdits` (`packages/shared/src/types.ts`) with eight optional numeric
fields. All optional and all neutral-at-absent, so existing stored recipes remain
valid and `NO_EDITS` is unchanged in meaning.

```ts
export interface PhotoEdits {
  // ... existing geometry fields: rotate, flipH, flipV, straighten, crop ...

  /** Tonal gain in perceptual stops-ish units. -100..100, 0 = neutral. */
  exposure?: number;
  /** Linear lightness multiply. -100..100, 0 = neutral. */
  brightness?: number;
  /** Contrast around mid-grey. -100..100, 0 = neutral. */
  contrast?: number;
  /** Saturation multiply. -100..100, 0 = neutral. */
  saturation?: number;
  /** Warm (+) / cool (−) white-balance tint. -100..100, 0 = neutral. */
  temperature?: number;
  /** Hue rotation in degrees. -180..180, 0 = neutral. */
  hue?: number;
  /** Matte/wash: lifts blacks + softens contrast. 0..100, 0 = neutral. */
  fade?: number;
  /** Corner darkening. 0..100, 0 = neutral. */
  vignette?: number;
}
```

Values are stored as the **slider values themselves** (renderer-independent
semantic units), never as CSS strings. The mapping to engine parameters lives in
one place (the formula module).

### Per-adjustment math (the single source of truth)

| Slider | Range | Neutral | Engine mapping | Match |
| --- | --- | --- | --- | --- |
| Exposure | −100..100 | 0 | multiplier `mE = 2^(v/50)` (±2 stops); CSS `brightness(mE)`, sharp `.linear(mE, 0)` | exact |
| Brightness | −100..100 | 0 | multiplier `mB = 1 + v/100`; CSS `brightness(mB)`, sharp `.linear(mB, 0)` | exact |
| Contrast | −100..100 | 0 | `c = 1 + v/100`; CSS `contrast(c)`, sharp `.linear(c, 128·(1−c))` (pivot 128/255) | exact |
| Saturation | −100..100 | 0 | `s = 1 + v/100`; CSS `saturate(s)`, sharp `.modulate({ saturation: s })` | very close |
| Hue | −180..180 | 0 | CSS `hue-rotate(v deg)`, sharp `.modulate({ hue: v })` | very close |
| Temperature | −100..100 | 0 | overlay (warm/cool) `mix-blend-mode: soft-light`, opacity ∝ \|v\|; sharp per-channel `.linear([rGain,1,bGain], 0)` | tuned-close |
| Fade | 0..100 | 0 | white overlay (normal blend) low opacity + slight `contrast(<1)`; sharp black-lift `.linear` + white composite | tuned-close |
| Vignette | 0..100 | 0 | radial-gradient overlay `<div>`; sharp composite of a radial alpha mask | tuned-close |

Notes:
- **Exposure + Brightness are both multiplicative gains in v1** (exposure is
  exponential/stop-based, brightness is linear %), chosen because both are exactly
  expressible with CSS primitives so preview == bake. They stack as a single
  combined gain `mE · mB`. In a future sharp-gamma or WebGL upgrade, Brightness can
  be redefined as a true midtone gamma curve *without changing the recipe schema*
  (the field stays `brightness`; only the formula changes) — this is exactly the
  portability the formula module buys us. **Decided (2026-06-21): keep both as
  gains in v1 (option a) — exact preview/bake parity wins over the minor feel
  overlap.**
- "exact" = CSS shorthand and sharp produce the same result in the sRGB/gamma
  space both operate in. "very close" = CSS uses an SVG color matrix while sharp
  uses an HSB rotation; visually near-identical. "tuned-close" = preview uses an
  overlay/composite tuned to visually match the sharp bake; not pixel-identical
  while dragging, but Apply shows the true baked result instantly.

### The formula module — `packages/shared/src/photo-color.ts` (new)

Pure, isomorphic (no sharp import — sharp is Node-only). Exposes:

- `COLOR_FIELDS` — ordered slider config: `{ key, label, min, max, neutral, step }`,
  driving both the UI and validation.
- `hasColor(e: PhotoEdits | null): boolean` — any color field non-neutral.
- `colorCssFilter(e): string` — the per-pixel filter chain for preview, e.g.
  `"brightness(1.10) contrast(0.95) saturate(1.20) hue-rotate(10deg)"`. Returns
  `""` when neutral.
- `colorOverlays(e): Overlay[]` — overlay specs for temperature/fade/vignette:
  `{ kind, background, blendMode, opacity }` (vignette carries the radial gradient).
  Empty when all three are neutral.
- `colorSharpPlan(e): SharpColorPlan` — structured params the ingest layer applies
  with sharp: `{ gain, contrast, saturation, hue, tempChannelGains, fade, vignette }`.

The CSS path and the sharp path both derive from the same internal normalized
values, so they cannot drift apart silently.

### Validation / coercion

- **`coercePhotoEdits`** (`photo-edits.ts`, read path / DB mapper): clamp each
  color field to its range; non-finite or absent → neutral (omitted). Existing
  recipes (no color keys) coerce to neutral color, unchanged.
- **`photoEditsSchema`** (Zod, `api.ts`, server write path): add the eight fields
  as `z.number().min(...).max(...).optional()`. **Required** — `z.object()` strips
  unknown keys, so without this the color fields would be silently dropped before
  reaching `applyPhotoEdits`/`buildRenditions`.
- **`NO_EDITS`**: unchanged shape (color fields absent = neutral).
- **`hasEdits`**: becomes `hasGeometry(e) || hasColor(e)`.
- **`hasGeometry`** (new): the current `hasEdits` body (rotate/flip/straighten/crop).
- **`sameEdits`**: also compare the eight color fields (treating absent === 0).
- **`orientedSize`**: unchanged — color never changes output dimensions.

## Bake — `packages/ingest/src/renditions.ts`

Extract a shared `applyColor(img, edits, frameW, frameH): Promise<Sharp>` used by
both `buildRenditions` and `encodeEditedJpeg`. It applies `colorSharpPlan(edits)`
to a pipeline that has **already been framed** (flip/rotate/straighten/crop done),
in this fixed order:

1. flip / coarse rotate — `applyEdits` (existing)
2. straighten + crop — `applyStraightenCrop` (existing) → now in the final frame
3. **gain** — `.linear(mE·mB, 0)`
4. **contrast** — `.linear(c, 128·(1−c))`
5. **saturation + hue** — `.modulate({ saturation: s, hue })`
6. **temperature** — per-channel `.linear([rGain,1,bGain], 0)`
7. **fade** — black-lift `.linear` + low-opacity white `.composite`
8. **vignette** — `.composite` a generated radial alpha mask sized to the frame — **last**
9. resize → display (`DISPLAY_MAX`), then thumbnail from display (color inherited)

Vignette mask: an SVG `radialGradient` (transparent centre → black edge, alpha ∝
value) rasterized and composited with blend `over`, sized to the current frame
(`frameW×frameH`). Because it is baked into the full-frame image *before* resize,
it scales proportionally into both display and thumbnail.

Gating changes:
- `buildRenditions`: `const geom = hasGeometry(edits)` (was `hasEdits`). Color is
  applied via `applyColor` whenever `hasColor(edits)`, on the framed `baked`
  pipeline, before the display resize. Color-only edits (geom=false) take the
  simple `sharp(source).rotate()` auto-orient path, then `applyColor`. Dimensions
  come from the existing metadata branch (color doesn't change them).
- `encodeEditedJpeg`: the fast no-op path stays `if (!hasEdits(edits))`; when there
  are edits it applies geometry (if `hasGeometry`) then `applyColor`.

## Preview — `apps/web/src/components/photo-grid`

The editor already renders the **edit-free base** with the **full** working recipe
when the Edit tab is open (`ZoomableImage` → `EditedResult` → `BaseImageStage`).
So color previews as the *full* working color (no delta-composition problem) on
that one image. Apply color preview in `EditedResult`'s clipped frame box:

```
<div class="relative overflow-hidden" style={width:bw, height:bh}>
  <div class="absolute" style={...stage geometry..., filter: colorCssFilter(working)}>
    <BaseImageStage .../>            // per-pixel filter wraps only the image
  </div>
  {colorOverlays(working).map(o => <div class="absolute inset-0" style={overlayStyle(o)} />)}
</div>
```

- The CSS `filter` goes on the positioned stage div (filters the image only), so
  the overlays are **not** themselves brightness/contrast-filtered.
- Overlays (temperature/fade/vignette) are siblings covering the clipped frame
  (`inset-0`), so vignette/temperature align to the **visible cropped frame** — the
  same "final frame" rule the bake uses. `pointer-events: none`.
- Color preview lives only in the edit panel path (`editing && !cropMode`). Crop
  mode (`EditorCanvas`) shows the un-colored base — acceptable, since color isn't
  edited there.

`BaseImageStage` itself is unchanged except that its caller now sets `filter` on
the wrapping stage div; the geometry transforms it emits are untouched.

## Edit session — `use-edit-session.tsx`

Add `setColor(key: ColorKey, value: number)` that pushes a new history entry via
the existing `pushHistory`/recipe helpers, so color participates in undo/redo,
dirty-tracking, Apply, Reset, and navigation-guarding with zero special-casing.
`reset` already returns to `NO_EDITS` (now neutral color too).

v1 matches the existing Straighten slider's history behavior (push per change).
Coalescing a drag into one undo entry is a noted follow-up, not in scope.

## UI — `lightbox-edit-panel.tsx`

Add an **"Adjust"** section in the main (non-crop) edit panel, below Transform and
above Crop & Straighten. One `Slider` per field, in photographic order:

Exposure · Brightness · Contrast · Saturation · Temperature · Hue · Fade · Vignette

Each row mirrors the existing Straighten control: label, a click-to-reset value
readout (resets that field to neutral), and a `Slider` bound to
`working[key]`/`setColor`. Driven by `COLOR_FIELDS` from the formula module so the
list stays declarative. The panel scrolls if it grows tall.

## Files touched

- `packages/shared/src/types.ts` — extend `PhotoEdits`.
- `packages/shared/src/photo-color.ts` — **new** formula module.
- `packages/shared/src/photo-edits.ts` — `hasGeometry`, `hasColor`, extend
  `hasEdits`/`sameEdits`/`coercePhotoEdits`.
- `packages/shared/src/api.ts` — extend `photoEditsSchema` (Zod).
- `packages/shared/src/index.ts` — export the new module.
- `packages/ingest/src/renditions.ts` — `applyColor`, wire into
  `buildRenditions` + `encodeEditedJpeg`; `geom = hasGeometry`.
- `apps/web/src/components/photo-grid/edited-result.tsx` — filter + overlays.
- `apps/web/src/components/photo-grid/use-edit-session.tsx` — `setColor`.
- `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx` — Adjust section.
- `packages/db/src/mappers.ts` — no change (uses `coercePhotoEdits`); add tests.

No migration. No change to `Photo.n` column, `applyPhotoEdits` write/reset logic,
`rendition-url.ts`, or the edit/edited routes (they already pass the recipe
through the schema + service).

## Testing

- **shared**: `coercePhotoEdits` clamps/rejects color ranges; `hasGeometry` vs
  `hasColor` vs `hasEdits`; `sameEdits` with color; `colorCssFilter` strings
  (neutral → `""`, known values → expected chain); `colorOverlays` specs; round
  ranges/neutrals in `COLOR_FIELDS`.
- **ingest**: `applyColor` changes pixels (e.g. a uniform-grey buffer brightened
  raises mean luminance; contrast 0 → flat; vignette darkens corners not centre);
  color-only path doesn't crash and preserves dimensions; geometry + color compose;
  `encodeEditedJpeg` applies color.
- **db**: `toPhotoDTO` round-trips color fields; malformed color coerces to neutral.
- **web**: manual browser verification per the project workflow (live preview
  matches the baked result after Apply; reset/undo/redo; color-only Apply updates
  the grid tile and download).

## Out of scope / future direction

- **Vibrance** and any CSS-inexpressible tool (tone curves, HSL/selective color,
  split-toning, masks/local adjustments). The trigger to revisit is the first
  request for one of these.
- **WebGL** (approach C): when the toolset crosses that line, introduce a unified
  GL renderer (preview *and* export) and retire the sharp bake. The recipe schema,
  the geometry layer, and the formula module are all designed so that port is a
  mechanical addition (recipe→GLSL mapping next to recipe→CSS and recipe→sharp),
  not a rewrite. Keep vignette "last, on the final frame" so it ports cleanly.
- **Drag-coalesced undo** for color sliders (one history entry per interaction).
- **Presets / filter gallery.**
</content>
</invoke>
