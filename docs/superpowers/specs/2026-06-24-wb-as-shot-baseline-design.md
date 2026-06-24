# White-Balance As-Shot Baseline — Per-Photo Neutral From Ingest

Date: 2026-06-24
Status: Design approved by user; spec under review before planning

## Goal

Today every photo opens in the editor with Temperature pinned at **6500K** and
Tint at **0**, regardless of the image. We want each photo to carry its own
**as-shot baseline** `(asShotTempK, asShotTint)`, estimated from its pixels at
ingest, so the Temperature/Tint sliders *open at* — and *reset to* — a value that
reflects the photo, the way Lightroom shows a RAW file's as-shot temperature.

The baseline is the photo's **white-balance identity point**: at the baseline the
WB matrix is identity, so the photo at its default looks exactly like the file —
the baseline is a non-destructive anchor, not an applied correction.

This builds directly on `2026-06-24-proper-color-adjustments-design.md` (the
Kelvin WB + Bradford CAT introduced there). It changes only the *destination*
white point of that adaptation from a global constant to a per-photo value.

## Decisions (locked with user)

1. **Semantics = non-destructive anchor (option A).** The baseline is the slider's
   default / neutral / reset value. At the baseline the WB matrix is identity →
   zero pixel change vs. today's output. Dragging left of baseline cools, right
   warms — same feel as today's slider, anchored per-photo.
2. **Source = pixel estimate only (option 3 in the source discussion).** No
   EXIF / maker-note reads. The metadata extractor (`metadata.ts`) is untouched.
   Rationale: uniform behaviour for every photo (camera files, screenshots, web
   images, exports) and no exifr option changes.
3. **No meaningful ingest slowdown.** The estimate runs on an already-decoded
   small buffer (≤128px) produced during rendition/thumbhash generation — a
   single O(n) pass, sub-millisecond. **Never re-read or fully re-decode the
   original** for the estimate.
4. **Storage = two nullable columns** on `Photo`: `asShotTempK Float?`,
   `asShotTint Float?`. Additive `ALTER TABLE ... ADD COLUMN` migration
   (non-destructive, safe on the shared dev DB). Derived first-class property, not
   EXIF, so it does not live in the `exif` JSON.
5. **Backward compatible by construction.** A `null` baseline ≡ `(6500, 0)`
   everywhere → existing photos and existing renderings are byte-for-byte
   unchanged until/unless a baseline is computed for them.
6. **Edit-safety rule (critical).** A baseline only changes what a saved
   `temperature` *means*, so a baseline is assigned **only to photos whose
   `edits` are `null`**. New photos get their baseline at first ingest, before any
   edit exists. Already-edited photos keep `null` (≡ 6500/0), preserving their
   saved look exactly. Re-ingest of an edited photo never recomputes the baseline.

## The one math change

In `packages/shared/src/photo-color.ts`, `adaptMatrixRgb(K, tint)` currently
computes the destination white as the hard-coded `whiteXyz(NEUTRAL_K, 0)`
(line ~204). We make the destination per-photo:

```
// before:  wd = whiteXyz(NEUTRAL_K, 0)               // identity at (6500, 0)
// after:   wd = whiteXyz(baseK, baseTint)            // identity at the baseline
```

Everything else in the WB pipeline (Planckian locus, Bradford CAT, exposure fold,
column-major output, the GLSL `srgb↔linear`+`mat·vec` mirror) is unchanged.

**Key consequence — no shader change.** The WB matrix is computed in TS
(`linearParams`) and only the resulting 9-number `mat3` crosses into the WebGL
shader. Because the baseline changes only *how that matrix is computed*, the GLSL
needs no edits. The shader keeps consuming `uLinear`; the bake keeps calling
`applyColorToRaw`. Only the **callers of `buildColorModel`** must pass the
baseline.

Direction sanity check: with baseline `B` and slider `S`, `M = adapt(whiteXyz(S)
→ whiteXyz(B))`. `M(B) = I`. `S > B` ⇒ bluer source ⇒ warmer result (drag right
= warmer); `S < B` ⇒ cooler. Consistent with the existing Lightroom convention.

