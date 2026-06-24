# GPU photo editor: WYSIWYG preview, full Lightroom slider set, 16-bit bake, async save

**Date:** 2026-06-24
**Status:** Approved (pre-approved by user; this doc records the design + the engineering decisions made on their behalf)

## 1. Goals

1. **WYSIWYG editing.** What the user sees while dragging a slider must equal the saved result. Today there are *two* renderers — a crude CSS-filter preview and a separate `sharp` bake — and they only approximate each other.
2. **The full Lightroom-style slider set.** Keep the existing eight (exposure, brightness, contrast, saturation, temperature, hue, fade, vignette) and add **highlights, shadows, blacks, whites, vibrance, and curves**.
3. **Fix the crop-mode bug.** Entering Crop mode currently shows the *unadjusted* base image; it must show the slider-adjusted image.
4. **16-bit, color-managed bake.** Process internally at higher precision to kill banding; preserve/handle ICC sanely. (Output stays 8-bit sRGB for now.)
5. **Non-blocking save.** Pressing Save must not make the user wait for the full-resolution bake — move rendition regeneration to the existing background worker.

## 2. Non-goals (this project)

- **Display-P3 / wide-gamut output.** Deferred. See `docs/display-p3-color-management.md` for the pickup plan. The 16-bit work here is a prerequisite and is done so P3 is a smaller follow-up.
- **Local edits / masks / brushes / layers.** Deferred. The renderer seam we build keeps this open (and is the point at which a heavier engine like PixiJS would earn its keep).
- **RAW developing**, lens corrections, noise reduction, sharpening. Out of scope.
- Replacing the worker queue or its transport (still DB-polled; activity polling unchanged).

## 3. Background — current state (verified in code)

- **Preview (CSS).** `EditedResult` (`apps/web/src/features/photo-editor/edited-result.tsx`) renders the edit-free base `<img>` with `colorCssFilter(working)` as a CSS `filter` plus `colorOverlays(working)` divs (temperature/fade/vignette). Geometry is CSS transforms in `BaseImageStage`.
- **Crop mode** renders `EditorCanvas` → `BaseImageStage` with `src=baseSrc` and **no color filter at all** → the bug in goal #3.
- **Bake (`sharp`).** `packages/ingest/src/renditions.ts` applies color in three passes with PNG round-trips (`.linear()` → `.modulate()` → per-channel `.linear()` → vignette `.composite()`), all **8-bit sRGB**, **no tone curves/LUTs**. `encodeEditedJpeg` (full-res) and `buildRenditions` (display ≤2048 webp q80, thumb ≤400) share these.
- **Single source of truth.** `packages/shared/src/photo-color.ts` derives *both* the CSS preview params *and* the `sharp` params from one set of tuning constants. This is the property we must preserve.
- **Save.** `use-edit-session.tsx#apply()` POSTs `/photos/[id]/edit`; the route (`applyPhotoEdits`) regenerates renditions **synchronously** and returns the new DTO. Client `patchPhotos` updates the store.
- **Worker.** DB-backed polling queue (`packages/jobs`, `apps/worker`), `Job` table, atomic claim, `JobType` enum (rescan/purge_all/empty_trash). Client `useActivity()` polls `/activity` (1.5s busy / 5s idle). Optimistic `patchPhotos` already exists. No rendition job yet.
- **Tests.** `vitest`. Pure math is unit-tested (`photo-color.test.ts`); bake is integration-tested against pixel stats (`renditions.test.ts`).

## 4. Key decision — custom WebGL2, not a library dependency

We will **not** add PixiJS, mini-gl, Fabric, or Konva as a runtime dependency. Instead we write a small, focused **WebGL2 color renderer** (one textured quad, a handful of fragment-shader ops) that consumes the *same* parameters `photo-color.ts` produces for the bake.

**Why:**
- WYSIWYG demands one source of truth for the math. A library brings its *own* shader formulas that won't match `sharp`; reconciling 14 sliders across two engines is the costly, bug-prone path.
- For one image quad, a library's scene graph/batching is dead weight. Our footprint is a few KB of shader + loader.
- mini-gl is MIT and its sRGB-correct formulas are an excellent **reference** for the shader math — we borrow the math, not the dependency.
- The renderer lives behind a single component (`<AdjustedImage>`, §6). Swapping to PixiJS later (when masks/brushes arrive) is a contained change — the shared color model and bake are untouched.

