# GPU Photo Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A WYSIWYG photo editor — a custom WebGL2 preview and the `sharp` bake driven by one shared color model — with the full Lightroom slider set (adds highlights/shadows/blacks/whites/vibrance/curves), a 16-bit bake, the crop-mode bug fixed, and non-blocking (background-worker) saves.

**Architecture:** All color math lives in `packages/shared/photo-color.ts` as renderer-agnostic builders → a per-channel tone LUT + chroma params + vignette params. The GL preview samples the LUT as a texture and applies chroma/vignette in a fragment shader; the bake applies the *same* LUT + chroma to the raw 16-bit pixel buffer. Identical math ⇒ preview equals save. Saves persist edits + enqueue a `regenerate_renditions` worker job.

**Tech Stack:** TypeScript, React 19 (Next.js), WebGL2, `sharp`/libvips, Prisma + Postgres job queue, `vitest`.

**Spec:** `docs/superpowers/specs/2026-06-24-gpu-photo-editor-design.md`. **P3 follow-up:** `docs/display-p3-color-management.md`.

---

## File structure

```
packages/shared/src/
  tone-curve.ts        NEW  monotone spline → 256/1024-sample transfer (pure)
  tone-curve.test.ts   NEW
  photo-color.ts       MOD  +6 fields in COLOR_FIELDS; buildToneLut, chromaParams, vignetteParams, applyColorToRaw; keep CSS fns for fallback
  photo-color.test.ts  MOD
  types.ts             MOD  PhotoEdits +highlights/shadows/blacks/whites/vibrance/curves; CurveSpec, CurvePoint
  photo-edits.ts       MOD  EDITS_VERSION bump; sameEdits unaffected by absent fields
  api.ts               MOD  zod editPhotoSchema extends with new fields
  jobs.ts              MOD  JobType.regenerate_renditions

packages/ingest/src/
  color-bake.ts        NEW  applyColorToRaw over a raw RGB16 buffer
  color-bake.test.ts   NEW
  renditions.ts        MOD  decode→geometry→resize→raw16→applyColor→encode; replace 3-pass sharp color

apps/web/src/features/photo-editor/
  render/gl-color.ts        NEW  WebGL2 renderer (image + LUT texture + uniforms → quad)
  adjusted-image.tsx        NEW  <AdjustedImage> render seam; CSS fallback
  base-image-stage.tsx      MOD  use <AdjustedImage> instead of <img>
  edited-result.tsx         MOD  drop CSS filter/overlay divs
  lightbox-edit-panel.tsx   MOD  +5 sliders + <CurveEditor>
  curve-editor.tsx          NEW  draggable curve UI
  server/photo-edits-service.ts  MOD  persist + enqueue (async save)

apps/web/src/app/api/c/[catalog]/photos/[id]/edit/route.ts  MOD  fast return
apps/worker/src/handlers.ts                                  MOD  regenerate_renditions handler
packages/db/prisma/schema.prisma                             MOD  Job.payload Json?
```

---

## Phase 1 — Crop-mode shows adjustments (interim CSS fix)

Independent quick win. Superseded by Phase 4 but ships value now and is fully reversible.

### Task 1.1: Apply color in crop mode

**Files:** Modify `apps/web/src/features/photo-editor/zoomable-image.tsx` (the `EditorCanvas` component, ~371-453).

- [ ] **Step 1:** In `EditorCanvas`, import `colorCssFilter, colorOverlays` from `@lumio/shared`. Wrap the `<BaseImageStage>` in a div carrying `style={{ filter: colorCssFilter(working) || undefined }}` and render `colorOverlays(working)` as absolutely-positioned blend-mode divs sized to the O′ stage — mirroring `EditedResult` (edited-result.tsx:85-116) — *beneath* the `<CropOverlay>` (so dim/handles stay on top). Overlays must clip to the stage box, not the viewport.
- [ ] **Step 2:** Manual browser check: open a photo, adjust exposure/temperature/vignette, enter Crop mode → adjustments now visible; crop frame/handles unaffected.
- [ ] **Step 3:** Commit: `fix(editor): show color adjustments in crop mode`.

> No unit test (pure presentational CSS wiring); covered by the manual check and superseded by Phase 4's GL path which is unit-testable.

---

## Phase 2 — Unified color model (pure, TDD)

