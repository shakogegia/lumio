# Sharpen / Noise Reduction / Grain Sliders — Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five single-pass detail/effect sliders — Sharpen, Sharpen Masking, Noise Reduction, Grain, Grain Size — to the GPU photo editor, computed identically in the WebGL2 shader and the Node/Sharp bake so preview == save.

**Architecture:** Five additive, neutral-0 `PhotoEdits` fields (no migration). The shared color model (`photo-color.ts`) gains `DetailParams` + `GrainParams`. `applyColorToRaw` reads a fixed 3×3 of the *pristine source* (one snapshot copy) to denoise + sharpen each pixel *before* the existing color pipeline, then adds per-pixel grain *after* vignette. The GLSL shader mirrors that math (same Gaussian/Sobel weights, same bilateral σ, same integer grain hash, texel-center sampling + CLAMP_TO_EDGE). Effects are gated: a neutral slider is skipped on both sides, so unused = zero cost.

**Tech Stack:** TypeScript, WebGL2 (GLSL 300 es), `sharp`, Vitest. Monorepo packages: `@lumio/shared` (math, source of truth), `apps/web` (renderer), `packages/ingest` (bake).

**Reference spec:** `docs/superpowers/specs/2026-06-24-sharpen-noise-grain-sliders-design.md`
**Roadmap (v2/v3):** `docs/photo-editor-detail-and-effects.md`

