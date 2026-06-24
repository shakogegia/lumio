# Proper Color Adjustments — Linear-Light Pipeline, Kelvin WB + Tint

Date: 2026-06-24
Status: Approved (user pre-approved full implementation)

## Goal

Make the photo editor's adjustments *correct*, not approximate. Replace the
arbitrary `-100..100`-everywhere model with one that uses meaningful units and
physically-grounded math, runs the optically-linear operations in **linear
light**, adds a proper **Temperature (Kelvin) + Tint** white balance via a
chromatic-adaptation matrix, and drops the unreliable CSS preview path so the
WebGL preview is the single source of truth — and is guaranteed to match the
Node/Sharp bake to disk.

This supersedes the temperature handling in
`2026-06-24-gpu-photo-editor-design.md`.

## Decisions (locked)

1. **Linear-light pre-pass** for the operations that are physically multiplies
   on light: **Exposure** and **White Balance**. Everything else (contrast,
   highlights/shadows/whites/blacks, curves, saturation/vibrance/hue, fade,
   vignette) stays in gamma/display space — that is the correct, conventional
   place for tone-shaping and chroma, and it means **no re-tuning** of the
   existing region sliders.
2. **Exposure** → EV stops. Range `-5..+5`, neutral `0`, step `0.05`. Applied as
   `linear *= 2^EV`.
3. **Brightness** → kept but **redefined** as a midtone-gamma control (anchors
   pure black and pure white, lifts/darkens midtones). Range `-100..100`,
   neutral `0`. Distinct from Exposure. Applied in gamma space inside the tone LUT.
4. **Temperature** → Kelvin. Range `2000..11000`, neutral `6500` (centered on
   the slider), step `10`. Higher K = warmer image (Lightroom convention).
5. **Tint** → green↔magenta. Range `-150..+150`, neutral `0`, step `1`.
   Negative = green, positive = magenta (Lightroom convention).
6. Temperature + Tint produce a **Bradford chromatic-adaptation matrix** applied
   in linear light. Exposure's scalar is folded into the same 3×3 matrix, so the
   linear pre-pass is a single `mat3` multiply.
7. **Vignette** → bidirectional. Range `-100..+100`, neutral `0`. Negative
   darkens corners (old behaviour), positive lightens. Applied at the end in
   gamma (stylistic post-effect).
8. **Hue** unchanged (already correct, luma-preserving rotation). Kept.
9. **Fade** unchanged.
10. **Drop the CSS `<img>` fallback** entirely. WebGL2 is required for live
    adjustment preview; without it the editor shows the un-adjusted source.
    Delete now-dead code: `colorCssFilter`, `colorOverlays`, `tempFadeLinear`,
    `toneLinear`, `modulateParams`, and their helpers/constants.
11. **Schema v3 + migration** so existing saved edits don't break or render
    garbage (units of exposure/temperature/vignette changed).

## The pipeline (both GL shader and `applyColorToRaw`, identical order)

For each pixel, `c` = sampled sRGB value in `[0,1]`:

1. **Linear pre-pass** (only when `linear` matrix is non-identity):
   `lin = srgbToLinear(c); lin = M · lin; c = linearToSrgb(max(lin, 0))`
   where `M = 2^EV · CAT(tempK, tint)`.
2. **Tone LUT** (gamma, per channel): brightness-gamma → contrast → shadows →
   highlights → blacks/whites endpoints → fade → user curves.
3. **Chroma** (gamma): hue rotation → saturation × vibrance (unchanged math,
   minus temperature which has moved to step 1).
4. **Vignette** (gamma): bidirectional radial darken/lighten.
5. Clamp to `[0,1]`, write back (preserving alpha).

### sRGB transfer (shared, identical in GLSL and TS)

```
srgbToLinear(c) = c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4
linearToSrgb(c) = c <= 0.0031308 ? c*12.92 : 1.055*c^(1/2.4) - 0.055   // c clamped >= 0
```

## White-balance math (shared CPU, computed once per edit)

All produced in `linearParams(edits)` in `packages/shared/src/photo-color.ts`,
returning a flat **column-major** `mat3` (9 numbers) or `null` when identity.
Only these 9 numbers cross into the shader (as a `mat3` uniform) and into the
bake — so the hard color science is written **once** and never duplicated;
only the trivial `srgb↔linear` + `mat·vec` is mirrored in GLSL/TS.

Constants embedded in `photo-color.ts`:

- Linear-sRGB(D65) ↔ XYZ matrices (standard Rec.709/D65).
- Bradford cone matrix `MA` and its inverse.
- Krystek (1985) CCT→(u,v) rational approximation in CIE 1960 UCS, valid
  1000–15000K (covers the 2000–11000K slider range).

Steps:

1. `planckUv(K)` → `(u,v)` via Krystek.
2. **Tint** offsets `(u,v)` perpendicular to the locus (the Duv direction):
   numerically estimate the locus tangent at `K`, take the unit normal, offset
   by `(tint/150) · DUV_MAX`. Sign chosen so +tint yields a **magenta** image
   (verified by test). `DUV_MAX ≈ 0.02`.
3. `uvToXy` → `xyToXyz` (Y=1) gives the **source** white `Ws = white(K, tint)`.
4. **Destination** white `Wd = white(6500, 0)` computed by the same functions →
   guarantees `M = I` exactly at the neutral slider position (no faint cast at
   6500/0), and makes WB *relative* to neutral.
5. Bradford von-Kries adaptation `Ws → Wd` in XYZ:
   `cone_s = MA·Ws`, `cone_d = MA·Wd`, `D = diag(cone_d / cone_s)`,
   `M_xyz = MA⁻¹ · D · MA`.
