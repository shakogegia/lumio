# Detail & Grain Sliders — Sharpen, Masking, Noise Reduction, Grain (v1, single-pass)

Date: 2026-06-24
Status: Design — pending user review

## Goal

Add the first batch of *detail* and *effect* sliders to the GPU photo editor:
**Sharpen**, **Sharpen Masking**, **Noise Reduction**, **Grain**, and **Grain
Size**. These are the Lightroom Detail/Effects controls that can be computed in a
**single render pass** — one read of a small source neighborhood per pixel plus a
per-pixel grain hash — so they preserve the editor's load-bearing invariant:
**preview == bake** (the WebGL2 shader and the Node/Sharp `applyColorToRaw` run
the identical math).

This is **v1** of a phased plan. v2 (Texture, Clarity, large Sharpen Radius,
multi-scale Noise Reduction) and v3 (Dehaze) are deliberately out of scope — see
*Phasing* below — because they require a ping-pong **framebuffer + separable
blur** that v1 intentionally avoids.

## Why these five are "free-when-unused" and single-pass

- A **pass** is how many times we run a shader/loop over the image; a **slider**
  is a parameter fed into it. The current pipeline is one pass (point ops). All
  five new sliders fit *inside that one pass*: sharpen and noise reduction read a
  fixed **3×3** neighborhood of the *source* (one extra texture fetch pattern, no
  framebuffer); grain is a per-pixel hash.
- They are **gated**: when a slider is neutral (0) its math is skipped (shader
  branch on a uniform; bake skips the pass and the buffer copy). A photo that
  uses none of them renders and **bakes byte-for-byte and speed-for-speed
  identical to today**.
- What *would* force a second pass — and is therefore excluded from v1 — is any
  effect needing a **larger** neighborhood (Texture/Clarity radius) or one
  spatial filter's *finished output* as another's input (proper
  denoise-then-sharpen, multi-scale NR). Those are v2.

## Decisions (locked)

1. **Five new optional `PhotoEdits` fields, all neutral = 0** → purely additive,
   **no schema migration** (absent === off, unlike the v3 color rework):
   - `sharpen` — 0..100 (unsharp-mask amount)
   - `sharpenMask` — 0..100 (hold sharpening back in flat areas)
   - `noiseReduction` — 0..100 (edge-aware smoothing toward the local mean)
   - `grain` — 0..100 (film-grain amount)
   - `grainSize` — 0..100 (grain cell size; only meaningful when `grain > 0`)
2. **Sharpen & Noise Reduction operate on the SOURCE, before the color pipeline.**
   We read the source 3×3 once, denoise + sharpen the center, then run the
   existing color math (linear → tone → chroma → vignette) on that single adjusted
   value. Reading neighbors of the *unchanged source* is what keeps it one pass —
   we never need color applied to neighbors.
3. **Grain is applied LAST**, after vignette, per pixel — it sits on the final
   look (Lightroom convention, next to Vignette in Effects).
4. **Gamma space, per-channel RGB** for the detail step (operate on the sampled
   sRGB values directly). No extra srgb↔linear round-trips — fewer ops, smaller
   parity surface. Per-channel (not luma-only) keeps the math trivially mirrored;
   color fringing is negligible at these amounts.
5. **Fixed 3×3 kernel (radius ≈ 1px). No Radius slider in v1** — variable/large
   radius is the v2 framebuffer work.
6. **Integer pixel-coordinate hash for grain** (WebGL2 `uint` bit-ops, mirrored
   in JS with `Math.imul`/`>>> 0`). No GPU-dependent `sin`-hash — that is the
   only way grain can match between GPU and CPU.
7. **Neighbor sampling at exact texel centers** + **CLAMP_TO_EDGE** so the GPU's
   LINEAR filter returns the raw texel (matching `buf[neighbor]`) and edges clamp
   identically on both sides.

## The pipeline (GL shader and `applyColorToRaw`, identical order)

For each output pixel at integer coords `(x, y)`, with `src` = the pristine
source:

1. **Read 3×3 neighborhood** of `src` around `(x,y)`, edges clamped. Per channel:
   - `blur` = Gaussian-weighted mean, weights `G = [1,2,1, 2,4,2, 1,2,1] / 16`.
   - `nrMean` = **bilateral**-weighted mean: neighbor weight
     `w_i = G_i · exp(−(Δluma_i)² / σ²)`, where `Δluma_i` is the luma difference
     between neighbor and center and `σ` derives from `NR_SIGMA`. `nrMean =
     Σ w_i c_i / Σ w_i`.
2. **Noise Reduction** (per channel):
   `den = mix(center, nrMean, nr)`, `nr = noiseReduction/100`.
   (Bilateral mean preserves edges; flat noise collapses toward the mean.)
