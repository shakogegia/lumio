# Photo Color Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight non-destructive color sliders (Exposure, Brightness, Contrast, Saturation, Temperature, Hue, Fade, Vignette) to the lightbox photo editor — live CSS preview, baked into renditions on Apply.

**Architecture:** The edit recipe (`PhotoEdits`, stored in the `Photo.n` JSONB column — **no migration**) gains eight optional numeric fields. A new shared module `photo-color.ts` is the single source of truth: it maps recipe values to (a) a CSS `filter` string + overlay specs for the live preview, and (b) sharp parameters for the server bake. Preview renders on the edit-free base in `EditedResult`; bake runs in `renditions.ts`. Geometry is untouched.

**Tech Stack:** TypeScript monorepo (pnpm), vitest, Zod, sharp (libvips), Next.js/React, shadcn `Slider`.

**Design doc:** `docs/superpowers/specs/2026-06-21-photo-color-adjustments-design.md`

---

## File structure

- `packages/shared/src/types.ts` — add 8 optional fields to `PhotoEdits` (Task 1)
- `packages/shared/src/api.ts` — add the 8 fields to `photoEditsSchema` (Zod) (Task 1)
- `packages/shared/src/photo-color.ts` — **new** formula module (Task 2)
- `packages/shared/src/index.ts` — export the new module (Task 2)
- `packages/shared/src/photo-edits.ts` — `hasGeometry`/`hasColor`, extend `hasEdits`/`sameEdits`/`coercePhotoEdits` (Task 3)
- `packages/db/src/mappers.test.ts` — round-trip test only (Task 4)
- `packages/ingest/src/renditions.ts` — `applyColor`, wire into bake (Task 5)
- `apps/web/src/components/photo-grid/use-edit-session.tsx` — `setColor` (Task 6)
- `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx` — Adjust section (Task 7)
- `apps/web/src/components/photo-grid/edited-result.tsx` — filter + overlays (Task 8)

Tasks 1–5 are TDD with vitest. Tasks 6–8 (React UI) have no unit-test harness in this repo and are verified in the browser (per the project's dev workflow).

**Canonical color order (preview and bake agree):** combined `brightness×contrast` → `saturation/hue` → temperature → fade → vignette (vignette always last, on the final cropped frame).

---

## Task 1: Recipe schema — `PhotoEdits` type + Zod

**Files:**
- Modify: `packages/shared/src/types.ts` (the `PhotoEdits` interface, around line 16–24)
- Modify: `packages/shared/src/api.ts` (the `photoEditsSchema`, around line 76–82)
- Test: `packages/shared/src/api.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/api.test.ts` (the `photoEditsSchema` symbol is already imported at the top of the file):

```ts
describe("photoEditsSchema color fields", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };

  it("accepts in-range color fields", () => {
    const r = photoEditsSchema.safeParse({ ...base, brightness: 50, hue: 90, vignette: 100 });
    expect(r.success).toBe(true);
  });

  it("rejects out-of-range color fields", () => {
    expect(photoEditsSchema.safeParse({ ...base, brightness: 999 }).success).toBe(false);
    expect(photoEditsSchema.safeParse({ ...base, hue: 360 }).success).toBe(false);
    expect(photoEditsSchema.safeParse({ ...base, vignette: -1 }).success).toBe(false);
  });

  it("preserves color fields through parse (does not strip them)", () => {
    const r = photoEditsSchema.parse({ ...base, contrast: -20 });
    expect(r.contrast).toBe(-20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: FAIL — `contrast`/`brightness` are stripped by `z.object()`, so `r.contrast` is `undefined` and the out-of-range cases pass parsing.

- [ ] **Step 3: Extend the `PhotoEdits` interface**

In `packages/shared/src/types.ts`, replace the `PhotoEdits` interface (currently ending at the `crop` field) with:

```ts
export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Fine tilt in degrees, clamped to [-45, 45]. Absent/0 = no straighten. */
  straighten?: number;
  /** Crop rectangle normalized to O′. Absent/null = full frame. */
  crop?: CropRect | null;

  // Color adjustments. All optional; absent === neutral. See photo-color.ts.
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

- [ ] **Step 4: Extend `photoEditsSchema`**

In `packages/shared/src/api.ts`, replace the `photoEditsSchema` definition with:

```ts
export const photoEditsSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  straighten: z.number().min(-45).max(45).optional(),
  crop: cropRectSchema.nullable().optional(),
  exposure: z.number().min(-100).max(100).optional(),
  brightness: z.number().min(-100).max(100).optional(),
  contrast: z.number().min(-100).max(100).optional(),
  saturation: z.number().min(-100).max(100).optional(),
  temperature: z.number().min(-100).max(100).optional(),
  hue: z.number().min(-180).max(180).optional(),
  fade: z.number().min(0).max(100).optional(),
  vignette: z.number().min(0).max(100).optional(),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/api.ts packages/shared/src/api.test.ts
git commit -m "feat(shared): add color fields to PhotoEdits recipe + schema"
```

---

## Task 2: Formula module — `photo-color.ts`

**Files:**
- Create: `packages/shared/src/photo-color.ts`
- Modify: `packages/shared/src/index.ts` (add one export line)
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/photo-color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLOR_FIELDS,
  hasColor,
  colorCssFilter,
  colorOverlays,
  toneLinear,
  modulateParams,
  tempFadeLinear,
  vignetteStrength,
} from "./photo-color.js";

