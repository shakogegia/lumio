# Photo Crop & Straighten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interactive crop (freeform + aspect-ratio presets) and straighten (free-angle tilt) to Lumio's non-destructive photo editor, sharing the existing rotate/flip recipe, Apply/Reset, and undo/redo.

**Architecture:** Two optional fields (`straighten`, `crop`) are added to the `PhotoEdits` JSON recipe. One `sharp` pipeline (`renditions.ts`) bakes the recipe into display/thumbnail/edited renditions — the single chokepoint already shared by edit-apply, downloads, and worker re-ingest. The lightbox Edit tab previews live in the browser against a new **edit-free base image** (so an already-saved crop can be expanded back out), applying the full working recipe via CSS plus an interactive crop overlay. Geometry is "Model X": the crop is normalized to the straightened bounding box O′ and clamped to real pixels, so the live preview is pixel-identical to the server bake.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), `sharp` (image bake), Next.js App Router (web), React + Radix/shadcn UI, Vitest (tests), Prisma/Postgres (recipe stored in the existing `Photo.edits Json?` column — **no migration**).

**Reference spec:** `docs/superpowers/specs/2026-06-21-photo-crop-straighten-design.md`

**Geometry glossary (used throughout):**
- **B** — edit-free base image (EXIF-oriented original, no user edits).
- **O** — oriented image after flip + coarse rotate; dims `(Wo, Ho)`.
- **θ** — straighten angle in degrees.
- **O′** — axis-aligned bounding box of O rotated by θ; dims `W′ = Wo·|cosθ| + Ho·|sinθ|`, `H′ = Wo·|sinθ| + Ho·|cosθ|`. When θ=0, O′=O.
- **crop** — `{x,y,w,h}` normalized to O′ (each 0..1). When θ=0 it's just "fraction of the oriented image".

**Test commands** (run from repo root):
- Shared: `pnpm --filter @lumio/shared test` · typecheck `pnpm --filter @lumio/shared typecheck`
- Ingest: `pnpm --filter @lumio/ingest test` · typecheck `pnpm --filter @lumio/ingest typecheck`
- Web: `pnpm --filter @lumio/web test` · lint `pnpm --filter @lumio/web lint`

---

## Phase 1 — Recipe model + bake (backend, headless-verifiable)

### Task 1: Extend the recipe type & validation schema

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/src/api.test.ts` (existing)

- [ ] **Step 1: Add the `CropRect` type and the two optional recipe fields**

In `packages/shared/src/types.ts`, replace the `PhotoEdits` interface (currently lines 4–10) with:

```ts
/** A crop rectangle, normalized 0..1 against the straightened bounding box O′
 *  (see the crop-geometry module). When straighten is 0, O′ === the oriented
 *  image, so this is simply a fraction of the oriented image. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Non-destructive edit recipe applied on top of EXIF auto-orientation.
 *  Canonical order: flipH → flipV → coarse rotate → straighten(θ) → crop. */
export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Fine tilt in degrees, clamped to [-45, 45]. Absent/0 = no straighten. */
  straighten?: number;
  /** Crop rectangle normalized to O′. Absent/null = full frame. */
  crop?: CropRect | null;
}
```

- [ ] **Step 2: Extend the zod schema**

In `packages/shared/src/api.ts`, replace `photoEditsSchema` (currently lines 63–67) with:

```ts
export const cropRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type CropRectInput = z.infer<typeof cropRectSchema>;

/** Edit recipe payload. Used by POST /api/photos/[id]/edit (null = reset). */
export const photoEditsSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  straighten: z.number().min(-45).max(45).optional(),
  crop: cropRectSchema.nullable().optional(),
});
```

- [ ] **Step 3: Write failing tests for the schema**

Append to `packages/shared/src/api.test.ts` (inside the existing top-level `describe`, or add a new one — match the file's existing import of `photoEditsSchema`/`editPhotoSchema`; add `cropRectSchema` to the import if asserting on it):

```ts
describe("photoEditsSchema (crop & straighten)", () => {
  const base = { rotate: 0, flipH: false, flipV: false } as const;

  it("accepts a recipe without the new fields (backward compatible)", () => {
    expect(photoEditsSchema.safeParse(base).success).toBe(true);
  });

  it("accepts straighten in range and crop in [0,1]", () => {
    expect(
      photoEditsSchema.safeParse({ ...base, straighten: 12, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.7 } }).success,
    ).toBe(true);
    expect(photoEditsSchema.safeParse({ ...base, crop: null }).success).toBe(true);
  });

  it("rejects out-of-range straighten and out-of-[0,1] crop", () => {
    expect(photoEditsSchema.safeParse({ ...base, straighten: 60 }).success).toBe(false);
    expect(photoEditsSchema.safeParse({ ...base, crop: { x: -0.1, y: 0, w: 1, h: 1 } }).success).toBe(false);
  });
});
```

(If `packages/shared/src/api.test.ts` does not exist, create it with `import { describe, expect, it } from "vitest";` and `import { photoEditsSchema } from "./api.js";`.)

- [ ] **Step 4: Run tests — they should pass (schema already written in Steps 1–2)**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (all api tests green). Then `pnpm --filter @lumio/shared typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/api.ts packages/shared/src/api.test.ts
git commit -m "feat(shared): add straighten & crop fields to PhotoEdits recipe"
```

---

### Task 2: Pure crop geometry helpers

**Files:**
- Create: `packages/shared/src/crop-geometry.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Test: `packages/shared/src/crop-geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/crop-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  straightenedSize,
  pointOnImage,
  clampCropToImage,
  centeredAspectCrop,
} from "./crop-geometry.js";

describe("crop-geometry", () => {
  it("straightenedSize is identity at 0° and grows the bbox at an angle", () => {
    expect(straightenedSize(400, 200, 0)).toEqual({ w: 400, h: 200 });
    const r = straightenedSize(400, 200, 90);
    expect(r.w).toBeCloseTo(200, 4);
    expect(r.h).toBeCloseTo(400, 4);
    const t = straightenedSize(100, 100, 45);
    expect(t.w).toBeCloseTo(Math.SQRT2 * 100, 3);
  });

  it("pointOnImage: center is always on, far corner of O′ is off when tilted", () => {
    expect(pointOnImage(0.5, 0.5, 400, 200, 30)).toBe(true);
    // top-left corner of the O′ bbox is an empty straighten triangle
    expect(pointOnImage(0, 0, 400, 200, 30)).toBe(false);
  });

  it("clampCropToImage leaves an in-bounds crop unchanged at 0°", () => {
    const c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    expect(clampCropToImage(c, 400, 200, 0)).toEqual(c);
  });

  it("clampCropToImage shrinks a full crop when tilted (corners would be empty)", () => {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    const out = clampCropToImage(full, 400, 200, 20);
    expect(out.w).toBeLessThan(1);
    expect(out.h).toBeLessThan(1);
    // still centered
    expect(out.x + out.w / 2).toBeCloseTo(0.5, 3);
    expect(out.y + out.h / 2).toBeCloseTo(0.5, 3);
  });

  it("centeredAspectCrop produces a centered rect of the requested aspect", () => {
    // 1:1 inside a 400x200 image at 0° → square of side 200, centered.
    const c = centeredAspectCrop(1, 400, 200, 0);
    expect(c.w * 400).toBeCloseTo(200, 2);
    expect(c.h * 200).toBeCloseTo(200, 2);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 4);
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/shared test crop-geometry`
Expected: FAIL ("Cannot find module './crop-geometry.js'").