3. **Sharpen** (per channel), using the *denoised* center against the Gaussian
   `blur` of the original neighborhood:
   - `edgeMask = smoothstep(MASK_LO, MASK_HI, |∇luma|)` — local luma-gradient
     magnitude; ≈0 on flat areas, ≈1 on edges.
   - `m = mix(1.0, edgeMask, sharpenMask/100)` — masking=0 sharpens everywhere;
     masking=100 sharpens edges only.
   - `c = den + (sharpen/100)·SHARPEN_MAX · m · (den − blur)`.
   - Because denoise shrinks `(den − blur)` in noisy/flat regions, sharpening does
     **not** re-amplify the noise we just removed — the natural NR-before-sharpen
     ordering, from a single neighborhood read.
4. **Existing color** on `c` (unchanged): linear pre-pass → tone LUT → chroma →
   vignette.
5. **Grain** (per pixel, monochrome, post-vignette):
   `g = valueNoise(x, y, cell) ∈ [−1, 1]`; `c += (grain/100)·GRAIN_MAX · g`
   (same delta added to R,G,B). `cell` = grain cell size from `grainSize`
   (1 → fine/per-pixel; larger → coarser clumps). `valueNoise` = bilinear-
   smoothstep interpolation of an integer lattice hash (see *Grain math*).
6. Clamp to `[0,1]`, write back (alpha preserved).

When `sharpen == 0 && noiseReduction == 0`, steps 1–3 are skipped entirely (no
neighborhood read / no buffer copy). When `grain == 0`, step 5 is skipped.

### Grain math (shared, bit-identical GLSL ↔ JS)

Integer lattice hash → `[0,1)` float, then value-noise interpolation:

```
// 32-bit integer hash (identical in GLSL `uint` and JS via Math.imul / >>>0)
h(ix, iy):
  n = (ix * 0x1f1f1f1f) ^ iy            // wrap to uint32
  n = n * 0x27d4eb2d                    // Math.imul in JS
  n = n ^ (n >>> 15)
  return (n >>> 0) / 4294967296.0       // [0,1)

valueNoise(x, y, cell):
  fx = x / cell; fy = y / cell
  ix = floor(fx); iy = floor(fy); tx = fx - ix; ty = fy - iy
  sx = smoothstep(tx); sy = smoothstep(ty)
  v = bilerp( h(ix,iy), h(ix+1,iy), h(ix,iy+1), h(ix+1,iy+1), sx, sy )
  return v * 2.0 - 1.0                  // [-1,1]
```

`cell = 1 + (grainSize/100) · (GRAIN_CELL_MAX − 1)`. **Pixel coords match
orientation**: the shader uses `floor(vUv · uResolution)` (vUv already flips V so
row 0 = image top), so `(x,y)` agree with the bake's top-down loop indices.

### Edge handling & sampling (shared)

- Shader: `texture(uImage, vUv + vec2(dx,dy) · uTexel)` with `uTexel =
  1/uResolution`, sampled at texel centers; texture is `CLAMP_TO_EDGE` + LINEAR
  → exact neighbor texel.
- Bake: neighbor index `clamp(x+dx, 0, width-1)`, `clamp(y+dy, 0, height-1)` →
  same clamped texel. Same `G` weights, same `σ`, same constants.

## Model artifacts (shared, `photo-color.ts`)

`ColorModel` gains two nullable fields:

```ts
interface DetailParams {
  sharpen: number; // 0..1 (amount/100); 0 ⇒ no sharpen
  mask: number;    // 0..1 (masking strength)
  nr: number;      // 0..1 (noise-reduction strength)
}
interface GrainParams {
  amount: number;  // 0..1 (grain/100)
  cell: number;    // grain cell size in px (≥1)
}
interface ColorModel { linear; tone; chroma; vignette; detail; grain }
```

- `detailParams(e)` → `null` when `sharpen === 0 && noiseReduction === 0`
  (masking alone is a no-op).
- `grainParams(e)` → `null` when `grain === 0`.
- `buildColorModel` adds `detail: detailParams(e)`, `grain: grainParams(e)`.
- Tuning constants live in `photo-color.ts` next to the existing ones:
  `SHARPEN_MAX`, `MASK_LO`, `MASK_HI`, `NR_SIGMA`, `GRAIN_MAX`, `GRAIN_CELL_MAX`.

## Bake (`applyColorToRaw`, `color-bake.ts`)

- Extend the early-out: `if (!linear && !tone && !chroma && !vignette && !detail
  && !grain) return;`
- When `detail` is active, allocate **one pristine copy** `src = buf.slice()`
  before the loop and read all neighbors from `src` (you cannot read original
  neighbors out of a buffer you are mutating in place). No copy when only grain is
  active.
- `width`, `height`, `x`, `y` are already in scope (vignette uses them).
- `hasColor` automatically covers the new keys (it iterates `COLOR_FIELDS`), so
  `applyColorBake`'s `if (!hasColor(edits)) return img` gate extends for free.