const base = { rotate: 0 as const, flipH: false, flipV: false };

describe("photo-color", () => {
  it("exposes 8 ordered fields", () => {
    expect(COLOR_FIELDS.map((f) => f.key)).toEqual([
      "exposure", "brightness", "contrast", "saturation",
      "temperature", "hue", "fade", "vignette",
    ]);
  });

  it("hasColor: false when neutral, true for any non-neutral", () => {
    expect(hasColor(null)).toBe(false);
    expect(hasColor({ ...base })).toBe(false);
    expect(hasColor({ ...base, contrast: 10 })).toBe(true);
    expect(hasColor({ ...base, vignette: 5 })).toBe(true);
  });

  it("colorCssFilter: empty when neutral", () => {
    expect(colorCssFilter({ ...base })).toBe("");
  });

  it("colorCssFilter: maps the per-pixel ops", () => {
    expect(colorCssFilter({ ...base, brightness: 100 })).toBe("brightness(2)");
    expect(colorCssFilter({ ...base, contrast: -100 })).toBe("contrast(0)");
    expect(colorCssFilter({ ...base, saturation: 100 })).toBe("saturate(2)");
    expect(colorCssFilter({ ...base, hue: 90 })).toBe("hue-rotate(90deg)");
  });

  it("exposure maps to a power-of-two gain via brightness()", () => {
    expect(colorCssFilter({ ...base, exposure: 50 })).toBe("brightness(2)");
    expect(colorCssFilter({ ...base, exposure: -50 })).toBe("brightness(0.5)");
  });

  it("colorOverlays: only present fields, with expected shape", () => {
    expect(colorOverlays({ ...base })).toEqual([]);
    const warm = colorOverlays({ ...base, temperature: 100 });
    expect(warm[0].kind).toBe("temperature");
    expect(warm[0].opacity).toBeCloseTo(0.5, 3);
    const vig = colorOverlays({ ...base, vignette: 100 });
    expect(vig[0].kind).toBe("vignette");
    expect(vig[0].background).toContain("radial-gradient");
  });

  it("toneLinear: null when neutral, folds gain×contrast", () => {
    expect(toneLinear({ ...base })).toBeNull();
    expect(toneLinear({ ...base, brightness: 100 })).toEqual({ a: 2, b: 0 });
    const c = toneLinear({ ...base, contrast: 100 })!; // c = 2
    expect(c.a).toBeCloseTo(2, 6);
    expect(c.b).toBeCloseTo(-128, 6); // 128*(1-2)
  });

  it("modulateParams: null when neutral else sat/hue", () => {
    expect(modulateParams({ ...base })).toBeNull();
    expect(modulateParams({ ...base, saturation: 100 })).toEqual({ saturation: 2, hue: 0 });
  });

  it("tempFadeLinear: null when neutral; warm boosts R over B", () => {
    expect(tempFadeLinear({ ...base })).toBeNull();
    const warm = tempFadeLinear({ ...base, temperature: 100 })!;
    expect(warm.a[0]).toBeGreaterThan(warm.a[2]);
  });

  it("vignetteStrength: 0 neutral, scales to max", () => {
    expect(vignetteStrength({ ...base })).toBe(0);
    expect(vignetteStrength({ ...base, vignette: 100 })).toBeCloseTo(0.6, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-color.test.ts`
Expected: FAIL — `Cannot find module './photo-color.js'`.

- [ ] **Step 3: Create the module**

Create `packages/shared/src/photo-color.ts`:

```ts
import type { PhotoEdits } from "./types.js";

export type ColorKey =
  | "exposure" | "brightness" | "contrast" | "saturation"
  | "temperature" | "hue" | "fade" | "vignette";

/** Slider config — drives the edit-panel UI, validation, and reset. */
export interface ColorField {
  key: ColorKey;
  label: string;
  min: number;
  max: number;
  /** Neutral (no-op) value. */
  neutral: number;
  step: number;
}

export const COLOR_FIELDS: ColorField[] = [
  { key: "exposure",    label: "Exposure",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "brightness",  label: "Brightness",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "contrast",    label: "Contrast",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "saturation",  label: "Saturation",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "temperature", label: "Temperature", min: -100, max: 100, neutral: 0, step: 1 },
  { key: "hue",         label: "Hue",         min: -180, max: 180, neutral: 0, step: 1 },
  { key: "fade",        label: "Fade",        min: 0,    max: 100, neutral: 0, step: 1 },
  { key: "vignette",    label: "Vignette",    min: 0,    max: 100, neutral: 0, step: 1 },
];

// --- tuning constants (preview overlays and sharp bake share these) ---
const TEMP_WARM = "rgb(255, 150, 40)";
const TEMP_COOL = "rgb(40, 150, 255)";
const TEMP_MAX_OPACITY = 0.5;   // overlay opacity at |temperature| = 100
const TEMP_CHANNEL_GAIN = 0.25; // sharp per-channel R/B swing at |temperature| = 100
const FADE_MAX_OPACITY = 0.12;  // white-overlay opacity at fade = 100
const FADE_SCALE = 0.15;        // sharp contrast reduction at fade = 100
const FADE_LIFT = 18;           // sharp black lift (0..255) at fade = 100
const VIGNETTE_MAX_OPACITY = 0.6; // darkest corner alpha at vignette = 100

const val = (e: PhotoEdits | null, k: ColorKey): number => e?.[k] ?? 0;

// --- normalized getters: the single source of truth ---

/** Combined tonal gain (exposure × brightness). 1 = neutral. */
export function gainFactor(e: PhotoEdits | null): number {
  return Math.pow(2, val(e, "exposure") / 50) * (1 + val(e, "brightness") / 100);
}
/** Contrast factor. 1 = neutral. */
export function contrastFactor(e: PhotoEdits | null): number {
  return 1 + val(e, "contrast") / 100;
}
/** Saturation factor. 1 = neutral. */
export function saturationFactor(e: PhotoEdits | null): number {
  return Math.max(0, 1 + val(e, "saturation") / 100);
}
/** Hue rotation in degrees. 0 = neutral. */
export function hueDegrees(e: PhotoEdits | null): number {
  return val(e, "hue");
}

export function hasColor(e: PhotoEdits | null): boolean {
  if (!e) return false;
  return COLOR_FIELDS.some((f) => val(e, f.key) !== f.neutral);
}

// --- CSS preview ---

/** Per-pixel CSS filter chain (exposure/brightness/contrast/saturation/hue).
 *  "" when neutral. Temperature/fade/vignette are overlays (colorOverlays). */
export function colorCssFilter(e: PhotoEdits | null): string {
  const parts: string[] = [];
  const g = gainFactor(e);
  const c = contrastFactor(e);
  const s = saturationFactor(e);
  const h = hueDegrees(e);
  if (g !== 1) parts.push(`brightness(${round(g)})`);
  if (c !== 1) parts.push(`contrast(${round(c)})`);
  if (s !== 1) parts.push(`saturate(${round(s)})`);
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`);
  return parts.join(" ");
}

export type OverlayKind = "temperature" | "fade" | "vignette";
export interface ColorOverlay {
  kind: OverlayKind;
  /** CSS background value (color or gradient). */
  background: string;
  blendMode: "soft-light" | "normal";
  /** 0..1 */
  opacity: number;
}

/** Overlay specs for temperature/fade/vignette, in apply order. Empty when neutral.
 *  Sized by the consumer to the final cropped frame. */
export function colorOverlays(e: PhotoEdits | null): ColorOverlay[] {
  const out: ColorOverlay[] = [];
  const temp = val(e, "temperature") / 100; // -1..1
  const fade = val(e, "fade") / 100;          // 0..1
  const vig = vignetteStrength(e);            // 0..max
  if (temp !== 0) {
    out.push({
      kind: "temperature",
      background: temp > 0 ? TEMP_WARM : TEMP_COOL,
      blendMode: "soft-light",
      opacity: Math.abs(temp) * TEMP_MAX_OPACITY,
    });
  }
  if (fade > 0) {
    out.push({ kind: "fade", background: "rgb(255,255,255)", blendMode: "normal", opacity: fade * FADE_MAX_OPACITY });
  }
  if (vig > 0) {
    out.push({
      kind: "vignette",
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${round(vig)}) 100%)`,
      blendMode: "normal",
      opacity: 1,
    });
  }
  return out;
}

// --- sharp bake params (consumed by packages/ingest) ---

export interface ToneLinear { a: number; b: number; }
/** Gain × contrast folded into one scalar linear (a*x + b on 0..255). null = neutral. */
export function toneLinear(e: PhotoEdits | null): ToneLinear | null {
  const g = gainFactor(e);
  const c = contrastFactor(e);
  if (g === 1 && c === 1) return null;
  return { a: c * g, b: 128 * (1 - c) };
}

export interface ModulateParams { saturation: number; hue: number; }
export function modulateParams(e: PhotoEdits | null): ModulateParams | null {
  const s = saturationFactor(e);
  const h = hueDegrees(e);
  if (s === 1 && h === 0) return null;
  return { saturation: s, hue: h };
}

export interface ChannelLinear { a: [number, number, number]; b: [number, number, number]; }
/** Temperature × fade folded into one per-channel [R,G,B] linear. null = neutral. */
export function tempFadeLinear(e: PhotoEdits | null): ChannelLinear | null {
  const t = val(e, "temperature") / 100; // -1..1
  const f = val(e, "fade") / 100;         // 0..1
  if (t === 0 && f === 0) return null;
  const tempR = 1 + TEMP_CHANNEL_GAIN * t;
  const tempB = 1 - TEMP_CHANNEL_GAIN * t;
  const scale = 1 - FADE_SCALE * f;
  const lift = FADE_LIFT * f;
  return {
    a: [scale * tempR, scale * 1, scale * tempB],
    b: [lift, lift, lift],
  };
}

/** Corner-darkening alpha 0..max. 0 = none. */
export function vignetteStrength(e: PhotoEdits | null): number {
  return (val(e, "vignette") / 100) * VIGNETTE_MAX_OPACITY;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add after the `photo-edits.js` export line:

```ts
export * from "./photo-color.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-color.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/index.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(shared): add photo-color formula module (CSS + sharp params)"
```

---

## Task 3: Edit predicates + coercion — `photo-edits.ts`

**Files:**
- Modify: `packages/shared/src/photo-edits.ts` (`hasEdits` ~line 7, `sameEdits` ~line 20, `coercePhotoEdits` ~line 138)
- Test: `packages/shared/src/photo-edits.test.ts` (append a `describe` + extend imports)

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/photo-edits.test.ts`, add `hasGeometry` and `hasColor` to the existing import block from `./photo-edits.js`, then append:

```ts
describe("photo-edits color", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };

  it("hasGeometry ignores color; hasColor ignores geometry; hasEdits unions them", () => {
    expect(hasGeometry({ ...base, brightness: 50 })).toBe(false);
    expect(hasColor({ ...base, brightness: 50 })).toBe(true);
    expect(hasEdits({ ...base, brightness: 50 })).toBe(true);
    expect(hasGeometry({ ...base, rotate: 90 })).toBe(true);
    expect(hasColor({ ...base, rotate: 90 })).toBe(false);
    expect(hasEdits({ ...base })).toBe(false);
  });

  it("sameEdits compares color fields (absent === 0)", () => {
    expect(sameEdits({ ...base, contrast: 10 }, { ...base, contrast: 10 })).toBe(true);
    expect(sameEdits({ ...base, contrast: 10 }, { ...base, contrast: 11 })).toBe(false);
    expect(sameEdits({ ...base, exposure: 0 }, { ...base })).toBe(true);
  });

  it("coercePhotoEdits clamps color and omits neutral", () => {
    const out = coercePhotoEdits({ ...base, brightness: 50, contrast: 999, exposure: 0 })!;
    expect(out.brightness).toBe(50);
    expect(out.contrast).toBe(100);
    expect(out).not.toHaveProperty("exposure");
    expect(out).not.toHaveProperty("vignette");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-edits.test.ts`
Expected: FAIL — `hasGeometry`/`hasColor` are not exported; `coercePhotoEdits` drops color.

- [ ] **Step 3: Add imports + `hasGeometry`, extend `hasEdits`**

In `packages/shared/src/photo-edits.ts`, add to the top imports:

```ts
import { COLOR_FIELDS, hasColor } from "./photo-color.js";
```

Replace the existing `hasEdits` function with:

```ts
/** True when the recipe applies any geometry change (flip/rotate/straighten/crop). */
export function hasGeometry(e: PhotoEdits | null): boolean {
  return (
    e !== null &&
    (e.rotate !== 0 || e.flipH || e.flipV || (e.straighten ?? 0) !== 0 || e.crop != null)
  );
}

/** True when the recipe changes the image at all (geometry or color). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return hasGeometry(e) || hasColor(e);
}
```

Note: `hasColor` is re-exported transitively via `index.ts`'s `export * from "./photo-color.js"`; the test imports it from `./photo-edits.js` only for convenience — re-export it by adding to `photo-edits.ts`:

```ts
export { hasColor } from "./photo-color.js";
```

- [ ] **Step 4: Extend `sameEdits`**

Replace the `sameEdits` function body's `return` with:

```ts
export function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return (
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    (a.straighten ?? 0) === (b.straighten ?? 0) &&
    sameCrop(a.crop, b.crop) &&
    COLOR_FIELDS.every((f) => (a[f.key] ?? 0) === (b[f.key] ?? 0))
  );
}
```

- [ ] **Step 5: Extend `coercePhotoEdits`**

In `coercePhotoEdits`, replace the final `return { rotate: ..., flipH, flipV, straighten, crop };` line with:

```ts
  const out: PhotoEdits = { rotate: e.rotate as PhotoEdits["rotate"], flipH: e.flipH, flipV: e.flipV, straighten, crop };
  for (const f of COLOR_FIELDS) {
    const v = e[f.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const clamped = Math.max(f.min, Math.min(f.max, v));
      if (clamped !== f.neutral) (out as Record<string, unknown>)[f.key] = clamped;
    }
  }
  return out;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-edits.test.ts`
Expected: PASS (existing `NO_EDITS`/`coercePhotoEdits` equality tests still pass — neutral color is omitted, so the object shape is unchanged.)

- [ ] **Step 7: Run the whole shared package + typecheck**

Run: `pnpm --filter @lumio/shared exec vitest run && pnpm --filter @lumio/shared typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/photo-edits.ts packages/shared/src/photo-edits.test.ts
git commit -m "feat(shared): hasGeometry/hasColor + color-aware sameEdits/coerce"
```

---

## Task 4: DB mapper round-trips color

**Files:**
- Test: `packages/db/src/mappers.test.ts` (append a test — no production change; `toPhotoDTO` already uses `coercePhotoEdits`)

- [ ] **Step 1: Write the test**

Append to `packages/db/src/mappers.test.ts` inside the `describe("toPhotoDTO", …)` block (after the existing edits tests):

```ts
  it("round-trips color fields and omits neutral ones", () => {
    const dto = toPhotoDTO({
      ...baseRow,
      edits: { rotate: 0, flipH: false, flipV: false, brightness: 40, vignette: 0 },
    } as any);
    expect(dto.edits).toEqual({
      rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null, brightness: 40,
    });
  });

  it("clamps malformed color to neutral (drops it)", () => {
    const dto = toPhotoDTO({
      ...baseRow,
      edits: { rotate: 0, flipH: false, flipV: false, contrast: 9999 },
    } as any);
    expect(dto.edits).toEqual({
      rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null, contrast: 100,
    });
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @lumio/db exec vitest run src/mappers.test.ts`
Expected: PASS (this validates Task 3's coercion flows through the DB mapper). If the `@lumio/db` test run needs a database, scope to the mapper file only — `mappers.test.ts` is pure and needs no DB.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/mappers.test.ts
git commit -m "test(db): color fields round-trip through toPhotoDTO"
```

---

## Task 5: Bake color with sharp — `renditions.ts`

**Files:**
- Modify: `packages/ingest/src/renditions.ts` (imports; add `applyColor`; `buildRenditions` ~line 97 & 116; `encodeEditedJpeg` ~line 82)
- Test: `packages/ingest/src/renditions.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `packages/ingest/src/renditions.test.ts`:

```ts
describe("buildRenditions color", () => {
  const grey = () =>
    sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 100, g: 100, b: 100 } } })
      .png()
      .toBuffer();

  it("brightens with a color-only recipe and keeps dimensions", async () => {
    const base = await buildRenditions(await grey(), null);
    const bright = await buildRenditions(await grey(), {
      rotate: 0, flipH: false, flipV: false, brightness: 80,
    });
    const m0 = (await sharp(base.display).stats()).channels[0].mean;
    const m1 = (await sharp(bright.display).stats()).channels[0].mean;
    expect(m1).toBeGreaterThan(m0);
    expect([bright.width, bright.height]).toEqual([16, 16]);
  });

  it("vignette darkens the corner more than the center", async () => {
    const white = await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const r = await buildRenditions(white, { rotate: 0, flipH: false, flipV: false, vignette: 100 });
    const { data, info } = await sharp(r.display).raw().toBuffer({ resolveWithObject: true });
    const lum = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    const corner = lum(0, 0);
    const center = lum(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect(center).toBeGreaterThan(corner + 20);
  });

  it("composes geometry and color (crop dims + brighter pixels)", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 100, b: 100 } },
    }).png().toBuffer();
    const r = await buildRenditions(img, {
      rotate: 0, flipH: false, flipV: false,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, brightness: 80,
    });
    expect([r.width, r.height]).toEqual([50, 50]);
    const mean = (await sharp(r.display).stats()).channels[0].mean;
    expect(mean).toBeGreaterThan(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/renditions.test.ts`
Expected: FAIL — color is not baked, so `m1 === m0`, the corner is not darkened, and the composed mean is ~100.

- [ ] **Step 3: Update imports**

In `packages/ingest/src/renditions.ts`, replace the `@lumio/shared` import block with:

```ts
import {
  hasEdits,
  hasGeometry,
  hasColor,
  toneLinear,
  modulateParams,
  tempFadeLinear,
  vignetteStrength,
  cropToExtract,
  centeredAspectCrop,
  straightenedSize,
  type PhotoEdits,
} from "@lumio/shared";
```

- [ ] **Step 4: Add `applyColor` + the vignette SVG helper**

Add to `packages/ingest/src/renditions.ts` (e.g. directly after `applyStraightenCrop`):

```ts
/** Apply the color recipe to an ALREADY-FRAMED pipeline (flip/rotate/straighten/
 *  crop done). Order matches the CSS preview: gain×contrast → saturation/hue →
 *  temperature×fade → vignette (last, on the final frame). Materializes between
 *  the two linear stages so their order is deterministic (sharp keeps a single
 *  linear slot). No-op (returns `img`) when the recipe has no color. */
export async function applyColor(img: Sharp, edits: PhotoEdits | null): Promise<Sharp> {
  if (!hasColor(edits)) return img;
  const tone = toneLinear(edits);
  const mod = modulateParams(edits);
  const tempFade = tempFadeLinear(edits);
  const vig = vignetteStrength(edits);

  // Pass 1: tone (gain×contrast) then saturation/hue.
  let pass1 = img;
  if (tone) pass1 = pass1.linear(tone.a, tone.b);
  if (mod) pass1 = pass1.modulate({ saturation: mod.saturation, hue: mod.hue });
  let buf = await pass1.png().toBuffer();

  // Pass 2: temperature×fade as one per-channel linear.
  if (tempFade) {
    buf = await sharp(buf).linear(tempFade.a, tempFade.b).png().toBuffer();
  }

  // Pass 3: vignette — composite a radial darkening mask sized to the frame.
  if (vig > 0) {
    const meta = await sharp(buf).metadata();
    const svg = vignetteSvg(meta.width ?? 0, meta.height ?? 0, vig);
    buf = await sharp(buf).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toBuffer();
  }

  return sharp(buf);
}

function vignetteSvg(w: number, h: number, alpha: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs><radialGradient id="v" cx="50%" cy="50%" r="75%">` +
    `<stop offset="45%" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="${alpha.toFixed(3)}"/>` +
    `</radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#v)"/></svg>`
  );
}
```

- [ ] **Step 5: Wire color into `buildRenditions`**

In `buildRenditions`, change the geometry flag and apply color before the display resize.

Replace `const geom = hasEdits(edits);` with:

```ts
  const geom = hasGeometry(edits);
```

Replace:

```ts
  const baked = await applyStraightenCrop(applyEdits(start(), edits), edits, wo, ho);
  const display = await baked
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
```

with:

```ts
  const framed = await applyStraightenCrop(applyEdits(start(), edits), edits, wo, ho);
  const baked = await applyColor(framed, edits);
  const display = await baked
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
```

(The analytic width/height branch is unchanged: color never changes dimensions, and `geom` still gates it correctly — color-only edits fall through to the metadata branch, which yields the original oriented dims.)

- [ ] **Step 6: Wire color into `encodeEditedJpeg`**

In `encodeEditedJpeg`, replace:

```ts
  const baked = await applyStraightenCrop(applyEdits(sharp(oriented), edits), edits, wo, ho);
  return baked.jpeg({ quality: EDITED_JPEG_QUALITY }).toBuffer();
```

with:

```ts
  const framed = await applyStraightenCrop(applyEdits(sharp(oriented), edits), edits, wo, ho);
  const baked = await applyColor(framed, edits);
  return baked.jpeg({ quality: EDITED_JPEG_QUALITY }).toBuffer();
```

The fast no-op path (`if (!hasEdits(edits)) …`) is unchanged: `hasEdits` now includes color, so color-only recipes correctly skip the fast path and reach this branch (geometry is a no-op, color is applied).

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/renditions.test.ts`
Expected: PASS

- [ ] **Step 8: Run the whole ingest package + typecheck**

Run: `pnpm --filter @lumio/ingest exec vitest run && pnpm --filter @lumio/ingest typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts
git commit -m "feat(ingest): bake color adjustments in renditions + edited JPEG"
```

---

## Task 6: Edit session — `setColor`

**Files:**
- Modify: `apps/web/src/components/photo-grid/use-edit-session.tsx`

No unit-test harness for this hook in the repo; correctness is verified end-to-end in Task 8.

- [ ] **Step 1: Import the color key type**

In the `@lumio/shared` import block of `use-edit-session.tsx`, add `type ColorKey`:

```ts
  type CropRect,
  type ColorKey,
} from "@lumio/shared";
```

- [ ] **Step 2: Add `setColor` to the context interface**

In the `EditSessionValue` interface, after `setAspect`, add:

```ts
  /** Set a single color-adjustment field (0/neutral removes it). Pushes history. */
  setColor: (key: ColorKey, value: number) => void;
```

- [ ] **Step 3: Implement `setColor` + an omit helper**

Add this module-level helper near `freshHistory`/`pushHistory`:

```ts
/** Return the recipe with `key` removed (used when a color slider returns to 0). */
function withoutColor(e: PhotoEdits, key: ColorKey): PhotoEdits {
  if (e[key] === undefined) return e;
  const next = { ...e };
  delete next[key];
  return next;
}
```

Inside `EditSessionProvider`, alongside the other `useCallback` setters, add:

```ts
  const setColor = useCallback((key: ColorKey, value: number) => {
    setHistory((h) => {
      const cur = h.stack[h.index];
      const next = value === 0 ? withoutColor(cur, key) : { ...cur, [key]: value };
      return pushHistory(h, next);
    });
  }, []);
```

- [ ] **Step 4: Expose it on the context value**

In the `value: EditSessionValue = { … }` object, add `setColor,` (next to `setAspect,`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json`
Expected: No new errors referencing `use-edit-session.tsx`. (If the web package has no `typecheck` script, this command typechecks in place; pre-existing unrelated errors, if any, can be ignored per the project's "tsc is not a gate" note — but the edited file must be clean.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/use-edit-session.tsx
git commit -m "feat(web): setColor on the edit session (undo/redo aware)"
```

---

## Task 7: Edit panel — Adjust section

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`

- [ ] **Step 1: Import the field config**

Add `COLOR_FIELDS` to the `@lumio/shared` import:

```ts
import { hasEdits, COLOR_FIELDS, type AspectPreset } from "@lumio/shared";
```

- [ ] **Step 2: Pull `working` and `setColor` from the session**

In the `useEditSession()` destructure at the top of `LightboxEditPanel`, ensure `working` and `setColor` are included:

```ts
  const {
    working,
    dirty,
    applying,
    // …existing…
    setColor,
    cropMode,
    enterCropMode,
    doneCropMode,
    cancelCropMode,
  } = useEditSession();
```

- [ ] **Step 3: Render the Adjust section**

In the non-crop return (the main panel), insert this block between the `Transform` `<div>` and the `Crop & Straighten` button:

```tsx
      <div className="space-y-3">
        <p className="font-medium">Adjust</p>
        {COLOR_FIELDS.map((f) => {
          const value = working[f.key] ?? 0;
          return (
            <div key={f.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>{f.label}</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setColor(f.key, f.neutral)}
                >
                  {value}
                </button>
              </div>
              <Slider
                min={f.min}
                max={f.max}
                step={f.step}
                value={[value]}
                onValueChange={(v) => setColor(f.key, v[0])}
              />
            </div>
          );
        })}
      </div>
```

(`Slider` is already imported in this file. `working[f.key]` is `number | undefined`; `?? 0` makes the slider controlled at neutral.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json`
Expected: the edited file is clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-edit-panel.tsx
git commit -m "feat(web): Adjust section with 8 color sliders in the edit panel"
```

---

## Task 8: Live preview + end-to-end verification

**Files:**
- Modify: `apps/web/src/components/photo-grid/edited-result.tsx`

- [ ] **Step 1: Import the preview helpers**

Update the `@lumio/shared` import in `edited-result.tsx`:

```ts
import {
  centeredAspectCrop,
  straightenedSize,
  colorCssFilter,
  colorOverlays,
  type CropRect,
  type PhotoEdits,
} from "@lumio/shared";
```

- [ ] **Step 2: Apply the filter to the stage + render overlays in the cropped frame**

Replace the `inner = ( … )` JSX block (the `<div className="relative overflow-hidden" …>` and its single child) with:

```tsx
    const filter = colorCssFilter(working);
    const overlays = colorOverlays(working);
    inner = (
      <div className="relative overflow-hidden" style={{ width: bw, height: bh }}>
        <div
          className="absolute"
          style={{
            width: stageW,
            height: stageH,
            left: -effectiveCrop.x * stageW,
            top: -effectiveCrop.y * stageH,
            filter: filter || undefined,
          }}
        >
          <BaseImageStage
            src={imgSrc}
            stageW={stageW}
            orientedBase={orientedBase}
            working={working}
            onLoad={(e) =>
              onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        </div>
        {overlays.map((o) => (
          <div
            key={o.kind}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: o.background, mixBlendMode: o.blendMode, opacity: o.opacity }}
          />
        ))}
      </div>
    );
```

(The `filter` sits on the stage div so it affects only the image; the overlays are siblings covering the cropped frame, so temperature/fade/vignette align to the visible result — same "final frame" rule the bake uses.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json`
Expected: the edited file is clean.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm -r test`
Expected: all packages PASS (shared, ingest, db).

- [ ] **Step 5: Browser verification (the real gate for the UI)**

Start the app (`pnpm dev`; DB on 5433 must be up — `pnpm db:up`) and verify in the browser:

1. Open a photo → **Edit** tab. The **Adjust** section shows 8 sliders, all at 0.
2. Drag **Brightness** / **Contrast** / **Saturation** / **Hue** / **Exposure** → the image updates live.
3. Drag **Temperature** (warm/cool tint), **Fade** (matte wash), **Vignette** (corners darken) → overlays update live and vignette stays centered on the cropped frame (try after setting a crop).
4. Click a slider's value readout → that slider resets to 0.
5. **Undo/Redo** step through slider changes. **Reset** clears all edits.
6. **Apply** → the centered image and the grid thumbnail re-render with the baked color. Reopen the photo: color persists.
7. Download (edited) reflects the color. A color-only edit (no crop/rotate) still bakes and updates the grid.
8. Combine a crop/rotate with color → both bake correctly together.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/edited-result.tsx
git commit -m "feat(web): live CSS preview of color adjustments in the editor"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** recipe schema (T1), formula module + CSS/overlays/sharp params (T2), `hasGeometry`/`hasColor`/`sameEdits`/`coerce` (T3), DB round-trip (T4), sharp bake + edited JPEG + `geom=hasGeometry` (T5), session `setColor` (T6), UI sliders (T7), live preview + e2e (T8). Persistence-without-migration and "no DB change" are inherent to using the `Photo.n` JSONB column.
- **Type consistency:** `ColorKey`, `ColorField`, `COLOR_FIELDS`, `colorCssFilter`, `colorOverlays`, `toneLinear`, `modulateParams`, `tempFadeLinear`, `vignetteStrength`, `hasColor`, `hasGeometry`, `applyColor`, `setColor` are named identically everywhere they appear across tasks.
- **Neutral-omit invariant:** `coercePhotoEdits` (T3) and `setColor` (T6) both drop a field at its neutral value, so recipes stay canonical and the existing `NO_EDITS`/equality tests keep passing.
- **Known tuned-close effects:** temperature/fade/vignette preview (overlays) vs bake (per-channel linear + radial mask) are visually matched, not pixel-identical, by design; tuning constants live in one place (`photo-color.ts`) for adjustment during Step-5 browser verification.
- **Assumption:** color ops run on 3-channel RGB renditions (true for photo-derived display/edited renditions and the test fixtures).
</content>