Run all shared tests with: `pnpm --filter @lumio/shared test` (or `npx vitest run` in `packages/shared`). Typecheck: `pnpm -r typecheck` (or the repo's configured command).

---

### Task 1: Add the five fields to the schema + slider config

**Files:**
- Modify: `packages/shared/src/photo-color.ts` (`ColorKey`, `COLOR_FIELDS`)
- Modify: `packages/shared/src/types.ts` (`PhotoEdits`)
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write failing tests** — append to `photo-color.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COLOR_FIELDS, NEUTRAL, hasColor } from "./photo-color.js";

describe("detail/grain fields", () => {
  it("registers the five new fields as neutral-0 sliders", () => {
    for (const key of ["sharpen", "sharpenMask", "noiseReduction", "grain", "grainSize"] as const) {
      const f = COLOR_FIELDS.find((c) => c.key === key);
      expect(f, key).toBeDefined();
      expect(f!.neutral).toBe(0);
      expect(f!.min).toBe(0);
      expect(f!.max).toBe(100);
      expect(NEUTRAL[key]).toBe(0);
    }
  });
  it("hasColor flips true when a detail/grain field is non-neutral", () => {
    expect(hasColor({ sharpen: 40 } as never)).toBe(true);
    expect(hasColor({ grain: 25 } as never)).toBe(true);
    expect(hasColor({ sharpen: 0, grain: 0 } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run photo-color.test.ts` → FAIL (keys missing from `ColorKey`/`COLOR_FIELDS`).

- [ ] **Step 3: Implement.** In `photo-color.ts`, extend `ColorKey`:

```ts
export type ColorKey =
  | "exposure" | "brightness" | "contrast" | "saturation"
  | "temperature" | "tint" | "hue" | "fade" | "vignette"
  | "highlights" | "shadows" | "whites" | "blacks" | "vibrance"
  | "sharpen" | "sharpenMask" | "noiseReduction" | "grain" | "grainSize";
```

In `COLOR_FIELDS`, add a Detail group after `hue` (before `// Effects`):

```ts
  // Detail
  { key: "sharpen",        label: "Sharpen",         min: 0, max: 100, neutral: 0, step: 1 },
  { key: "sharpenMask",    label: "Sharpen Masking", min: 0, max: 100, neutral: 0, step: 1 },
  { key: "noiseReduction", label: "Noise Reduction", min: 0, max: 100, neutral: 0, step: 1 },
```

and append to the `// Effects` group after `vignette`:

```ts
  { key: "grain",          label: "Grain",           min: 0, max: 100, neutral: 0, step: 1 },
  { key: "grainSize",      label: "Grain Size",      min: 0, max: 100, neutral: 0, step: 1 },
```

In `types.ts`, add to `PhotoEdits` (after `vibrance`, before `curves`):

```ts
  /** Unsharp-mask amount (3×3 high-pass). 0..100, 0 = neutral. */
  sharpen?: number;
  /** Sharpen masking: hold sharpening back in flat areas. 0..100, 0 = neutral. */
  sharpenMask?: number;
  /** Edge-aware noise reduction (blend toward local mean). 0..100, 0 = neutral. */
  noiseReduction?: number;
  /** Film grain amount (per-pixel hash). 0..100, 0 = neutral. */
  grain?: number;
  /** Grain cell size; only meaningful when grain > 0. 0..100, 0 = neutral. */
  grainSize?: number;
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run photo-color.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/types.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(editor): add sharpen/noise/grain slider fields (schema + config)"
```

---

### Task 2: Grain hash + value-noise helpers (shared)

**Files:**
- Modify: `packages/shared/src/photo-color.ts`
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { grainHash, valueNoise } from "./photo-color.js";

describe("grain noise", () => {
  it("grainHash is deterministic and in [0,1)", () => {
    const a = grainHash(12, 7);
    expect(grainHash(12, 7)).toBe(a);          // deterministic
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(grainHash(12, 8)).not.toBe(a);      // varies with coords
  });
  it("grainHash uses only the low 16 bits (float32-safe)", () => {
    const v = grainHash(99, 1234);
    expect(Number.isInteger(v * 65536)).toBe(true); // exactly k/65536
  });
  it("valueNoise is continuous-ish and in [-1,1]", () => {
    for (const [x, y] of [[0, 0], [5, 9], [40, 3]]) {
      const n = valueNoise(x, y, 3);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
    // at an integer lattice point the interpolation collapses to the lattice hash
    expect(valueNoise(0, 0, 1)).toBeCloseTo(grainHash(0, 0) * 2 - 1, 10);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run photo-color.test.ts` → FAIL (`grainHash` not exported).

- [ ] **Step 3: Implement.** Add near the bottom of `photo-color.ts` (after `toChannel`):

```ts
// --- Grain (per-pixel) — integer hash kept ≤16 bits so float32 (GPU) and
// double (JS) agree; mirrored verbatim in the GL shader. ---

/** 32-bit integer hash of a pixel coordinate → [0,1), reduced to 16 bits. */
export function grainHash(ix: number, iy: number): number {
  let n = (Math.imul(ix >>> 0, 0x1f1f1f1f) ^ (iy >>> 0)) >>> 0;
  n = Math.imul(n, 0x27d4eb2d) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  return (n & 0xffff) / 65536;
}

function smoothstepUnit(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value-noise in [-1,1] on a lattice scaled by `cell` (px per cell). */
export function valueNoise(x: number, y: number, cell: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = smoothstepUnit(fx - ix);
  const sy = smoothstepUnit(fy - iy);
  const h00 = grainHash(ix, iy);
  const h10 = grainHash(ix + 1, iy);
  const h01 = grainHash(ix, iy + 1);
  const h11 = grainHash(ix + 1, iy + 1);
  const a = h00 + (h10 - h00) * sx;
  const b = h01 + (h11 - h01) * sx;
  return (a + (b - a) * sy) * 2 - 1;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run photo-color.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(editor): add float32-safe grain hash + value noise"
```

---

### Task 3: Model artifacts — DetailParams, GrainParams, builders

**Files:**
- Modify: `packages/shared/src/photo-color.ts`
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { detailParams, grainParams, buildColorModel } from "./photo-color.js";

describe("detail/grain params", () => {
  it("detailParams is null unless sharpen or NR is active", () => {
    expect(detailParams({ sharpenMask: 80 } as never)).toBeNull(); // mask alone is a no-op
    expect(detailParams(null)).toBeNull();
    const d = detailParams({ sharpen: 100, sharpenMask: 50, noiseReduction: 20 } as never)!;
    expect(d.sharpen).toBeCloseTo(1.5, 6); // folds SHARPEN_MAX = 1.5
    expect(d.mask).toBeCloseTo(0.5, 6);
    expect(d.nr).toBeCloseTo(0.2, 6);
  });
  it("grainParams is null unless grain is active; folds amount + cell", () => {
    expect(grainParams({ grainSize: 100 } as never)).toBeNull();
    const g = grainParams({ grain: 50, grainSize: 100 } as never)!;
    expect(g.amount).toBeCloseTo(0.06, 6);   // 0.5 * GRAIN_MAX(0.12)
    expect(g.cell).toBeCloseTo(4, 6);         // 1 + 1*(GRAIN_CELL_MAX-1=3)
    expect(grainParams({ grain: 50 } as never)!.cell).toBeCloseTo(1, 6); // size 0 → cell 1
  });
  it("buildColorModel carries detail + grain", () => {
    const m = buildColorModel({ sharpen: 30, grain: 10 } as never);
    expect(m.detail).not.toBeNull();
    expect(m.grain).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (`detailParams` not exported).

- [ ] **Step 3: Implement.** Add tuning constants alongside the existing `--- tuning constants ---` block in `photo-color.ts`:

```ts
const SHARPEN_MAX = 1.5;     // high-pass gain at sharpen = 100
const MASK_LO = 0.1;         // luma-gradient (raw Sobel) where masking starts allowing sharpen
const MASK_HI = 0.8;         // luma-gradient where masking fully allows sharpen
const NR_SIGMA = 0.12;       // bilateral luma-difference sigma for noise reduction
const GRAIN_MAX = 0.12;      // grain signal amplitude at grain = 100
const GRAIN_CELL_MAX = 4;    // grain cell size (px) at grainSize = 100
```

Add interfaces + builders (after `vignetteParams`):

```ts
export interface DetailParams {
  /** High-pass gain (sharpen/100 × SHARPEN_MAX); 0 ⇒ NR-only. */
  sharpen: number;
  /** Masking strength 0..1. */
  mask: number;
  /** Noise-reduction strength 0..1. */
  nr: number;
}

export function detailParams(e: PhotoEdits | null): DetailParams | null {
  const sharpen = val(e, "sharpen");
  const nr = val(e, "noiseReduction");
  if (sharpen === 0 && nr === 0) return null;
  return {
    sharpen: (sharpen / 100) * SHARPEN_MAX,
    mask: val(e, "sharpenMask") / 100,
    nr: nr / 100,
  };
}

export interface GrainParams {
  /** Signal amplitude (grain/100 × GRAIN_MAX). */
  amount: number;
  /** Lattice cell size in px (≥1). */
  cell: number;
}

export function grainParams(e: PhotoEdits | null): GrainParams | null {
  const grain = val(e, "grain");
  if (grain === 0) return null;
  return {
    amount: (grain / 100) * GRAIN_MAX,
    cell: 1 + (val(e, "grainSize") / 100) * (GRAIN_CELL_MAX - 1),
  };
}
```

Extend `ColorModel` and `buildColorModel`:

```ts
export interface ColorModel {
  linear: LinearParams | null;
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
  detail: DetailParams | null;
  grain: GrainParams | null;
}

export function buildColorModel(e: PhotoEdits | null, toneSamples = 1024): ColorModel {
  return {
    linear: linearParams(e),
    tone: buildToneLut(e, toneSamples),
    chroma: chromaParams(e),
    vignette: vignetteParams(e),
    detail: detailParams(e),
    grain: grainParams(e),
  };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(editor): DetailParams/GrainParams model artifacts + builders"
```

---

### Task 4: Bake — spatial detail pre-pass + grain in `applyColorToRaw`

**Files:**
- Modify: `packages/shared/src/photo-color.ts` (`applyColorToRaw`, add `applyDetailAt`)
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write failing tests.** These use a 3×3 single-channel-equal RGB image; bytes chosen so the math is exactly computable (see spec).

```ts
import { applyColorToRaw, buildColorModel } from "./photo-color.js";

/** 3×3 RGB(A=none) buffer, all channels equal to the given luma byte grid. */
function img3(grid: number[]): Uint8Array {
  const b = new Uint8Array(3 * 3 * 3);
  grid.forEach((v, i) => { b[i * 3] = v; b[i * 3 + 1] = v; b[i * 3 + 2] = v; });
  return b;
}
const CENTER_BRIGHT = [102, 102, 102, 102, 153, 102, 102, 102, 102]; // (1,1)=153

describe("applyColorToRaw — detail", () => {
  it("sharpen boosts the center against its Gaussian blur (exact)", () => {
    const b = img3(CENTER_BRIGHT);
    applyColorToRaw(b, 3, 3, 3, 255, buildColorModel({ sharpen: 100 } as never));
    // center: den=0.6, blur=0.45, out=0.6+1.5*0.15=0.825 → 210
    expect(b[(1 * 3 + 1) * 3]).toBe(210);
    // top-center (1,0): blur=108.375/255, den=0.4, out=0.4-1.5*0.025 → 92
    expect(b[(0 * 3 + 1) * 3]).toBe(92);
    // corner (0,0): blur=105.1875/255, out=0.4-1.5*0.0125 → 97
    expect(b[(0 * 3 + 0) * 3]).toBe(97);
  });

  it("a flat field is unchanged by sharpen + NR + masking (identity)", () => {
    const b = img3(Array(9).fill(128));
    applyColorToRaw(b, 3, 3, 3, 255,
      buildColorModel({ sharpen: 100, noiseReduction: 100, sharpenMask: 50 } as never));
    expect([...b]).toEqual(Array(27).fill(128));
  });

  it("noise reduction pulls the center toward its neighbours", () => {
    const b = img3(CENTER_BRIGHT);
    applyColorToRaw(b, 3, 3, 3, 255, buildColorModel({ noiseReduction: 100 } as never));
    const c = b[(1 * 3 + 1) * 3]!;
    expect(c).toBeLessThan(153);     // smoothed down
    expect(c).toBeGreaterThan(120);  // edge-preserved, not collapsed to 102
  });

  it("masking reduces how hard a low-contrast point is sharpened", () => {
    const grid = [120, 120, 120, 120, 135, 120, 120, 120, 120]; // gentle center
    const open = img3(grid), masked = img3(grid);
    applyColorToRaw(open, 3, 3, 3, 255, buildColorModel({ sharpen: 100 } as never));
    applyColorToRaw(masked, 3, 3, 3, 255, buildColorModel({ sharpen: 100, sharpenMask: 100 } as never));
    const dOpen = open[(1 * 3 + 1) * 3]! - 135;
    const dMasked = masked[(1 * 3 + 1) * 3]! - 135;
    expect(dMasked).toBeLessThanOrEqual(dOpen);
  });
});

describe("applyColorToRaw — grain + gating", () => {
  it("grain perturbs a flat field but grain=0 is identity", () => {
    const flat = img3(Array(9).fill(128));
    applyColorToRaw(flat, 3, 3, 3, 255, buildColorModel({ grain: 0 } as never));
    expect([...flat]).toEqual(Array(27).fill(128)); // grain 0 → no model.grain → untouched
    const g = img3(Array(9).fill(128));
    applyColorToRaw(g, 3, 3, 3, 255, buildColorModel({ grain: 100 } as never));
    expect([...g].some((v) => v !== 128)).toBe(true);
  });
  it("an all-neutral model leaves the buffer untouched", () => {
    const b = img3([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const before = [...b];
    applyColorToRaw(b, 3, 3, 3, 255, buildColorModel(null));
    expect([...b]).toEqual(before);
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (detail/grain not applied yet).

- [ ] **Step 3: Implement.** Add the helper above `applyColorToRaw` in `photo-color.ts`:

```ts
const GW = [1, 2, 1, 2, 4, 2, 1, 2, 1];          // 3×3 Gaussian (/16)
const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/** Denoise + sharpen the pixel at (cx,cy) by reading a clamped 3×3 of `src`.
 *  `src` MUST be the pristine buffer (a snapshot), not one being mutated. */
export function applyDetailAt(
  src: Uint8Array | Uint16Array | Uint8ClampedArray,
  width: number, height: number, channels: number, inv: number,
  cx: number, cy: number, d: DetailParams,
): [number, number, number] {
  const at = (x: number, y: number): [number, number, number] => {
    const o = (y * width + x) * channels;
    return [src[o]! * inv, src[o + 1]! * inv, src[o + 2]! * inv];
  };
  const [cr, cg, cb] = at(cx, cy);
  const cl = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb;
  const sig2 = NR_SIGMA * NR_SIGMA;
  let blurR = 0, blurG = 0, blurB = 0;
  let nrR = 0, nrG = 0, nrB = 0, nrW = 0;
  let gx = 0, gy = 0;
  for (let j = -1; j <= 1; j++) {
    const ny = Math.min(height - 1, Math.max(0, cy + j));
    for (let i = -1; i <= 1; i++) {
      const nx = Math.min(width - 1, Math.max(0, cx + i));
      const [r, g, b] = at(nx, ny);
      const k = (j + 1) * 3 + (i + 1);
      const gw = GW[k]! / 16;
      blurR += gw * r; blurG += gw * g; blurB += gw * b;
      const nl = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      const bw = gw * Math.exp(-((nl - cl) * (nl - cl)) / sig2);
      nrR += bw * r; nrG += bw * g; nrB += bw * b; nrW += bw;
      gx += SOBEL_X[k]! * nl; gy += SOBEL_Y[k]! * nl;
    }
  }
  const denR = cr + (nrR / nrW - cr) * d.nr;
  const denG = cg + (nrG / nrW - cg) * d.nr;
  const denB = cb + (nrB / nrW - cb) * d.nr;
  const edge = smoothstep(MASK_LO, MASK_HI, Math.sqrt(gx * gx + gy * gy));
  const amt = d.sharpen * (1 + (edge - 1) * d.mask);
  return [denR + amt * (denR - blurR), denG + amt * (denG - blurG), denB + amt * (denB - blurB)];
}
```

Then modify `applyColorToRaw`: update destructuring + early-out, snapshot, and per-pixel read/grain. Replace the function's opening and the per-pixel `r/g/b` init, and add grain before write-back:

```ts
export function applyColorToRaw(
  buf: Uint8Array | Uint16Array | Uint8ClampedArray,
  width: number, height: number, channels: number, maxVal: number,
  model: ColorModel,
): void {
  const { linear, tone, chroma, vignette, detail, grain } = model;
  if (!linear && !tone && !chroma && !vignette && !detail && !grain) return;
  const inv = 1 / maxVal;
  // Spatial ops read ORIGINAL neighbours → snapshot before mutating in place.
  const src = detail ? (buf.slice() as typeof buf) : buf;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      let r: number, g: number, b: number;
      if (detail) {
        [r, g, b] = applyDetailAt(src, width, height, channels, inv, x, y, detail);
      } else {
        r = buf[o]! * inv; g = buf[o + 1]! * inv; b = buf[o + 2]! * inv;
      }

      // … existing linear / tone / chroma / vignette blocks unchanged …

      if (grain) {
        const delta = grain.amount * valueNoise(x, y, grain.cell);
        r += delta; g += delta; b += delta;
      }

      buf[o] = toChannel(r, maxVal);
      buf[o + 1] = toChannel(g, maxVal);
      buf[o + 2] = toChannel(b, maxVal);
    }
  }
}
```

(Keep the existing `if (linear) … if (tone) … if (chroma) … if (vignette) …` blocks exactly as they are, between the `r/g/b` init and the grain block.)

- [ ] **Step 4: Run, verify pass** — `npx vitest run photo-color.test.ts` → PASS. Then full suite: `npx vitest run` → existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(editor): bake sharpen/NR (3×3 pristine-source pass) + grain"
```

---

### Task 5: Shader — mirror detail + grain in `GlColor`

**Files:**
- Modify: `apps/web/src/features/photo-editor/render/gl-color.ts`

No unit test (GPU); correctness is the shared-math mirror + visual verification. Keep GLSL constants/weights byte-identical to `photo-color.ts`.

- [ ] **Step 1: Extend `GlColorModel`** (top of file):

```ts
import type { ChromaParams, DetailParams, GrainParams, LinearParams, ToneLut, VignetteParams } from "@lumio/shared";

export interface GlColorModel {
  linear: LinearParams | null;
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
  detail: DetailParams | null;
  grain: GrainParams | null;
}
```

- [ ] **Step 2: Add uniforms + helpers to `FRAG`.** After the existing `uniform float uVigStrength;` line add:

```glsl
uniform vec2 uResolution;
uniform bool uHasDetail;
uniform float uSharpen;   // folded high-pass gain
uniform float uMask;      // 0..1
uniform float uNr;        // 0..1
uniform bool uHasGrain;
uniform float uGrainAmount;
uniform float uGrainCell;

const float MASK_LO = 0.1;
const float MASK_HI = 0.8;
const float NR_SIGMA = 0.12;
const float GWv[9] = float[9](1.0,2.0,1.0, 2.0,4.0,2.0, 1.0,2.0,1.0);
const float SXv[9] = float[9](-1.0,0.0,1.0, -2.0,0.0,2.0, -1.0,0.0,1.0);
const float SYv[9] = float[9](-1.0,-2.0,-1.0, 0.0,0.0,0.0, 1.0,2.0,1.0);

float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

uint grainHashU(uint ix, uint iy) {
  uint n = (ix * 0x1f1f1f1fu) ^ iy;
  n = n * 0x27d4eb2du;
  n = n ^ (n >> 15u);
  return n;
}
float grainHash(int ix, int iy) {
  return float(grainHashU(uint(ix), uint(iy)) & 0xffffu) / 65536.0;
}
float smoothUnit(float t) { return t * t * (3.0 - 2.0 * t); }
float valueNoise(float x, float y, float cell) {
  float fx = x / cell, fy = y / cell;
  float ifx = floor(fx), ify = floor(fy);
  int ix = int(ifx), iy = int(ify);
  float sx = smoothUnit(fx - ifx), sy = smoothUnit(fy - ify);
  float a = mix(grainHash(ix, iy),     grainHash(ix + 1, iy),     sx);
  float b = mix(grainHash(ix, iy + 1), grainHash(ix + 1, iy + 1), sx);
  return mix(a, b, sy) * 2.0 - 1.0;
}
```

- [ ] **Step 3: Replace `main()`'s source read with the detail step, and add grain at the end.** Change the opening of `main()` from `vec4 src = texture(uImage, vUv); vec3 c = src.rgb;` to:

```glsl
  vec4 src = texture(uImage, vUv);
  vec3 c;
  if (uHasDetail) {
    vec2 texel = 1.0 / uResolution;
    vec3 ctr = src.rgb;
    float cl = lumaOf(ctr);
    float sig2 = NR_SIGMA * NR_SIGMA;
    vec3 blur = vec3(0.0);
    vec3 nrSum = vec3(0.0);
    float nrW = 0.0, gx = 0.0, gy = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        int k = (j + 1) * 3 + (i + 1);
        vec3 s = texture(uImage, vUv + vec2(float(i), float(j)) * texel).rgb;
        float gw = GWv[k] / 16.0;
        blur += gw * s;
        float nl = lumaOf(s);
        float bw = gw * exp(-((nl - cl) * (nl - cl)) / sig2);
        nrSum += bw * s; nrW += bw;
        gx += SXv[k] * nl; gy += SYv[k] * nl;
      }
    }
    vec3 den = mix(ctr, nrSum / nrW, uNr);
    float edge = smoothstep(MASK_LO, MASK_HI, sqrt(gx * gx + gy * gy));
    c = den + (uSharpen * mix(1.0, edge, uMask)) * (den - blur);
  } else {
    c = src.rgb;
  }
```

Then, immediately before the final `fragColor = vec4(clamp(c, 0.0, 1.0), src.a);`, add:

```glsl
  if (uHasGrain) {
    vec2 pix = vUv * uResolution;
    c += vec3(uGrainAmount * valueNoise(floor(pix.x), floor(pix.y), uGrainCell));
  }
```

- [ ] **Step 4: Register the uniform locations** in the constructor's `this.uniforms = { … }` object:

```ts
      uResolution: gl.getUniformLocation(this.program, "uResolution"),
      uHasDetail: gl.getUniformLocation(this.program, "uHasDetail"),
      uSharpen: gl.getUniformLocation(this.program, "uSharpen"),
      uMask: gl.getUniformLocation(this.program, "uMask"),
      uNr: gl.getUniformLocation(this.program, "uNr"),
      uHasGrain: gl.getUniformLocation(this.program, "uHasGrain"),
      uGrainAmount: gl.getUniformLocation(this.program, "uGrainAmount"),
      uGrainCell: gl.getUniformLocation(this.program, "uGrainCell"),
```

- [ ] **Step 5: Set the uniforms in `render()`** after the vignette uniform line:

```ts
    gl.uniform2f(this.uniforms.uResolution!, this.width, this.height);
    const d = model.detail;
    gl.uniform1i(this.uniforms.uHasDetail!, d ? 1 : 0);
    gl.uniform1f(this.uniforms.uSharpen!, d?.sharpen ?? 0);
    gl.uniform1f(this.uniforms.uMask!, d?.mask ?? 0);
    gl.uniform1f(this.uniforms.uNr!, d?.nr ?? 0);
    const gr = model.grain;
    gl.uniform1i(this.uniforms.uHasGrain!, gr ? 1 : 0);
    gl.uniform1f(this.uniforms.uGrainAmount!, gr?.amount ?? 0);
    gl.uniform1f(this.uniforms.uGrainCell!, gr?.cell ?? 1);
```

- [ ] **Step 6: Typecheck** — `pnpm --filter @lumio/web typecheck` (or repo equivalent) → no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/photo-editor/render/gl-color.ts
git commit -m "feat(editor): mirror sharpen/NR/grain in the GL shader"
```

---

### Task 6: Wire the model into the live preview

**Files:**
- Modify: `apps/web/src/features/photo-editor/adjusted-image.tsx`

- [ ] **Step 1: Import + build the new params** — update the import and `glModel`:

```ts
import {
  buildToneLut,
  chromaParams,
  detailParams,
  grainParams,
  linearParams,
  vignetteParams,
  type PhotoEdits,
} from "@lumio/shared";

function glModel(working: PhotoEdits): GlColorModel {
  return {
    linear: linearParams(working),
    tone: buildToneLut(working, 256),
    chroma: chromaParams(working),
    vignette: vignetteParams(working),
    detail: detailParams(working),
    grain: grainParams(working),
  };
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @lumio/web typecheck` → no errors (the panel and `sameEdits`/`coercePhotoEdits` already iterate `COLOR_FIELDS`, so sliders + clamping come for free).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/photo-editor/adjusted-image.tsx
git commit -m "feat(editor): feed detail/grain params to the live GL preview"
```

---

### Task 7: Full verification + memory

**Files:**
- Modify: `MEMORY.md`, add `…/memory/lumio-photo-editor-detail-grain.md`

- [ ] **Step 1: Run everything**

Run: `npx vitest run` (in `packages/shared`) — all green.
Run: repo typecheck + lint (`pnpm -r typecheck`, `pnpm -r lint` or configured commands) — clean.

- [ ] **Step 2: Browser-verify (manual).** Start the web app, open a photo's Edit tab, and confirm: Sharpen visibly crisps edges; Noise Reduction smooths; Masking spares flat sky; Grain adds texture and Grain Size changes its scale; Apply bakes a result that matches the live preview (especially grain orientation top/bottom and the outermost pixel rows). Note: this is the load-bearing preview==bake check the unit tests can't make.

- [ ] **Step 3: Memory note.** Write `…/memory/lumio-photo-editor-detail-grain.md` (type: project) describing the v1 single-pass detail/grain sliders, the preview==bake parity rules (texel-center sampling, shared Gaussian/Sobel/σ constants, 16-bit grain hash), and the v2/v3 deferral; add a one-line pointer to `MEMORY.md`. Link `[[lumio-photo-editor-gpu]]`.

- [ ] **Step 4: Commit**

```bash
git add MEMORY.md "$HOME/.claude/projects/-Users-gego-Developer-lumio/memory/lumio-photo-editor-detail-grain.md"
git commit -m "docs(memory): note v1 detail/grain sliders + parity rules"
```

---

## Self-review

- **Spec coverage:** 5 fields (T1) ✓; grain hash/value-noise (T2) ✓; DetailParams/GrainParams + builders + null gating (T3) ✓; bake pristine-copy + 3×3 detail + grain + early-out (T4) ✓; shader mirror + texel-center sampling + CLAMP_TO_EDGE (existing texture wrap) (T5) ✓; preview wiring (T6) ✓; UI auto-renders from `COLOR_FIELDS`, no panel change needed ✓; tests incl. edge-clamp (corner/edge exact values), masking, NR, grain determinism/identity, gating (T1–T4) ✓; no migration (all neutral 0) ✓.
- **Type consistency:** `DetailParams{sharpen,mask,nr}`, `GrainParams{amount,cell}`, `ColorModel{…,detail,grain}`, `GlColorModel{…,detail,grain}`, `applyDetailAt`, `grainHash`, `valueNoise` — names identical across shared, shader, and preview tasks. ✓
- **Placeholders:** none — every code/test step is concrete.
- **Constant parity:** `SHARPEN_MAX/MASK_LO/MASK_HI/NR_SIGMA/GRAIN_MAX/GRAIN_CELL_MAX` and `GW/SOBEL` live in `photo-color.ts`; the shader hardcodes the same `MASK_LO/MASK_HI/NR_SIGMA` + `GWv/SXv/SYv` and the same hash — follow the existing duplicate-constant pattern (e.g. vignette's `smoothstep(0.45,1.0)`); keep them in sync if tuned.
```