## Threading the baseline through the color model

Introduce a small baseline type and thread it as an optional argument that
defaults to neutral:

```ts
interface WbBaseline { k: number; tint: number }      // null/undefined ≡ {k:6500, tint:0}
```

- `adaptMatrixRgb(K, tint, baseline?)` — destination white from `baseline`.
- `linearParams(e, baseline?)` — passes baseline to `adaptMatrixRgb`; the
  `wbActive` test becomes `K !== (baseline?.k ?? 6500) || tint !== (baseline?.tint ?? 0)`.
- `buildColorModel(e, toneSamples?, baseline?)` — forwards the baseline.
- **Neutral-aware reads.** `val(e, "temperature")` / `val(e, "tint")` must default
  a *missing* field to the **baseline**, not the global `NEUTRAL`. So `val` (or its
  callers `hasColor`, and `sameEdits` in `photo-edits.ts`) needs the baseline in
  scope for the two WB keys. A photo with no `temperature` edit must read as the
  baseline and count as neutral (no false "has color").

Default-when-absent rule: every `?? 6500` / `?? NEUTRAL.temperature` for WB keys
becomes `?? baseline.k` (and tint `?? baseline.tint`), with `baseline` defaulting
to `{6500, 0}` when the photo has none.

## Estimation

A pure, testable function in `packages/shared/src/photo-color.ts` (co-located with
the forward color science it inverts), called from ingest:

```ts
// Returns the as-shot white, or null when it can't estimate (degenerate image).
estimateAsShotWhite(
  rgb: Uint8Array | Uint8ClampedArray,   // packed, `channels` per pixel
  width: number, height: number, channels: number,
): WbBaseline | null
```

Algorithm (robust gray-world):

1. Iterate the small buffer. Per pixel: convert sRGB→linear (`srgbToLinear`).
2. Reject pixels that bias the estimate: near-black (`luma < 0.02`), near-clipped
   (`luma > 0.98`), and highly saturated (`sat > ~0.6`) — keep near-neutral
   pixels, weighted `w = (1 - sat)` so dominant single-hue scenes (grass, sky)
   don't skew the result.
3. Accumulate weighted linear `(R̄, Ḡ, B̄)`. If too few valid pixels → return
   `null`.
4. `RGB2XYZ · (R̄,Ḡ,B̄)` → XYZ → chromaticity `(x, y)`.
5. **CCT** via McCamy: `n = (x − 0.3320)/(0.1858 − y)`,
   `CCT = 449n³ + 3525n² + 6823.3n + 5520.33`.
6. **Tint** = signed Duv from `(u, v)` to the locus point `planckUv(CCT)`,
   inverted through the *same* Duv↔tint mapping the forward model uses
   (`off = TINT_SIGN · (tint/TINT_RANGE) · DUV_MAX` ⇒
   `tint = TINT_SIGN · (Duv / DUV_MAX) · TINT_RANGE`), with the normal orientation
   matching `whiteXyz`.
7. Clamp `K` to `[2000, 11000]`, `tint` to `[-150, 150]`. Return `{k, tint}`.

Because the default is non-destructive, a mediocre estimate only changes the
displayed/anchor number — never the rendered pixels — so the estimator is
deliberately simple.

### Where it runs in ingest

In `packages/ingest/src/process.ts` (`processImage`), reuse the smallest raw RGB
buffer already decoded for the thumbnail / thumbhash path (or a cheap in-memory
`sharp(...).resize(≤128).raw()` on the *already-decoded* image — no disk re-read).
Compute `estimateAsShotWhite(...)` **only when the photo has no existing edits**
(per the edit-safety rule), and pass the result to `storePhoto`, which writes
`asShotTempK` / `asShotTint` on the upsert (`store.ts`). On re-ingest of a photo
that already has `edits`, leave the existing baseline untouched.

## Plumbing the baseline to the editor and the bake

- **Schema:** `packages/db/prisma/schema.prisma` — add `asShotTempK Float?` and
  `asShotTint Float?` to `Photo`; generate the additive migration.