- Cost: only when sharpen/NR active — ~2–3× the per-pixel work (9-tap pass) +
  one frame-sized allocation, freed immediately. Grain ≈ +10–20%, no copy.
  Neutral photos: unchanged.

## Shader (`gl-color.ts`)

- New uniforms: `uResolution` (vec2), `uHasDetail` (bool), `uSharpen`, `uMask`,
  `uNr`, `uHasGrain` (bool), `uGrainAmount`, `uGrainCell`.
- `GlColorModel` gains `detail: DetailParams | null` and `grain: GrainParams |
  null`; `render()` sets the new uniforms (and `uResolution = [width,height]`).
- Add the 3×3 sample + detail block before the existing color math, and the grain
  block after vignette. Gated by `uHasDetail` / `uHasGrain` so neutral edits cost
  nothing.

## UI (`lightbox-edit-panel.tsx`)

No structural change — the panel flat-maps `COLOR_FIELDS`. Add five entries to
`COLOR_FIELDS` in `photo-color.ts` in display order so they group sensibly under
"Adjust":

```
// Detail
{ key: "sharpen",        label: "Sharpen",         min: 0, max: 100, neutral: 0, step: 1 },
{ key: "sharpenMask",    label: "Sharpen Masking", min: 0, max: 100, neutral: 0, step: 1 },
{ key: "noiseReduction", label: "Noise Reduction", min: 0, max: 100, neutral: 0, step: 1 },
// Effects (after vignette)
{ key: "grain",          label: "Grain",           min: 0, max: 100, neutral: 0, step: 1 },
{ key: "grainSize",      label: "Grain Size",      min: 0, max: 100, neutral: 0, step: 1 },
```

`ColorKey` gains the five keys; sliders, reset buttons, and the "has color"
indicator all derive from `COLOR_FIELDS` automatically. (Optional later polish:
only surface Masking/Grain Size when their parent is non-zero — not required for
v1.)

## Files touched

- `packages/shared/src/photo-color.ts` — `ColorKey` + `COLOR_FIELDS` (5 keys),
  tuning constants, `DetailParams`/`GrainParams`, `detailParams`/`grainParams`,
  `buildColorModel`, neighborhood + grain math in `applyColorToRaw`, early-out.
- `packages/shared/src/types.ts` — 5 optional fields + doc comments on
  `PhotoEdits`.
- `apps/web/src/features/photo-editor/render/gl-color.ts` — `GlColorModel`
  fields, uniforms, 3×3 detail block, grain block, `render()` wiring.
- `apps/web/src/features/photo-editor/adjusted-image.tsx` — pass `detail`/`grain`
  from the model into `GlColor.render` (verify it forwards the whole model;
  likely no change if it spreads `buildColorModel`).
- `packages/ingest/src/color-bake.ts` — no change expected (delegates to
  `buildColorModel`/`applyColorToRaw`); confirm.
- Tests: `photo-color.test.ts` (new parity cases below).
- `MEMORY.md` + a memory note on the phased detail/grain plan.

## Test plan (TDD — CPU side carries parity)

- **Sharpen:** bright center pixel on a flat field → center boosted, ring dipped;
  assert exact values. `sharpen=0` → identity. Per-channel symmetry.
- **Masking:** flat noisy field → with `sharpenMask=100`, output ≈ input
  (mask≈0, no amplification); a hard edge → sharpened (mask≈1).
- **Noise Reduction:** alternating noise on a flat region → collapses toward the
  mean as `nr→100`; a step edge is preserved (bilateral). `nr=0` → identity.
- **Edge clamp:** corner/edge pixels use clamped neighbors (no wrap, no OOB).
- **Grain:** determinism — `h(x,y)` stable and equal to known fixtures;
  `valueNoise` continuity across cell boundaries; `grain=0` → identity;
  `grainSize` changes cell size; the JS hash matches the documented integer ops.
- **Gating:** `hasColor` true when any new field non-neutral; `applyColorToRaw`
  early-outs when all neutral; detail copy only allocated when sharpen/NR active.
- **Parity:** shader mirrors the same `G` weights, `σ`, constants, hash, and
  clamp; CPU tests assert concrete pixel values; user verifies preview==save
  visually on a real photo (esp. grain orientation and edge rows).

## Phasing (out of scope here)

- **v2 — one focused build: ping-pong framebuffer + separable blur.** Unlocks
  Texture, Clarity, large Sharpen Radius, and proper multi-scale / Color Noise
  Reduction — all share that one primitive (high-pass at radius R). Highest-
  leverage next step once v1 proves spatial preview==bake.
- **v3 — Dehaze.** Its own thing (dark-channel-prior atmospheric model); not part
  of the unsharp family.
```