No UI/GL/bake changes yet — just the shared math everything else consumes.

### Task 2.1: `tone-curve.ts` — monotone spline transfer

**Files:** Create `packages/shared/src/tone-curve.ts`, `packages/shared/src/tone-curve.test.ts`.

- [ ] **Step 1 — failing test:**
```ts
import { describe, it, expect } from "vitest";
import { sampleCurve, type CurvePoint } from "./tone-curve.js";

describe("sampleCurve", () => {
  it("identity when no/❲endpoint❳ points", () => {
    const lut = sampleCurve([], 256);
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[255]).toBeCloseTo(1, 5);
    expect(lut[128]).toBeCloseTo(128 / 255, 2);
  });
  it("passes through control points (monotone)", () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];
    const lut = sampleCurve(pts, 256);
    expect(lut[128]).toBeGreaterThan(0.6);
    // monotone non-decreasing
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6);
  });
  it("clamps output to [0,1]", () => {
    const lut = sampleCurve([{ x: 0, y: 0 }, { x: 0.5, y: 1.5 }, { x: 1, y: 1 }], 256);
    for (const v of lut) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
```
- [ ] **Step 2:** Run `cd packages/shared && pnpm test tone-curve` → FAIL (module missing).
- [ ] **Step 3 — implement:** `CurvePoint = { x: number; y: number }`. `sampleCurve(points, n)` returns `Float32Array(n)`: if `<2` points, identity; else sort by x, ensure endpoints at x=0/x=1 (synthesize from nearest if absent), interpolate with a **monotone cubic (Fritsch–Carlson)** to avoid overshoot, sample at `i/(n-1)`, clamp `[0,1]`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(shared): monotone tone-curve sampler`.

### Task 2.2: `PhotoEdits` new fields + `CurveSpec`

**Files:** Modify `packages/shared/src/types.ts`, `packages/shared/src/photo-edits.ts` (EDITS_VERSION), `packages/shared/src/api.ts` (zod).

- [ ] **Step 1 — test (photo-edits.test.ts):** assert `sameEdits` ignores absent new fields (legacy recipe == same recipe with new fields undefined) and that EDITS_VERSION incremented.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement:** add to `PhotoEdits`: `highlights?, shadows?, blacks?, whites?, vibrance?` (`number`, -100..100) and `curves?: CurveSpec`. Add `CurvePoint` (re-export from tone-curve) and `CurveSpec = { master: CurvePoint[]; r?: CurvePoint[]; g?: CurvePoint[]; b?: CurvePoint[] }`. Bump `EDITS_VERSION`. Extend the zod `editPhotoSchema` in `api.ts` (numbers `.min(-100).max(100).optional()`; curves object of point arrays optional). `sameEdits` already deep-compares — verify new fields included.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(shared): PhotoEdits highlights/shadows/blacks/whites/vibrance/curves`.

### Task 2.3: `buildToneLut` — collapse all tonal sliders into per-channel LUTs

**Files:** Modify `packages/shared/src/photo-color.ts`, `photo-color.test.ts`.

Math (evaluated in sRGB-encoded [0,1], `x` = input level):
- gain `g = 2^(exposure/50) * (1 + brightness/100)`
- contrast about 0.5: `x' = (x - 0.5) * (1 + contrast/100) + 0.5`
- blacks/whites: remap `[blackPt, whitePt] → [0,1]` where `blackPt = -(blacks/100)*0.2` lift, `whitePt = 1 - (whites/100)*0.2 ... ` (tune constants `BLACKS_RANGE`, `WHITES_RANGE`)
- shadows/highlights: additive smooth bumps — `+ (shadows/100)*SH_AMT*smoothstepDown(x) + (highlights/100)*HL_AMT*smoothstepUp(x)` with smooth luminance weights centered low/high
- fade: `+` lifts (`x*(1-k)+k`), `−` deepens (contrast>1) — preserve current FADE constants
- apply `g` and per-channel curve last via `sampleCurve`