- [ ] **Step 3: Implement the geometry module**

Create `packages/shared/src/crop-geometry.ts`:

```ts
import type { CropRect } from "./types.js";

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Bounding-box (O′) size of an Wo×Ho rectangle rotated by `deg`. */
export function straightenedSize(wo: number, ho: number, deg: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { w: wo * c + ho * s, h: wo * s + ho * c };
}

/** True when a normalized O′ point (px,py)∈[0,1]² lands on real pixels — i.e.
 *  inside the rotated Wo×Ho rectangle centered in O′ — not an empty corner. */
export function pointOnImage(px: number, py: number, wo: number, ho: number, deg: number): boolean {
  const { w, h } = straightenedSize(wo, ho, deg);
  const a = rad(-deg);
  const dx = px * w - w / 2;
  const dy = py * h - h / 2;
  const x = dx * Math.cos(a) - dy * Math.sin(a);
  const y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= wo / 2 + 1e-6 && Math.abs(y) <= ho / 2 + 1e-6;
}

/** Shrink `crop` about its own center (preserving aspect) until all four corners
 *  lie on real pixels. Returns the input unchanged when already valid. */
export function clampCropToImage(crop: CropRect, wo: number, ho: number, deg: number): CropRect {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  const ok = (s: number): boolean => {
    const hw = (crop.w * s) / 2;
    const hh = (crop.h * s) / 2;
    return (
      pointOnImage(cx - hw, cy - hh, wo, ho, deg) &&
      pointOnImage(cx + hw, cy - hh, wo, ho, deg) &&
      pointOnImage(cx - hw, cy + hh, wo, ho, deg) &&
      pointOnImage(cx + hw, cy + hh, wo, ho, deg)
    );
  };
  if (ok(1)) return crop;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return { x: cx - (crop.w * lo) / 2, y: cy - (crop.h * lo) / 2, w: crop.w * lo, h: crop.h * lo };
}

/** A centered, max-fit crop of aspect `ratio` (w/h) within the oriented image,
 *  normalized to O′ and clamped to real pixels. */
export function centeredAspectCrop(ratio: number, wo: number, ho: number, deg: number): CropRect {
  const { w, h } = straightenedSize(wo, ho, deg);
  let cw = wo;
  let ch = wo / ratio;
  if (ch > ho) {
    ch = ho;
    cw = ho * ratio;
  }
  const rect: CropRect = {
    x: (w - cw) / 2 / w,
    y: (h - ch) / 2 / h,
    w: cw / w,
    h: ch / h,
  };
  return clampCropToImage(rect, wo, ho, deg);
}

/** Pixel extract rect (for sharp) given a crop normalized to a W×H canvas.
 *  Clamps defensively so it can never request pixels outside the canvas. */
export function cropToExtract(
  crop: CropRect,
  canvasW: number,
  canvasH: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(Math.max(0, Math.round(crop.x * canvasW)), canvasW - 1);
  const top = Math.min(Math.max(0, Math.round(crop.y * canvasH)), canvasH - 1);
  const width = Math.max(1, Math.min(Math.round(crop.w * canvasW), canvasW - left));
  const height = Math.max(1, Math.min(Math.round(crop.h * canvasH), canvasH - top));
  return { left, top, width, height };
}
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add after the `photo-edits.js` line:

```ts
export * from "./crop-geometry.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @lumio/shared test crop-geometry`
Expected: PASS. Then `pnpm --filter @lumio/shared typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/crop-geometry.ts packages/shared/src/crop-geometry.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): pure crop/straighten geometry helpers"
```

---

### Task 3: Extend the recipe helpers (`photo-edits.ts`)

**Files:**
- Modify: `packages/shared/src/photo-edits.ts`
- Test: `packages/shared/src/photo-edits.test.ts`

- [ ] **Step 1: Write failing tests for the extended helpers**

Append to `packages/shared/src/photo-edits.test.ts` (extend the existing import from `./photo-edits.js` to also bring in `sameEdits`, `setStraighten`, `setCrop`, `aspectCrop`):

```ts
describe("photo-edits crop & straighten", () => {
  const base = { rotate: 0, flipH: false, flipV: false } as const;

  it("NO_EDITS includes straighten 0 and crop null", () => {
    expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null });
  });

  it("hasEdits is true when only straighten or only crop is set", () => {
    expect(hasEdits({ ...base, straighten: 5 })).toBe(true);
    expect(hasEdits({ ...base, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe(true);
    expect(hasEdits({ ...base, straighten: 0, crop: null })).toBe(false);
  });

  it("setStraighten clamps to [-45, 45]", () => {
    expect(setStraighten(base, 90).straighten).toBe(45);
    expect(setStraighten(base, -90).straighten).toBe(-45);
    expect(setStraighten(base, 12).straighten).toBe(12);
  });

  it("setCrop sets and clears", () => {
    const c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    expect(setCrop(base, c).crop).toEqual(c);
    expect(setCrop({ ...base, crop: c }, null).crop).toBeNull();
  });

  it("sameEdits accounts for straighten and crop", () => {
    expect(sameEdits({ ...base, straighten: 5 }, { ...base, straighten: 5 })).toBe(true);
    expect(sameEdits({ ...base, straighten: 5 }, { ...base, straighten: 6 })).toBe(false);
    expect(sameEdits({ ...base, crop: { x: 0, y: 0, w: 1, h: 1 } }, base)).toBe(false);
  });

  it("aspectCrop('original', …) selects the full oriented frame at 0°", () => {
    const out = aspectCrop(base, "original", 400, 200);
    expect(out.crop?.w).toBeCloseTo(1, 3);
    expect(out.crop?.h).toBeCloseTo(1, 3);
  });

  it("coercePhotoEdits reads new fields and rejects malformed ones", () => {
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, straighten: 9 })?.straighten).toBe(9);
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, straighten: 999 })?.straighten).toBe(0);
    expect(
      coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, crop: { x: 2, y: 0, w: 1, h: 1 } })?.crop,
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/shared test photo-edits`
Expected: FAIL (NO_EDITS shape mismatch; `setStraighten`/`setCrop`/`aspectCrop`/`sameEdits` undefined).