**Fallback:** if WebGL2 is unavailable, `<AdjustedImage>` falls back to the *current* CSS-filter approximation (kept, not deleted). The editor never hard-depends on GL.

## 5. The unified color model (the heart of the design)

All color math moves into shared builders that produce three renderer-agnostic artifacts, consumed identically by the GPU shader and the bake:

### 5a. Tone LUT — one 256-entry lookup per channel
Every *tonal* slider collapses into a single per-channel lookup table `tone: { r: Uint8Array(256), g: …, b: … }` (master curve applied equally to R/G/B, plus optional per-channel curve points):

- **exposure** — multiplicative gain (`2^(exposure/50)`, preserved from today).
- **brightness** — linear gain (`1 + brightness/100`).
- **contrast** — gain about mid-grey pivot.
- **blacks / whites** — move the low / high anchor of the tone line (black-point lift / white-point pull).
- **shadows / highlights** — smooth region gain: a luminance-weighted bump that lifts/cuts the lower (shadows) or upper (highlights) range with a smooth falloff, so it doesn't touch midtones. Implemented as additive curve deltas with a smoothstep weight.
- **fade** — black lift (matte) for `+`, deepen for `−` (preserved).
- **curves** — user spline (master + optional R/G/B), composed last.

`buildToneLut(edits)` evaluates the composed transfer function at 256 input levels per channel. Because the GPU samples this exact LUT (as a 256×1 texture) and the bake applies this exact LUT to raw pixels, **highlights/shadows/blacks/whites/curves are pixel-identical between preview and save** — the adjustments CSS literally cannot express become exact.