6. Convert to linear-RGB space: `M_wb = M_xyz→rgb · M_xyz · M_rgb→xyz`.
7. Fold exposure: `M = (2^EV) · M_wb`. Return column-major; `null` if
   `EV == 0 && K == 6500 && tint == 0`.

Direction check: higher K ⇒ `Ws` bluer ⇒ adapting toward 6500 removes blue ⇒
**warmer** image. ✔

## Brightness (midtone gamma, gamma space, in `toneTransfer`)

`p = 2^(-(brightness/100) · BRIGHT_GAMMA)`, `BRIGHT_GAMMA ≈ 0.7`;
applied first in the transfer: `y = pow(clamp01(x), p)`. `brightness=0 ⇒ p=1 ⇒`
identity. `>0` lifts mids, `<0` darkens mids; `0` and `1` are fixed points.

## Model artifacts (shared)

`ColorModel` gains a field; `ChromaParams` loses temperature:

```ts
interface LinearParams { m: number[] }      // column-major 3×3 (exposure × WB CAT)
interface ChromaParams { satF; vib; hue }   // tempR/tempB removed
interface VignetteParams { strength }       // signed: <0 darken, >0 lighten
interface ColorModel { linear; tone; chroma; vignette }
```

`buildColorModel` adds `linear: linearParams(e)`. `color-bake.ts` is unchanged
(it just calls `buildColorModel`/`applyColorToRaw`).

## Neutral-aware defaults (critical)

Temperature's neutral is now `6500`, not `0`. Every place that defaulted a
missing field to `0` must default to the field's neutral. Add
`NEUTRAL: Record<ColorKey, number>` derived from `COLOR_FIELDS`; use it in:
`val()` (photo-color), `hasColor`, `sameEdits` (photo-edits), and the edit
panel's slider value. Otherwise an unedited photo reads temperature `0` ⇒ false
"has color" and a 0-Kelvin clamp.

## Migration (schema v3)

`EDITS_VERSION = 3`. In `coercePhotoEdits`, before clamping, migrate recipes
with `version < 3`:

- `exposure_EV = oldExposure/50 + log2(max(2^-5, 1 + oldBrightness/100))`
  (old exposure was `2^(x/50)`; old brightness was a redundant linear multiply —
  fold both into EV). Then `brightness → 0`.
- `temperature_K = 6500 - clamp(oldTemperature,-100,100)/100 · 2500`
  (old +100 warm → 4000K; old -100 cool → 9000K).
- `vignette → -oldVignette` when `oldVignette > 0` (old 0..100 darkened; new
  convention darkens negative).

All other fields keep their values (meaning/range unchanged). Clamping then uses
the new ranges; neutral values are dropped as today.

## UI (lightbox-edit-panel)

- Slider value/default: `working[f.key] ?? f.neutral` (was `?? 0`).
- Display formatting via an optional `ColorField.precision` (exposure: 2 → shows
  e.g. `1.50`; temperature/others: 0). Reset button shows the formatted value.
- Section grouping is unchanged (flat map over `COLOR_FIELDS`); Tint sits right
  after Temperature in the array, so it renders in the Color group automatically.

## Files touched

- `packages/shared/src/photo-color.ts` — core: COLOR_FIELDS, NEUTRAL, color
  science + `linearParams`, brightness gamma in `toneTransfer`, `chromaParams`
  (drop temp), `applyColorToRaw` (linear pre-pass + signed vignette), delete dead
  CSS/legacy funcs.
- `packages/shared/src/types.ts` — add `tint?`, update doc comments.
- `packages/shared/src/photo-edits.ts` — `EDITS_VERSION=3`, migration,
  neutral-aware `sameEdits`.
- `apps/web/src/features/photo-editor/render/gl-color.ts` — srgb/linear helpers,
  `uLinear` mat3 + `uHasLinear`, drop `uTempR/uTempB`, signed vignette,
  `GlColorModel.linear`.
- `apps/web/src/features/photo-editor/adjusted-image.tsx` — build `linear`; drop
  CSS fallback.
- `apps/web/src/features/photo-editor/lightbox-edit-panel.tsx` — neutral default,
  precision formatting.
- Tests: `photo-color.test.ts`, `photo-edits.test.ts` (rewrite removed-fn tests;
  add WB/brightness/migration/vignette tests).

## Test plan (TDD, CPU side carries parity)

- `linearParams`: identity at `EV=0,K=6500,tint=0`; warm (`K=4000`) → grey pixel
  R>B; cool (`K=9000`) → B>R; `tint=+150` → magenta (R,B > G); `tint=-150` →
  green; exposure folds (`EV=1` ≈ doubles linear).
- `applyColorToRaw`: exposure in linear (mid-grey raises correctly); WB reference
  pixel values; signed vignette darkens(<0)/lightens(>0); identity unchanged.
- brightness gamma: lifts midtone, fixes 0 and 1.
- `coercePhotoEdits` migration: legacy exposure/brightness → EV; legacy
  temperature → Kelvin; legacy vignette sign flip; v3 stamped.
- `hasColor`/`sameEdits`: unset temperature reads as neutral (6500), not 0.

Parity: the shader mirrors the exact same `srgb↔linear` + matrix + LUT + chroma +
vignette math; the 3×3 and LUT are shared bytes. CPU tests assert concrete pixel
values; the user verifies preview==save visually on real photos.

## Out of scope

Vignette in linear light (kept in gamma, conventional); 16-bit output container;
per-channel HSL. Hue stays as a global rotation.