- [ ] **Step 3: Implement the extended helpers**

In `packages/shared/src/photo-edits.ts`:

3a. Update imports at the top to pull the geometry + types:

```ts
import type { CropRect, PhotoEdits } from "./types.js";
import { centeredAspectCrop, straightenedSize } from "./crop-geometry.js";
```

3b. Replace `NO_EDITS` (line 3) and `hasEdits` (lines 6–8):

```ts
export const NO_EDITS: PhotoEdits = { rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null };

/** True when the recipe changes the image (non-null and not the identity). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return (
    e !== null &&
    (e.rotate !== 0 || e.flipH || e.flipV || (e.straighten ?? 0) !== 0 || e.crop != null)
  );
}
```

3c. Replace `sameEdits` (lines 11–13):

```ts
function sameCrop(a: CropRect | null | undefined, b: CropRect | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Structural equality of two recipes. */
export function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return (
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    (a.straighten ?? 0) === (b.straighten ?? 0) &&
    sameCrop(a.crop, b.crop)
  );
}
```

3d. Add the new mutators (place after `toggleFlipV`):

```ts
export function setStraighten(e: PhotoEdits, deg: number): PhotoEdits {
  return { ...e, straighten: Math.max(-45, Math.min(45, deg)) };
}

export function setCrop(e: PhotoEdits, crop: CropRect | null): PhotoEdits {
  return { ...e, crop };
}

/** Aspect-ratio preset names used by the Crop chips. */
export type AspectPreset =
  | "free"
  | "original"
  | "square"
  | "5:4" | "4:5" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16";

const RATIO: Record<Exclude<AspectPreset, "free" | "original">, number> = {
  square: 1,
  "5:4": 5 / 4, "4:5": 4 / 5, "4:3": 4 / 3, "3:4": 3 / 4,
  "3:2": 3 / 2, "2:3": 2 / 3, "16:9": 16 / 9, "9:16": 9 / 16,
};

/** Apply an aspect preset: returns the recipe with a centered max-fit crop at the
 *  requested ratio (computed against the oriented dims wo×ho). "free" clears any
 *  crop (unconstrained); "original" uses wo:ho. */
export function aspectCrop(e: PhotoEdits, preset: AspectPreset, wo: number, ho: number): PhotoEdits {
  if (preset === "free") return { ...e, crop: null };
  const deg = e.straighten ?? 0;
  const ratio = preset === "original" ? wo / ho : RATIO[preset];
  return { ...e, crop: centeredAspectCrop(ratio, wo, ho, deg) };
}
```

3e. Update `coercePhotoEdits` (lines 49–55) to read the new fields:

```ts
export function coercePhotoEdits(value: unknown): PhotoEdits | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (![0, 90, 180, 270].includes(e.rotate as number)) return null;
  if (typeof e.flipH !== "boolean" || typeof e.flipV !== "boolean") return null;
  const straighten =
    typeof e.straighten === "number" && Number.isFinite(e.straighten) && Math.abs(e.straighten) <= 45
      ? e.straighten
      : 0;
  const crop = coerceCrop(e.crop);
  return { rotate: e.rotate as PhotoEdits["rotate"], flipH: e.flipH, flipV: e.flipV, straighten, crop };
}

function coerceCrop(value: unknown): CropRect | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const nums = [c.x, c.y, c.w, c.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  if ((c.w as number) <= 0 || (c.h as number) <= 0) return null;
  return { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
}
```

3f. Update `orientedSize` (lines 43–45) to account for crop + straighten when predicting post-edit dimensions (used for optimistic grid-tile layout):

```ts
/** Predicted [width, height] after the recipe, for optimistic store patching. */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  if (!e) return [w, h];
  let [ow, oh] = e.rotate === 90 || e.rotate === 270 ? [h, w] : [w, h];
  if ((e.straighten ?? 0) !== 0) {
    const s = straightenedSize(ow, oh, e.straighten ?? 0);
    ow = s.w;
    oh = s.h;
  }
  if (e.crop) {
    ow = Math.max(1, Math.round(ow * e.crop.w));
    oh = Math.max(1, Math.round(oh * e.crop.h));
  }
  return [Math.round(ow), Math.round(oh)];
}
```