- [ ] **Step 1 — tests:** neutral recipe ⇒ LUT ≈ identity (`lut.r[i] ≈ i/255`); `brightness:100` ⇒ doubled (clamped) midtones; `blacks:-100` raises `lut[0]`; `whites:-100` lowers `lut[255]`; `highlights:-100` lowers upper range but leaves `lut[0]` ≈ 0; `shadows:+100` raises lower range but leaves `lut[255]` ≈ 1; a master curve point shifts the LUT accordingly. Use `.toBeCloseTo`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement** `buildToneLut(edits, n = 256): { r: Uint8Array(n); g; b }` (and a `buildToneLutF32` at n=1024 for the 16-bit bake). Compose the transfer above per channel; master applies to all three, then per-channel curves (`edits.curves?.r` etc.). Return `null` when fully neutral (caller treats as identity).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(shared): buildToneLut folds tonal sliders + curves into per-channel LUTs`.

### Task 2.4: `chromaParams` + `vignetteParams`

**Files:** Modify `photo-color.ts`, `photo-color.test.ts`.

- [ ] **Step 1 — tests:** neutral ⇒ `chromaParams` null; `saturation/vibrance/hue/temperature` each surface their normalized value; `vignetteParams` null at 0, `{strength>0}` otherwise.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement:** `chromaParams(edits): { saturation: number; vibrance: number; hue: number; tempR: number; tempB: number } | null` (temperature → per-channel R/B gain, reuse `TEMP_CHANNEL_GAIN`). `vignetteParams(edits): { strength: number } | null` (reuse `vignetteStrength`). Keep `toneLinear`/`modulateParams`/`tempFadeLinear`/`colorCssFilter`/`colorOverlays` for now (fallback + during transition).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(shared): chroma + vignette params`.

### Task 2.5: `applyColorToRaw` — the bake's per-pixel kernel (shared, pure)

**Files:** Modify `photo-color.ts`, `photo-color.test.ts`.

- [ ] **Step 1 — tests:** identity model leaves a buffer unchanged; a tone LUT that inverts maps `0→255`; saturation 0 ⇒ R=G=B (grey) per pixel; vibrance < saturation effect on an already-saturated pixel; deterministic golden values for one mixed recipe.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement** `applyColorToRaw(rgb: Uint8Array|Uint16Array, channels, maxVal, model)` mutating in place: per pixel → tone LUT lookup per channel (interpolated for 16-bit) → chroma (hue rotate + saturation/vibrance in a luma-preserving way + temp R/B gain) → return. Vignette is spatial so it takes `(w,h)` and applies a radial multiplier. Tight typed-array loops.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(shared): applyColorToRaw per-pixel color kernel`.

---

## Phase 3 — Bake rewrite + 16-bit

### Task 3.1: `color-bake.ts` in `@lumio/ingest`

**Files:** Create `packages/ingest/src/color-bake.ts`, `color-bake.test.ts`.

- [ ] **Step 1 — test:** feed a known small `sharp` image (e.g. solid mid-grey raw), apply a recipe, assert output stats shift as expected (e.g. exposure+ raises mean; saturation 0 ⇒ channels equal). Use `sharp().raw().toBuffer({ resolveWithObject: true })`.
- [ ] **Step 2:** Run `cd packages/ingest && pnpm test color-bake` → FAIL.
- [ ] **Step 3 — implement** `applyColor16(img: Sharp, edits): Promise<Sharp>`: short-circuit when `!hasColor`; else `img.toColorspace('rgb16')` (or `.raw({depth:'ushort'})`), pull raw 16-bit buffer + dims, call `applyColorToRaw(buf, 3, 65535, {tone: buildToneLutF32, chroma, vignette})`, rewrap via `sharp(buf, { raw: { width, height, channels: 3, premultiplied: false } })`. Keep alpha handling if present.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(ingest): raw 16-bit color bake from shared model`.

### Task 3.2: Wire into `renditions.ts`, drop the 3-pass sharp color

**Files:** Modify `packages/ingest/src/renditions.ts` (replace `applyColor`), `renditions.test.ts`.