> v1 evaluates the tone transfer in sRGB-encoded space (matches today's bake, simplest parity). A later refinement can move tone to linear light; noted in the P3 doc since they share the color-management plumbing.

### 5b. Chroma params — per-pixel, post-tone
Applied after tone, per pixel, in both renderers from identical params:
- **saturation** — chroma scale (luma-preserving).
- **vibrance** — saturation that scales *less* for already-saturated pixels (smooth nonlinear weight) — the slider CSS can't do, hence a real reason for the GL move.
- **hue** — rotation (degrees).
- **temperature** — per-channel R/B gain (`±TEMP_CHANNEL_GAIN`, preserved from today).

`chromaParams(edits)` returns `{ saturation, vibrance, hue, temperature }` (null when all neutral).

### 5c. Vignette params — spatial
`vignetteParams(edits)` → `{ strength }` (0..max). GPU computes radial falloff from UV; bake multiplies by the same radial mask. (Replaces today's SVG-composite approach with a parametric one for exact parity.)

### 5d. Shared module shape
`photo-color.ts` keeps `COLOR_FIELDS` (extended with the six new fields) and gains: `buildToneLut`, `chromaParams`, `vignetteParams`, plus a small `applyColorToRaw(rgb, w, h, model)` pure function (used by the bake; the GPU path reuses the same per-pixel formulas in GLSL). `colorCssFilter`/`colorOverlays` are retained only for the GL-unavailable fallback. Curve evaluation (Catmull-Rom/monotone spline → sampled points) is a new pure module `tone-curve.ts` with its own tests.

### 5e. New fields on `PhotoEdits`
`highlights, shadows, blacks, whites, vibrance` (each `-100..100`, 0 neutral) and `curves?: CurveSpec` where `CurveSpec` is `{ master: Point[]; r?: Point[]; g?: Point[]; b?: Point[] }`, `Point = { x: number; y: number }` in 0..1, absent = identity. Bump `EDITS_VERSION`; the zod schema in `api.ts` and `sameEdits`/reset logic extend accordingly. Legacy recipes (no new fields) are neutral by construction.

## 6. Architecture — components & data flow

```
packages/shared/src/
  photo-color.ts     COLOR_FIELDS (+6), buildToneLut, chromaParams, vignetteParams, applyColorToRaw
  tone-curve.ts      spline → sampled transfer (pure, tested)
  types.ts           PhotoEdits + new fields + CurveSpec
  photo-edits.ts     EDITS_VERSION bump, sameEdits unaffected by new fields' absence

apps/web/src/features/photo-editor/
  render/gl-color.ts        WebGL2 renderer: upload image + tone-LUT texture + chroma/vignette uniforms → draw quad. Plain class, no React.
  adjusted-image.tsx        <AdjustedImage src working onLoad/> — owns a <canvas>, drives gl-color; CSS-filter fallback when no WebGL2. THE render seam.
  base-image-stage.tsx      uses <AdjustedImage> instead of <img>  → geometry wraps the adjusted pixels → crop mode shows adjusted image (fixes §3 for free)
  edited-result.tsx         drops CSS filter/overlay divs (color now in the image layer)
  lightbox-edit-panel.tsx   new slider controls + a <CurveEditor> for curves

packages/ingest/src/
  color-bake.ts      applyColorToRaw-based color pass over a raw RGB(16) buffer (replaces 3-pass sharp color in renditions.ts)
  renditions.ts      decode→geometry→resize→raw→applyColor→encode, in 16-bit (§7)
```

**Preview data flow:** slider → `setColor` → `working` recipe → `buildToneLut`/`chromaParams`/`vignetteParams` (memoized) → `<AdjustedImage>` re-draws the quad (LUT texture + uniforms). One quad, sub-millisecond redraw.

**Bake data flow:** `buildToneLut`/`chromaParams`/`vignetteParams` → `applyColorToRaw` over the decoded raw buffer → identical pixels to the preview. The geometry, resize, and encode stay in `sharp`.

**Why the crop bug disappears:** color now lives inside `<AdjustedImage>` (the image layer), which `BaseImageStage` renders in *both* edit mode and crop mode. There is no longer a code path that shows the base without color.

## 7. 16-bit, color-managed bake

- Process the pipeline in 16-bit: decode → `ensureAlpha`/16-bit working buffer → geometry/resize in `sharp` → extract raw 16-bit RGB → `applyColorToRaw` (operating on 16-bit values, LUT interpolated to 16-bit) → encode to 8-bit sRGB output (JPEG q92 / WebP q80).
- On decode, honor the source ICC: convert to a known working space (sRGB for v1) via `sharp` colorspace handling rather than assuming sRGB. Output tagged sRGB.
- Not a user setting — always on. (A hidden dev flag may be used during evaluation only.)
- The tone LUT is evaluated at higher resolution (≥1024 entries) and interpolated so 16-bit precision isn't quantized by a 256-entry table; the GPU preview uses a 256-entry texture with hardware linear interpolation (visually identical at preview scale).

## 8. Crop-mode fix

Folded into §6 (via `<AdjustedImage>`). If we ship the crop fix *before* the GL renderer (recommended quick win — see plan Phase 1), the interim fix wraps `BaseImageStage` in crop mode with `colorCssFilter` + `colorOverlays`, matching `EditedResult` today. The GL work then supersedes it. Either way the crop frame/dim/handles stay above the adjusted image.

## 9. Async (non-blocking) save

**Decision — optimistic, non-blocking client (not a worker job).** The original plan
moved rendition regeneration to a `regenerate_renditions` worker job. On reflection
that carried three compounding risks for little extra user-visible benefit on a
self-hosted single-host deployment: (1) a **migration on the shared dev Postgres**
(every worktree shares one DB — adding a `Job.payload` column + a `_prisma_migrations`
record creates drift other branches' `migrate dev` would try to "fix" by resetting);
(2) a **rendition-versioning race** — the route bumping `updatedAt` before the worker
rebakes would serve the *old* cached file under the new URL; (3) **client
reconciliation** needing a photo↔job mapping and refetch. The chosen design avoids all
three:

- **Route (`/photos/[id]/edit`): unchanged** — still validates, regenerates renditions, and returns the authoritative DTO. The regen runs inside the request (fine on a persistent self-hosted Node server); the user is simply no longer *blocked* on it.
- **Client (`apply()`): optimistic + fire-and-reconcile.** It patches the store with the new `edits` immediately (so `dirty` clears and the user can keep editing or navigate away at once — the live GL preview already shows the final result), fires the POST **without awaiting it**, and on response reconciles the authoritative `edits`/`width`/`height`/`thumbhash`/`updatedAt` (the `updatedAt` bump busts the cached rendition URLs so the grid/lightbox thumbnails refresh). On failure it **rolls the store's `edits` back** so `dirty` returns and the user can retry; a toast reports it. The shared photo store lives above the lightbox, so the reconcile lands even after navigating to another photo.
- **No schema, worker, or activity changes.** No shared-DB migration.

**Future hardening (deferred):** a true `regenerate_renditions` worker job (per-photo
`payload`, latest-wins, surfaced via `useActivity()`) is worthwhile if Lumio ever runs
multiple web replicas or wants regen to survive a mid-request crash. It needs the
additive `Job.payload` migration applied carefully to the shared DB (idempotent
`ADD COLUMN IF NOT EXISTS`, no `migrate dev` reset) and the rendition-versioning race
handled (only the worker bumps `updatedAt`, after the bake lands).

## 10. Testing strategy

- **Pure math (vitest, `@lumio/shared`):** `tone-curve.ts` (identity, monotonicity, endpoint clamping, known control points); `buildToneLut` (neutral = identity LUT; each slider shifts the LUT in the expected direction; composition order); `chromaParams`/`vignetteParams` (neutral = null, extremes); `applyColorToRaw` (golden pixels for representative recipes).
- **Parity test (the linchpin):** a test that runs a fixed recipe through `applyColorToRaw` and asserts the result matches an independent reference evaluation of the same model — guaranteeing the bake equals the documented math. (The GPU path uses the same formulas/LUT; a headless-GL pixel test is optional/stretch.)
- **Bake integration (`@lumio/ingest`):** extend `renditions.test.ts` — new sliders shift pixel stats as expected; 16-bit path produces no regressions; dimensions unchanged for color-only edits.
- **Async save:** unit-test the new job handler (reads edits, regenerates, updates row); route test (persists + enqueues + returns fast, does not block on bake).
- **Manual/browser:** verify each slider live; verify crop mode shows adjustments; verify Save returns instantly and the thumbnail catches up.

## 11. Phasing (independently shippable; see the plan for steps)

1. **Crop-mode fix (CSS interim).** Tiny, immediate, reversible. Ships alone.
2. **Unified color model in shared.** New fields, `tone-curve.ts`, `buildToneLut`/`chromaParams`/`vignetteParams`, `applyColorToRaw`. Pure, TDD. No UI/GPU yet.
3. **Bake rewrite + 16-bit.** `color-bake.ts`, `renditions.ts` consumes the unified model in 16-bit. Tests pin new behavior.
4. **GL preview renderer.** `gl-color.ts` + `<AdjustedImage>`, wired into `BaseImageStage`/`EditedResult` (supersedes Phase 1). CSS fallback retained.
5. **Slider UI + curve editor.** Panel controls for the five scalar sliders; `<CurveEditor>` for curves.
6. **Async save.** Job type + migration + handler + route + client reconciliation.

Phases 2→3 and 4→5 are the WYSIWYG core. Phase 1 and Phase 6 are independent and can land in any order.

## 12. Risks & mitigations

- **Bake-rewrite changes output.** The new raw-buffer color pass won't be byte-identical to today's `sharp` chain. Intended — it's the improvement and the new sliders require it. Tests pin the new behavior; visually reviewed.
- **Raw-buffer color pass cost (full-res).** ~24MP × 3 LUT lookups + per-pixel chroma ≈ a few hundred ms in JS. Acceptable in the *background* job (another reason async save lands with this). Optimize with typed-array loops; revisit WASM/GPU-server only if measured too slow.
- **DB migration on a shared dev DB.** Additive nullable column only; follow the migration recipe; never reset/backfill the shared DB.
- **WebGL2 availability.** CSS-filter fallback preserved; capability-detected at runtime.
- **Scope.** Large. Built and committed phase-by-phase so partial delivery is still shippable and the rest is resumable from the plan.