(Note: the existing `previewTransform`/D4 helpers below are left untouched — they are no longer exercised by the editor once the edit-base canvas lands, but removing them is out of scope.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/shared test photo-edits`
Expected: PASS (new block + the existing tests still green; the existing `orientedSize`/`NO_EDITS` tests use object equality — confirm the existing `NO_EDITS` test was updated only if it asserted the old 3-field shape; if the existing test `NO_EDITS is the identity recipe` fails, update it to the 5-field object). Then `pnpm --filter @lumio/shared typecheck`.

- [ ] **Step 5: Fix the one pre-existing test that asserts the old NO_EDITS shape**

In `packages/shared/src/photo-edits.test.ts`, update the existing assertion:

```ts
expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null });
```

Re-run: `pnpm --filter @lumio/shared test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/photo-edits.ts packages/shared/src/photo-edits.test.ts
git commit -m "feat(shared): recipe helpers for crop & straighten (setCrop/aspectCrop/setStraighten)"
```

---

### Task 4: Bake crop & straighten in the rendition pipeline

**Files:**
- Modify: `packages/ingest/src/renditions.ts`
- Test: `packages/ingest/src/renditions.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/ingest/src/renditions.test.ts`:

```ts
describe("buildRenditions crop & straighten", () => {
  it("crops to the requested fraction (dimensions follow the crop)", async () => {
    // 100x100 → crop the centered left-half-ish 50x50.
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false, straighten: 0,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    });
    expect(r.width).toBe(50);
    expect(r.height).toBe(50);
  });

  it("straighten with no explicit crop auto-fills (no empty corners)", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false, straighten: 45, crop: null,
    });
    // A 100x100 rotated 45° auto-crops to its inscribed 1:1 rect (side ≈ 100/√2 ≈ 71),
    // NOT the 141x141 bounding box — straightening never leaves empty corners.
    expect(r.width).toBeLessThan(100);
    expect(r.width).toBeGreaterThan(55);
    expect(Math.abs(r.width - r.height)).toBeLessThanOrEqual(2); // stays square
  });

  it("no-edits path is unchanged", async () => {
    const img = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, null);
    expect([r.width, r.height]).toEqual([4, 2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lumio/ingest test renditions`
Expected: FAIL (crop test: width 100 not 50; straighten test: width 100 not >135).

- [ ] **Step 3: Implement the bake**

In `packages/ingest/src/renditions.ts`:

3a. Extend the imports (line 3):

```ts
import {
  hasEdits,
  cropToExtract,
  centeredAspectCrop,
  straightenedSize,
  type PhotoEdits,
} from "@lumio/shared";
```

3b. Add a helper that applies straighten + crop. Place it right after `applyEdits` (after line 27). It materializes the rotated buffer so the extract uses sharp's *actual* rotated dimensions (avoids off-by-one `bad extract area` errors):

```ts
/** Apply straighten (free-angle rotate, transparent background) then crop. Takes
 *  a sharp pipeline that has ALREADY had flip + coarse-rotate applied, plus the
 *  oriented dims (wo,ho) of that pipeline. When straighten is set but no explicit
 *  crop, auto-inscribes the largest centered crop of the oriented aspect so the
 *  output never contains empty corners. Returns a fresh sharp instance; no-op
 *  (returns `img`) when neither straighten nor crop is set. */
export async function applyStraightenCrop(
  img: Sharp,
  edits: PhotoEdits | null,
  wo: number,
  ho: number,
): Promise<Sharp> {
  const deg = edits?.straighten ?? 0;
  let crop = edits?.crop ?? null;
  if (deg === 0 && !crop) return img;
  let pipe = img;
  if (deg !== 0) {
    pipe = pipe.rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    if (!crop) crop = centeredAspectCrop(wo / ho, wo, ho, deg); // auto-fill, no empty corners
  }
  if (!crop) return pipe;
  // Materialize to read the true post-rotate canvas size, then extract by fraction.
  const buf = await pipe.png().toBuffer();
  const meta = await sharp(buf).metadata();
  const ex = cropToExtract(crop, meta.width ?? 0, meta.height ?? 0);
  return sharp(buf).extract(ex);
}
```

3c. In `encodeEditedJpeg` (currently lines 38–41), thread the new step. Replace the body:

```ts
export async function encodeEditedJpeg(
  input: RenditionInput,
  edits: PhotoEdits | null,
): Promise<Buffer> {
  const oriented = await sharp(input).rotate().toBuffer();
  const m = await sharp(oriented).metadata();
  const swap = edits?.rotate === 90 || edits?.rotate === 270;
  const wo = (swap ? m.height : m.width) ?? 0;
  const ho = (swap ? m.width : m.height) ?? 0;
  const baked = await applyStraightenCrop(applyEdits(sharp(oriented), edits), edits, wo, ho);
  return baked.jpeg({ quality: EDITED_JPEG_QUALITY }).toBuffer();
}
```

3d. In `buildRenditions` (lines ~50–90), apply the new step in the geometry path and derive dimensions from the actually-baked display buffer. Replace the function body with:

```ts
export async function buildRenditions(
  input: RenditionInput,
  edits: PhotoEdits | null,
): Promise<Renditions> {
  const geom = hasEdits(edits);

  let source: RenditionInput = input;
  if (geom) {
    source = await sharp(input).rotate().toBuffer(); // EXIF orientation baked in
  }

  // Oriented dims (post flip + coarse-rotate). `source` is the EXIF-baked buffer,
  // so its metadata gives EXIF-oriented dims; the coarse rotate swaps on 90/270.
  let wo = 0;
  let ho = 0;
  if (geom) {
    const sm = await sharp(source).metadata();
    const swap = edits!.rotate === 90 || edits!.rotate === 270;
    wo = (swap ? sm.height : sm.width) ?? 0;
    ho = (swap ? sm.width : sm.height) ?? 0;
  }

  const start = () => (geom ? sharp(source) : sharp(source).rotate());
  const baked = await applyStraightenCrop(applyEdits(start(), edits), edits, wo, ho);
  const display = await baked
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbnail = await sharp(display)
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbhash = await computeThumbhash(thumbnail);

  // Dimensions: derive analytically from the geometry (matches the bake's
  // straighten + auto-fill/crop), avoiding a second bake. A ±1px rounding vs the
  // actual rendition is harmless (used for layout/optimistic patch only).
  let width: number;
  let height: number;
  if (geom) {
    const deg = edits!.straighten ?? 0;
    const op = straightenedSize(wo, ho, deg);
    const crop = edits!.crop ?? (deg !== 0 ? centeredAspectCrop(wo / ho, wo, ho, deg) : null);
    width = crop ? Math.max(1, Math.round(crop.w * op.w)) : Math.round(op.w);
    height = crop ? Math.max(1, Math.round(crop.h * op.h)) : Math.round(op.h);
  } else {
    const meta = await sharp(source).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  }

  return { display, thumbnail, thumbhash, width, height };
}
```

(`applyEdits` already handles flip + coarse-rotate; the old rotate-90/270 dimension swap is now subsumed by reading the baked metadata in the geometry path.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/ingest test renditions`
Expected: PASS (including the pre-existing rotate-90/180 dimension tests). Then `pnpm --filter @lumio/ingest typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts
git commit -m "feat(ingest): bake straighten & crop into renditions and edited JPEG"
```

---

### Task 5: Edit-free base image endpoint

**Files:**
- Modify: `packages/ingest/src/renditions.ts` (add `buildEditBase`)
- Test: `packages/ingest/src/renditions.test.ts`
- Create: `apps/web/src/app/api/photos/[id]/edit-base/route.ts`

- [ ] **Step 1: Write a failing test for `buildEditBase`**

Append to `packages/ingest/src/renditions.test.ts`:

```ts
describe("buildEditBase", () => {
  it("returns an EXIF-oriented, edit-free WebP at the natural aspect", async () => {
    const img = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 5, g: 6, b: 7 } },
    }).png().toBuffer();
    const out = await buildEditBase(img);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect((meta.width ?? 0) / (meta.height ?? 1)).toBeCloseTo(2, 2);
  });
});
```

Add `buildEditBase` to the import at the top of the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @lumio/ingest test renditions`
Expected: FAIL (`buildEditBase` is not exported).

- [ ] **Step 3: Implement `buildEditBase`**

Append to `packages/ingest/src/renditions.ts`:

```ts
/** Display-resolution, EXIF-oriented, EDIT-FREE WebP — the canvas the editor draws
 *  on so a saved crop can be expanded back out. Mirrors the no-edit display path. */
export async function buildEditBase(input: RenditionInput): Promise<Buffer> {
  return sharp(input).rotate().resize(DISPLAY_MAX, DISPLAY_MAX, FIT).webp({ quality: 80 }).toBuffer();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @lumio/ingest test renditions`
Expected: PASS. Then `pnpm --filter @lumio/ingest typecheck`.

- [ ] **Step 5: Create the route**

Create `apps/web/src/app/api/photos/[id]/edit-base/route.ts` (modeled on the `edited` route, which decodes via `decodeToSharpInput`):

```ts
import { NextResponse } from "next/server";
import { decodeToSharpInput, buildEditBase } from "@lumio/ingest";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const decoded = await decodeToSharpInput(originalPath(photo.path));
    try {
      const webp = await buildEditBase(decoded.input);
      return new NextResponse(new Uint8Array(webp), {
        headers: {
          "Content-Type": "image/webp",
          // The edit-free base never changes for a given original.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Original not found" }, { status: 404 });
    } finally {
      await decoded.cleanup();
    }
  },
);
```

- [ ] **Step 6: Verify it builds & serves**

Run: `pnpm --filter @lumio/web lint` (no errors in the new route). Then, with the dev server running (`pnpm dev`), open `http://localhost:3000/api/photos/<some-id>/edit-base` while authenticated → a WebP image renders. (Pick an id from the grid.)

- [ ] **Step 7: Commit**

```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts "apps/web/src/app/api/photos/[id]/edit-base/route.ts"
git commit -m "feat: edit-free base image endpoint for the crop editor"
```

**Phase 1 checkpoint:** the recipe, bake, and base endpoint are complete. Crop/straighten can already be applied via a direct POST to `/api/photos/[id]/edit` and the result is correct everywhere (grid, lightbox, downloads, re-ingest). The remaining phases add the editor UI.

---

## Phase 2 — Edit session wiring + panel controls

### Task 6: Extend the edit session (editing flag, base size, new setters)

**Files:**
- Modify: `apps/web/src/components/photo-grid/use-edit-session.tsx`

- [ ] **Step 1: Add the new context fields**

In `apps/web/src/components/photo-grid/use-edit-session.tsx`, extend `EditSessionValue` (the interface at lines 19–39) with:

```ts
  /** True while the Edit tab is mounted/active (drives the editor canvas). */
  editing: boolean;
  setEditing: (on: boolean) => void;
  /** Natural size of the loaded edit-base image (EXIF-oriented), or null. */
  baseSize: { w: number; h: number } | null;
  setBaseSize: (size: { w: number; h: number }) => void;
  /** Oriented dims (base size with the working coarse-rotate applied). */
  orientedBase: { w: number; h: number } | null;
  setStraighten: (deg: number) => void;
  setCrop: (crop: CropRect | null) => void;
  setAspect: (preset: AspectPreset) => void;
```

- [ ] **Step 2: Import the new helpers/types**

Extend the `@lumio/shared` import (lines 5–15) to add:

```ts
  setStraighten as recipeSetStraighten,
  setCrop as recipeSetCrop,
  aspectCrop as recipeAspectCrop,
  clampCropToImage,
  type AspectPreset,
  type CropRect,
```

- [ ] **Step 3: Implement state + setters in the provider**

Inside `EditSessionProvider`, after the existing `const [applying, setApplying] = useState(false);` (line 86), add:

```ts
  const [editing, setEditing] = useState(false);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
```

After the existing `flipV` callback (line 117), add the new mutators (all push to history like the others):

```ts
  const setStraighten = useCallback(
    (deg: number) => {
      setHistory((h) => {
        const cur = h.stack[h.index];
        let next = recipeSetStraighten(cur, deg);
        // Re-clamp an EXPLICIT crop so the new angle can't expose empty corners.
        // (A null crop is auto-filled by the bake/preview, so leave it null.)
        if (next.crop && baseSize) {
          const ob =
            cur.rotate === 90 || cur.rotate === 270
              ? { w: baseSize.h, h: baseSize.w }
              : { w: baseSize.w, h: baseSize.h };
          next = recipeSetCrop(next, clampCropToImage(next.crop, ob.w, ob.h, deg));
        }
        return pushHistory(h, next);
      });
    },
    [baseSize],
  );
  const setCrop = useCallback((crop: CropRect | null) => {
    setHistory((h) => pushHistory(h, recipeSetCrop(h.stack[h.index], crop)));
  }, []);
```

After `working` is defined (line 89), derive the oriented base size (base size with the working coarse-rotate applied — straighten/crop don't change which dims the *aspect chips* fit against):

```ts
  const orientedBase =
    baseSize === null
      ? null
      : working.rotate === 90 || working.rotate === 270
        ? { w: baseSize.h, h: baseSize.w }
        : { w: baseSize.w, h: baseSize.h };
```

Add `setAspect` after `setCrop` (uses the oriented base; no-op until the base loads):

```ts
  const setAspect = useCallback(
    (preset: AspectPreset) => {
      setHistory((h) => {
        const cur = h.stack[h.index];
        const ob =
          cur.rotate === 90 || cur.rotate === 270
            ? { w: baseSize?.h ?? 0, h: baseSize?.w ?? 0 }
            : { w: baseSize?.w ?? 0, h: baseSize?.h ?? 0 };
        if (preset !== "free" && (ob.w === 0 || ob.h === 0)) return h; // base not loaded yet
        return pushHistory(h, recipeAspectCrop(cur, preset, ob.w, ob.h));
      });
    },
    [baseSize],
  );
```

- [ ] **Step 4: Reset `editing` when navigating photos**

In the photo-change effect (lines 96–102), also clear editing-only state so a fresh photo starts clean. Update the `reseed` branch:

```ts
    if (photoIdRef.current !== photo.id) {
      photoIdRef.current = photo.id;
      reseed(photo.edits ?? NO_EDITS);
      setBaseSize(null);
    }
```

- [ ] **Step 5: Expose the new values**

Add to the `value` object (lines 182–198): `editing, setEditing, baseSize, setBaseSize, orientedBase, setStraighten, setCrop, setAspect`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @lumio/web lint` and ensure the file compiles (no TS errors). Expected: clean. (No unit test — covered by browser-verify in later tasks; the React-Compiler rules apply: `setBaseSize` is called from an effect via the existing `reseed`-style indirection, which is already the file's pattern.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/photo-grid/use-edit-session.tsx
git commit -m "feat(web): edit session — editing flag, base size, crop/straighten setters"
```

---

### Task 7: Straighten slider + aspect chips in the Edit panel

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`

- [ ] **Step 1: Mark the panel as the "editing" signal**

In `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`, pull `setEditing` from the session and toggle it on mount/unmount (Radix unmounts inactive tab content, so this exactly tracks "Edit tab active"). Add near the top of `LightboxEditPanel`, after the `useEditSession()` destructure:

```ts
  const { setEditing } = useEditSession();
  useEffect(() => {
    setEditing(true);
    return () => setEditing(false);
  }, [setEditing]);
```

Add `useEffect` to the React import.

- [ ] **Step 2: Add the Straighten section**

Extend the `useEditSession()` destructure to include `working`, `setStraighten`, `setAspect`. Import the slider:

```ts
import { Slider } from "@/components/ui/slider";
```

Insert this block between the `Transform` section and the Undo/Redo footer (after the closing `</div>` of the Transform grid, ~line 86):

```tsx
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-medium">Straighten</p>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setStraighten(0)}
          >
            {(working.straighten ?? 0).toFixed(0)}°
          </button>
        </div>
        <Slider
          min={-45}
          max={45}
          step={1}
          value={[working.straighten ?? 0]}
          onValueChange={(v) => setStraighten(v[0])}
        />
      </div>
```

- [ ] **Step 3: Add the Crop (aspect-ratio) section**

Add an aspect-preset list constant near the top of the file (after imports):

```ts
import type { AspectPreset } from "@lumio/shared";

const ASPECTS: { preset: AspectPreset; label: string }[] = [
  { preset: "free", label: "Free" },
  { preset: "original", label: "Original" },
  { preset: "square", label: "Square" },
  { preset: "5:4", label: "5:4" }, { preset: "4:5", label: "4:5" },
  { preset: "4:3", label: "4:3" }, { preset: "3:4", label: "3:4" },
  { preset: "3:2", label: "3:2" }, { preset: "2:3", label: "2:3" },
  { preset: "16:9", label: "16:9" }, { preset: "9:16", label: "9:16" },
];
```

Insert this block just below the Straighten section:

```tsx
      <div className="space-y-2">
        <p className="font-medium">Crop</p>
        <div className="flex flex-wrap gap-1.5">
          {ASPECTS.map(({ preset, label }) => {
            const active = preset === "free" ? working.crop == null : false;
            return (
              <Button
                key={preset}
                variant={active ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setAspect(preset)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>
```

(Active-state highlighting beyond "Free" is intentionally minimal — exact-ratio match highlighting is a nicety, not required.)

- [ ] **Step 4: Browser-verify (crop/straighten via controls, before the live overlay exists)**

Run `pnpm dev`. Open a photo → Edit tab. The slider and chips appear. Pick **Square**, then **Apply**. Expected: after Apply, the grid tile + lightbox show the centered square crop (the bake from Phase 1 runs). Slide Straighten to ~10°, Apply → the photo is tilted/cropped. Re-open Edit, pick **Free** → crop cleared, Apply → back to full. (The live in-canvas preview comes in Phase 3 — at this point the preview still shows the baked rendition, but Apply produces the correct result.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-edit-panel.tsx
git commit -m "feat(web): straighten slider & crop aspect chips in the Edit panel"
```

---

## Phase 3 — Live editor canvas + interactive crop overlay

### Task 8: Edit-base canvas with the full working-recipe live preview

**Files:**
- Modify: `apps/web/src/components/photo-grid/zoomable-image.tsx`

- [ ] **Step 1: Read the editing state and base image**

In `apps/web/src/components/photo-grid/zoomable-image.tsx`, extend the `useEditSession()` destructure (line 33) to also pull `editing` and `setBaseSize`:

```ts
  const { working, editing, setBaseSize } = useEditSession();
```

- [ ] **Step 2: Render the edit-base canvas when editing**

When `editing` is true, render a dedicated editor view instead of the normal zoom/pan image. Add this near the top of the returned JSX — early-return an editor branch before the existing viewport markup. Insert after the `LightboxHeader` usage is set up; the simplest structure is a conditional block inside the returned fragment:

```tsx
  const editBaseSrc = `/api/photos/${photo.id}/edit-base`;
```

Then, inside the existing `<div ref={viewportRef} …>` viewport, when `editing` render the editor image (full working recipe via CSS) and the crop overlay instead of the zoom/pan image. Replace the inner image `<div ref={containerRef}>…</div>` with a conditional:

```tsx
        {editing ? (
          <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} />
        ) : (
          /* …existing containerRef/blur/img block, unchanged… */
        )}
```

- [ ] **Step 3: Implement `EditorCanvas`**

Add this component at the bottom of `zoomable-image.tsx`. It reads the working recipe from the session (consistent with the Task 9 version, which only grows the body). For now it shows the tilted, full-recipe image via a simple `object-contain` preview; Task 9 replaces this body with the aligned stage + crop overlay:

```tsx
function EditorCanvas({
  src,
  onBaseSize,
}: {
  src: string;
  onBaseSize: (s: { w: number; h: number }) => void;
}) {
  const { working } = useEditSession();
  const deg = working.rotate + (working.straighten ?? 0);
  const sx = working.flipH ? -1 : 1;
  const sy = working.flipV ? -1 : 1;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="max-h-full max-w-full select-none object-contain"
        style={{
          transform: `scaleX(${sx}) scaleY(${sy}) rotate(${deg}deg)`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Browser-verify the live straighten/rotate/flip preview**

Run `pnpm dev`. Open a photo → Edit tab → the center now shows the edit-base image. Drag Straighten → the image tilts live. Rotate/flip → updates live. Switch to Info tab → normal (baked) view returns. (Crop overlay still absent — next task.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "feat(web): live edit-base canvas — full working-recipe preview while editing"
```

---

### Task 9: Interactive crop overlay

**Files:**
- Create: `apps/web/src/components/photo-grid/crop-overlay.tsx`
- Modify: `apps/web/src/components/photo-grid/zoomable-image.tsx` (mount the overlay)

- [ ] **Step 1: Implement the crop overlay component**

Create `apps/web/src/components/photo-grid/crop-overlay.tsx`. It fills its parent — the **O′ stage**, a div of explicit pixel size `stageW×stageH` laid out by `EditorCanvas` (Step 2). It renders the dim surround, the crop rectangle (rule-of-thirds + 8 handles), and converts pointer drags into normalized O′ fractions (dividing the screen delta by the stage size). Keeping the stage layout in `EditorCanvas` is what guarantees the overlay and the (CSS-rotated) image share one coordinate system.

```tsx
"use client";

import { useRef, useState } from "react";
import { clampCropToImage, type CropRect } from "@lumio/shared";

type Handle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
const MIN = 0.05; // minimum crop size as a fraction of O′

/** Interactive crop frame filling the O′ stage (pixel size stageW×stageH). `wo`/
 *  `ho`/`deg` describe the oriented image + straighten angle for the inscribed
 *  clamp (aspect-only — units don't matter). `crop` is normalized to O′ (null =
 *  full frame). Tracks the drag locally for a smooth preview; commits once per
 *  gesture via onCommit (→ one undo entry). */
export function CropOverlay({
  stageW,
  stageH,
  wo,
  ho,
  deg,
  crop,
  ratio,
  onCommit,
}: {
  stageW: number;
  stageH: number;
  wo: number;
  ho: number;
  deg: number;
  crop: CropRect | null;
  ratio: number | null; // locked O′ fraction-space aspect (w/h) or null for free
  onCommit: (c: CropRect) => void;
}) {
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);
  const [live, setLive] = useState<CropRect | null>(null);
  const rect = live ?? crop ?? { x: 0, y: 0, w: 1, h: 1 };

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: rect };
    setLive(rect);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || stageW === 0) return;
    const dx = (e.clientX - d.startX) / stageW;
    const dy = (e.clientY - d.startY) / stageH;
    setLive(clampCropToImage(applyDrag(d.handle, d.start, dx, dy, ratio), wo, ho, deg));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (live) onCommit(live);
    setLive(null);
  };

  const px = (v: number) => `${v * 100}%`;
  return (
    <div className="absolute inset-0" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* dim surround via four panels around the crop rect */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute bg-black/50" style={{ left: 0, top: 0, right: 0, height: px(rect.y) }} />
        <div className="absolute bg-black/50" style={{ left: 0, bottom: 0, right: 0, height: px(1 - rect.y - rect.h) }} />
        <div className="absolute bg-black/50" style={{ top: px(rect.y), height: px(rect.h), left: 0, width: px(rect.x) }} />
        <div className="absolute bg-black/50" style={{ top: px(rect.y), height: px(rect.h), right: 0, width: px(1 - rect.x - rect.w) }} />
      </div>
      {/* crop frame */}
      <div
        className="absolute border border-white/90"
        style={{ left: px(rect.x), top: px(rect.y), width: px(rect.w), height: px(rect.h) }}
        onPointerDown={onPointerDown("move")}
      >
        {/* rule of thirds */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 bottom-0 bg-white/30" style={{ left: "33.33%", width: 1 }} />
          <div className="absolute top-0 bottom-0 bg-white/30" style={{ left: "66.66%", width: 1 }} />
          <div className="absolute left-0 right-0 bg-white/30" style={{ top: "33.33%", height: 1 }} />
          <div className="absolute left-0 right-0 bg-white/30" style={{ top: "66.66%", height: 1 }} />
        </div>
        {(["nw", "ne", "sw", "se", "n", "s", "e", "w"] as Handle[]).map((h) => (
          <span
            key={h}
            onPointerDown={onPointerDown(h)}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/40"
            style={handleStyle(h)}
          />
        ))}
      </div>
    </div>
  );
}

function handleStyle(h: Handle): React.CSSProperties {
  const x = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%";
  const y = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
  return { left: x, top: y, cursor: `${h}-resize` };
}

/** Next crop for a drag of (dx,dy) in O′ fractions. `ratio` (O′ fraction-space
 *  w/h) locks the aspect when set; keeps a minimum size. */
function applyDrag(h: Handle, s: CropRect, dx: number, dy: number, ratio: number | null): CropRect {
  if (h === "move") {
    return {
      x: Math.min(Math.max(0, s.x + dx), 1 - s.w),
      y: Math.min(Math.max(0, s.y + dy), 1 - s.h),
      w: s.w,
      h: s.h,
    };
  }
  let { x, y, w, h: hh } = s;
  const right = s.x + s.w;
  const bottom = s.y + s.h;
  if (h.includes("e")) w = Math.max(MIN, s.w + dx);
  if (h.includes("w")) { x = Math.min(right - MIN, s.x + dx); w = right - x; }
  if (h.includes("s")) hh = Math.max(MIN, s.h + dy);
  if (h.includes("n")) { y = Math.min(bottom - MIN, s.y + dy); hh = bottom - y; }
  if (ratio) hh = w / ratio; // keep width authoritative
  return { x, y, w, h: hh };
}
```

v1 passes `ratio={null}` (free-drag); the aspect *chips* still set exact ratios via `setAspect`. The `ratio` prop is wired but unused until aspect-locked dragging is desired (deferred).

- [ ] **Step 2: Mount the overlay inside `EditorCanvas`**

**Replace** the placeholder `EditorCanvas` from Task 8 with the version below — it computes the shared coordinate system so the CSS-rotated image and the axis-aligned crop overlay line up exactly. Key idea: a CSS `rotate` does **not** change an element's layout box, so we can't rely on `object-contain`; instead we size things explicitly.

- **k0** = contain scale of the oriented image O in the viewport.
- **O-box** = `(Wo·k0, Ho·k0)` on screen, centered, rotated by the straighten angle θ (this carries the base image).
- **O′ stage** = `straightenedSize(O-box, θ)` on screen, centered, axis-aligned (this carries the overlay). Crop fractions map 1:1 onto it.

Add the imports to `zoomable-image.tsx` (`useRef` to the React import; `straightenedSize`, `centeredAspectCrop` to the `@lumio/shared` import) and the `CropOverlay` import:

```tsx
import { CropOverlay } from "./crop-overlay";
// add to existing imports: useRef (react), straightenedSize, centeredAspectCrop (@lumio/shared)

function EditorCanvas({ src, onBaseSize }: { src: string; onBaseSize: (s: { w: number; h: number }) => void }) {
  const { working, orientedBase, setCrop } = useEditSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const theta = working.straighten ?? 0;
  const sx = working.flipH ? -1 : 1;
  const sy = working.flipV ? -1 : 1;

  // Geometry, once the base natural size and viewport are both known.
  let layout: null | { stageW: number; stageH: number; oW: number; oH: number; imgW: number; imgH: number } = null;
  if (orientedBase && vp.w > 0 && vp.h > 0) {
    const pad = 32;
    const k0 = Math.min((vp.w - pad) / orientedBase.w, (vp.h - pad) / orientedBase.h);
    const oW = orientedBase.w * k0;
    const oH = orientedBase.h * k0;
    const s = straightenedSize(oW, oH, theta);
    const swap = working.rotate === 90 || working.rotate === 270;
    // The base img is sized so that after a 90/270 CSS rotate it exactly fills the O-box.
    layout = { stageW: s.w, stageH: s.h, oW, oH, imgW: swap ? oH : oW, imgH: swap ? oW : oH };
  }

  // Effective crop for display: an explicit crop, or the auto-fill inscribed crop
  // when straightening with no explicit crop (mirrors the bake).
  const effectiveCrop = orientedBase
    ? working.crop ??
      (theta !== 0
        ? centeredAspectCrop(orientedBase.w / orientedBase.h, orientedBase.w, orientedBase.h, theta)
        : null)
    : null;

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {layout && (
        <div className="absolute" style={{ width: layout.stageW, height: layout.stageH }}>
          {/* O-box: holds the base image, tilted by the straighten angle */}
          <div
            className="absolute left-1/2 top-1/2"
            style={{ width: layout.oW, height: layout.oH, transform: `translate(-50%, -50%) rotate(${theta}deg)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: layout.imgW,
                height: layout.imgH,
                transform: `translate(-50%, -50%) rotate(${working.rotate}deg) scaleX(${sx}) scaleY(${sy})`,
                transformOrigin: "center center",
              }}
            />
          </div>
          <CropOverlay
            stageW={layout.stageW}
            stageH={layout.stageH}
            wo={orientedBase!.w}
            ho={orientedBase!.h}
            deg={theta}
            crop={effectiveCrop}
            ratio={null}
            onCommit={(c) => setCrop(c)}
          />
        </div>
      )}
      {/* Before the base loads we still need its natural size: load it hidden. */}
      {!orientedBase && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="opacity-0"
          onLoad={(e) => onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      )}
    </div>
  );
}
```

(The `<EditorCanvas …>` call site from Task 8 already uses `src={editBaseSrc} onBaseSize={setBaseSize}` — unchanged.)

- [ ] **Step 3: Browser-verify the interactive crop**

Run `pnpm dev`. Open a photo → Edit tab → a full-frame crop box with handles + thirds appears over the tilted/edit-base image. Drag a corner → the crop shrinks; drag the center → it moves; the dim surround tracks it. Straighten to ~15° → the crop auto-clamps so it never includes empty corners. Pick **16:9** chip → the crop snaps to a centered 16:9 box. **Apply** → grid + lightbox + film strip reflect the exact crop (cache-busted). Re-open Edit → the crop box reflects the saved crop, and dragging a handle **outward** expands it (edit-base works). **Reset** → back to original. **Undo/Redo** step across crop + straighten + rotate. Download (single + bulk edited zip) contains the cropped/straightened JPEG. Open a HEIC/JXL photo's editor → the base renders.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/crop-overlay.tsx apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "feat(web): interactive crop overlay (drag/resize/move, thirds, aspect snap)"
```

---

## Phase 4 — Polish & verification

### Task 10: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck + lint sweep**

```bash
pnpm -r test
pnpm --filter @lumio/shared typecheck && pnpm --filter @lumio/ingest typecheck
pnpm --filter @lumio/web lint
```
Expected: all green.

- [ ] **Step 2: Regression — rotate/flip still works end to end**

Browser-verify the original editor: rotate left/right (`[` / `]`), flip H/V, Apply, Reset, the `⌘S` apply shortcut, and the unsaved-changes discard prompt on navigation/close all still behave as before.

- [ ] **Step 3: Worker re-ingest preserves crop/straighten**

With a cropped+straightened photo, trigger a re-ingest/regenerate (e.g. via the worker rescan path) and confirm the renditions keep the crop/straighten (the `edits` JSON drives `buildRenditions`, so this should hold automatically — verify it does).

- [ ] **Step 4: Commit any verification fixes, then finish the branch**

Use the superpowers:finishing-a-development-branch skill to open the PR.

---

## Self-review notes (coverage map)

- **Spec §3 (model/schema/coercion):** Tasks 1, 3.
- **Spec §4 (geometry/transform stack):** Tasks 2, 4 (bake), 8/9 (preview); Model X keeps preview == bake.
- **Spec §5 (bake chokepoint):** Task 4 — `applyEdits`+`applyStraightenCrop` feed `buildRenditions`, `encodeEditedJpeg`, and (transitively) worker re-ingest (verified in Task 10 §3).
- **Spec §6 (recipe helpers):** Task 3.
- **Spec §7 (edit-base canvas):** Tasks 5 (endpoint), 8 (canvas).
- **Spec §8 (edit session):** Task 6.
- **Spec §9 (Edit-tab UI):** Task 7.
- **Spec §11 (testing):** unit tests in Tasks 1–5; browser-verify in Tasks 7, 9, 10.
- **Spec §12 (phasing):** Phases 1–3 mirror the spec's 3-phase split.

**Known v1 simplifications (per spec non-goals / brainstorm):**
- Straighten preview uses natural scale (Model X): the dimmed surround may show the image tilt near corners; the **output and the crop frame are always gap-free**. An Apple-style zoom-to-fill of the dimmed area is deferred polish (it would require resampling and edge-loss — out of scope).
- Crop overlay drag is free-form; aspect *chips* still produce exact-ratio crops. An aspect-locked drag can be wired later via `CropOverlay`'s already-present `ratio` prop.