- [ ] **Step 1 — test:** existing renditions tests adjusted to the new color path; add that a color edit changes pixels and a neutral edit doesn't; dimensions unchanged for color-only.
- [ ] **Step 2:** Run → FAIL where behavior changed.
- [ ] **Step 3 — implement:** replace `applyColor` body with a call to `applyColor16`; process in 16-bit through geometry/resize, encode 8-bit at the end (`.jpeg({quality:EDITED_JPEG_QUALITY})` / `.webp({quality:80})`). Remove the vignette SVG composite (now in `applyColorToRaw`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `refactor(ingest): 16-bit unified color bake; remove 3-pass sharp color`.

---

## Phase 4 — GL preview renderer (supersedes Phase 1)

### Task 4.1: `gl-color.ts` WebGL2 renderer

**Files:** Create `apps/web/src/features/photo-editor/render/gl-color.ts`.

- [ ] **Step 1:** Implement a framework-free `GlColor` class: constructor takes a `<canvas>`; `setImage(bitmap)` uploads an `ImageBitmap`/`HTMLImageElement` to a texture; `render(model)` uploads the tone LUT as a 256×1 RGB texture + chroma/vignette uniforms and draws a full-screen quad. Fragment shader: sample image → per-channel LUT lookup (`texture(uLut, vec2(c, 0.5))`) → hue/sat/vibrance → temp R/B gain → radial vignette. Provide `dispose()`.
- [ ] **Step 2:** Add `isWebGL2Available()` helper.
- [ ] **Step 3:** Commit: `feat(editor): WebGL2 color renderer`.

> Shader correctness is verified via the shared math tests (same formulas) + the manual parity check in 4.3. An optional headless-GL pixel test is a stretch goal.

### Task 4.2: `<AdjustedImage>` seam + CSS fallback

**Files:** Create `apps/web/src/features/photo-editor/adjusted-image.tsx`.

- [ ] **Step 1:** `<AdjustedImage src working onNaturalSize className style>` — decode `src` to an `ImageBitmap`, create `GlColor` on a `<canvas>` sized to natural dims, re-`render` on `working` change (memoize the model via `buildToneLut`/`chromaParams`/`vignetteParams`). If `!isWebGL2Available()`, render an `<img>` with `colorCssFilter` + overlay divs (today's behavior) instead.
- [ ] **Step 2:** Commit: `feat(editor): AdjustedImage render seam`.

### Task 4.3: Swap `BaseImageStage` to `<AdjustedImage>`; clean `EditedResult`; revert Phase 1 interim

**Files:** Modify `base-image-stage.tsx`, `edited-result.tsx`, `zoomable-image.tsx`.

- [ ] **Step 1:** `BaseImageStage` renders `<AdjustedImage>` in place of `<img>` (geometry transforms now wrap adjusted pixels). Remove the CSS `filter`/overlay divs from `EditedResult` and the Phase-1 interim wrapping from `EditorCanvas` (color is now in the image layer in both edit and crop modes).
- [ ] **Step 2 — manual parity check:** for several recipes, compare the live preview to the saved/baked result (open `/edited`); they should match. Verify crop mode shows adjustments. Verify zoom→full-res swap still works.
- [ ] **Step 3:** Commit: `feat(editor): GL preview replaces CSS filter; crop mode adjusted via shared seam`.

---

## Phase 5 — Slider UI + curve editor

### Task 5.1: Five scalar sliders

**Files:** Modify `apps/web/src/features/photo-editor/lightbox-edit-panel.tsx`, add entries to `COLOR_FIELDS` (done in 2.2) so the panel auto-renders them if it maps over `COLOR_FIELDS`; otherwise add controls explicitly.

- [ ] **Step 1:** Ensure highlights/shadows/blacks/whites/vibrance render as sliders wired to `setColor`. Group sensibly (Light: exposure/contrast/highlights/shadows/whites/blacks; Color: temperature/tint?/saturation/vibrance/hue; Effects: fade/vignette).
- [ ] **Step 2:** Manual check each slider live.
- [ ] **Step 3:** Commit: `feat(editor): highlights/shadows/blacks/whites/vibrance sliders`.

### Task 5.2: `<CurveEditor>`

**Files:** Create `apps/web/src/features/photo-editor/curve-editor.tsx`; modify the edit panel + `use-edit-session.tsx` (a `setCurve(channel, points)` action pushing history).

- [ ] **Step 1:** Draggable point curve over a 0..1 box (master + R/G/B channel tabs), writing `CurveSpec` into the recipe. Default identity (two endpoints). Add/drag/remove points.
- [ ] **Step 2:** Manual check: dragging the curve updates the live GL preview (LUT rebuild) and bakes identically.
- [ ] **Step 3:** Commit: `feat(editor): tone curve editor`.

---

## Phase 6 — Async (non-blocking) save

> **Implemented as an optimistic, non-blocking client — NOT a worker job.** See spec
> §9 for the rationale (avoids a shared-DB migration, a rendition-versioning race, and
> reconciliation complexity, with the same user-visible result on a single-host deploy).
> Only `use-edit-session.tsx#apply()` changed: it patches the store optimistically,
> fires the POST without awaiting it, reconciles dims/thumbhash/version on response,
> and reverts on failure. The route/worker/schema are untouched. The worker-job design
> below is retained as **deferred future hardening** (multi-replica / crash-survival).

### Task 6.1 (deferred): `Job.payload` migration + `regenerate_renditions` type

**Files:** Modify `packages/db/prisma/schema.prisma`, `packages/shared/src/jobs.ts`; generate migration.

- [ ] **Step 1:** Add `payload Json?` to `Job`. Add `JobType.regenerate_renditions`.
- [ ] **Step 2:** Create migration **additively** (nullable column) following the project DB-migration recipe; **do not** reset the shared dev DB. `pnpm --filter @lumio/db ❲migrate command❳`.
- [ ] **Step 3:** Commit: `feat(jobs): regenerate_renditions job type + Job.payload`.

### Task 6.2: Worker handler

**Files:** Modify `apps/worker/src/handlers.ts`.

- [ ] **Step 1 — test (worker):** handler reads `photo.edits` from DB, calls `regenerateRenditions`, updates `thumbhash`/`width`/`height`/`updatedAt`. Mock deps.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement** `[JobType.regenerate_renditions]` handler: read `payload.photoId`, load photo + catalog, run `regenerateRenditions(originalPath, photo.edits, id, dirs)`, `photo.update` with results (bumps `updatedAt`). `report` progress.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(worker): regenerate_renditions handler`.

### Task 6.3: Route returns fast + enqueues

**Files:** Modify `apps/web/src/features/photo-editor/server/photo-edits-service.ts` and the `/edit` route.

- [ ] **Step 1 — test:** `applyPhotoEdits` persists edits + computed dims, enqueues a job, returns DTO **without** awaiting `regenerateRenditions`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3 — implement:** compute post-edit `width/height` from the recipe using shared geometry (no bake); `photo.update({ edits, width, height })`; `enqueueJob(db, JobType.regenerate_renditions, catalog.id, { photoId: id })`; return DTO. (Extend `enqueueJob` to accept an optional payload; dedup by queued job for same photoId.)
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(editor): async save — persist + enqueue, no inline bake`.

### Task 6.4: Client reconciliation

**Files:** Modify `apps/web/src/features/photo-editor/use-edit-session.tsx`.

- [ ] **Step 1:** `apply()` already patches the store optimistically; ensure it uses returned/computed dims and doesn't depend on a fresh thumbhash. On `useActivity()` reporting the photo's job done (or simply on the next activity tick after save), bump the rendition version so thumbnails refresh. Show a lightweight "saving…/saved" via the existing activity surface.
- [ ] **Step 2:** Manual check: Save returns instantly; live preview unchanged; thumbnail/grid catches up within a second or two.
- [ ] **Step 3:** Commit: `feat(editor): instant save UX with background reconciliation`.

---

## Self-review notes

- **Spec coverage:** §3 crop bug→Phase 1+4.3; §5 unified model→Phase 2; §5e fields→2.2; §6 components→Phase 4/5; §7 16-bit→3.1/3.2; §8 crop→1+4.3; §9 async save→Phase 6; §2 non-goals (P3) → separate doc. All covered.
- **Type consistency:** `CurvePoint`/`CurveSpec` defined in tone-curve.ts/types.ts (2.1/2.2) and consumed in buildToneLut (2.3), CurveEditor (5.2). `buildToneLut`/`chromaParams`/`vignetteParams`/`applyColorToRaw` defined in Phase 2, consumed by Phase 3 (bake) and Phase 4 (GL) with the same signatures. `regenerate_renditions`/`Job.payload` defined 6.1, used 6.2/6.3.
- **Open tuning constants** (`BLACKS_RANGE`, `WHITES_RANGE`, `SH_AMT`, `HL_AMT`, smoothstep centers) are picked during 2.3 and pinned by tests; exact values are a tuning detail, not a blocker.
- **Migration command** and **db migrate script name** to be read from `packages/db/package.json` at execution (left as `❲…❳` deliberately — verify, don't guess).