- **Editor payload:** wherever the editor's photo data is assembled server-side,
  include `asShotTempK` / `asShotTint` alongside `edits`. The client builds
  `baseline = { k: asShotTempK ?? 6500, tint: asShotTint ?? 0 }` and passes it into
  `buildColorModel` for the GL preview.
- **Bake:** `packages/ingest/src/color-bake.ts` reads the photo's baseline from the
  DB row and passes it into `buildColorModel` so the baked output matches the
  preview. (`preview == bake` invariant preserved.)
- **Persistence on save:** `photo-edits-service.ts` is unchanged — it still stores
  the `edits` recipe. The baseline is a separate, ingest-owned property and is not
  written by edit saves.

## UI (lightbox edit panel)

- Temperature/Tint slider **initial value, neutral marker, and double-click
  reset** use the photo's baseline (`baseline.k` / `baseline.tint`) instead of the
  global `f.neutral`. Other sliders keep `f.neutral`.
- Slider **min/max unchanged** (2000–11000 K; −150…150 tint). The baseline only
  moves the start/reset point within that fixed axis.
- "Has edits" / modified-dot logic treats a WB value equal to the baseline as
  neutral.

## Backfill

Existing **unedited** photos can get baselines via an optional one-off
re-process pass (decode small buffer → estimate → write columns), gated on
`edits IS NULL`. Not required for correctness — new ingests get baselines
automatically, and any photo without one renders exactly as today.

## Files touched

- `packages/shared/src/photo-color.ts` — `WbBaseline` type; `adaptMatrixRgb`
  destination from baseline; baseline params on `linearParams` / `buildColorModel`
  / `val` (WB keys); new `estimateAsShotWhite` + chromaticity→(K,tint) inversion
  helpers.
- `packages/shared/src/photo-edits.ts` — baseline-aware `sameEdits` / neutral
  checks for WB keys.
- `packages/db/prisma/schema.prisma` (+ migration) — `asShotTempK`, `asShotTint`.
- `packages/ingest/src/process.ts` — estimate (when `edits` null) from the small
  buffer; thread to store.
- `packages/ingest/src/store.ts` — persist the two columns on upsert; preserve
  existing baseline on re-ingest.
- `packages/ingest/src/color-bake.ts` — pass the photo's baseline to
  `buildColorModel`.
- `apps/web` editor: photo payload loader (add baseline fields), the GL preview
  build site (pass baseline into `buildColorModel`), `lightbox-edit-panel.tsx`
  (baseline-anchored default/neutral/reset for Temperature & Tint).
- Tests: `photo-color.test.ts` (estimation round-trip, baseline matrix), plus the
  parity/neutral checks below.

## Test plan

- **`estimateAsShotWhite`:** synth a neutral buffer → `≈ (6500, 0)`; synth a warm
  cast (uniform high-R/low-B) → `K` high; cool cast → `K` low; green/magenta
  casts → `tint` sign correct; all-black / no-valid-pixels → `null`.
- **Baseline matrix:** `adaptMatrixRgb(baseK, baseTint, {baseK, baseTint}) == I`
  (identity at baseline); `S > baseK` warms, `S < baseK` cools.
- **Backward compat:** `null` baseline path is byte-identical to current output
  for `linearParams` / `applyColorToRaw` (no baseline ⇒ destination `whiteXyz(6500,
  0)`).
- **Neutral reads:** an unedited photo with baseline `(7200, 0)` reports
  `hasColor == false` and the panel shows `7200`, not `6500`.
- **preview == bake:** with a baseline set and a non-trivial edit, the GL preview
  and the Sharp bake produce matching pixels (existing parity assertions extended
  to pass the baseline on both sides).

## Out of scope

- EXIF / maker-note / XMP `crs` temperature reads (explicitly declined; pixel-only).
- Auto-*applying* a correction at ingest (that was option B; we do non-destructive
  anchoring only).
- A user-facing "As Shot" vs "Auto" WB mode dropdown.
- Re-estimating the baseline for already-edited photos.
