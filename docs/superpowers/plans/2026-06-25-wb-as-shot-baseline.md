# White-Balance As-Shot Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every photo a per-photo white-balance baseline `(asShotTempK, asShotTint)`, estimated from its pixels at ingest, so the editor's Temperature/Tint sliders open at — and reset to — a value that reflects the photo, with zero pixel change at the default.

**Architecture:** The baseline is the WB matrix's *destination* white point. Today `adaptMatrixRgb` hard-codes `whiteXyz(6500,0)` as the destination (identity at 6500/0). We make the destination per-photo: identity at the baseline. The baseline threads as an optional `WbBaseline` param (defaulting to `{k:6500,tint:0}` ⇒ byte-for-byte today's output) through `adaptMatrixRgb` → `linearParams` → `buildColorModel`, and through the Sharp bake chain (`applyColorBake`/`buildRenditions`/`encodeEditedJpeg`/`regenerateRenditions`). Only the matrix-build sites and the editor UI's temp/tint neutral need it; `val`/`hasColor`/`sameEdits`/`coercePhotoEdits` stay untouched because the recipe stores `temperature`/`tint` ONLY when the user moves off the baseline (absent ⇒ baseline ⇒ identity). The estimate is a robust gray-world run on the small buffer ingest already decodes — no second decode, no ingest slowdown.

**Tech Stack:** TypeScript monorepo (pnpm workspaces); `@lumio/shared` (color science, vitest), `@lumio/ingest` (sharp, vitest), `@lumio/db` (Prisma 6 / Postgres), `@lumio/web` (Next 16, React).

**Spec:** `docs/superpowers/specs/2026-06-24-wb-as-shot-baseline-design.md`

---

## Key facts the implementer must know

- **DB is shared across Conductor workspaces.** NEVER run `prisma migrate dev` / `migrate reset` / anything destructive — it can wipe real photos or absorb sibling branches' migrations. Use the hand-written-SQL + `migrate deploy` recipe in Task 4.
- **Typecheck is not clean at baseline:** `packages/shared/src/calendar.ts` has pre-existing TS errors. Gate on `vitest` + `eslint`, not a clean `tsc`. For web, typecheck with `pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json` (that one runs clean) and lint with `pnpm --filter @lumio/web exec eslint <path>`.
- **Backward-compat invariant:** every new `baseline` parameter defaults to `DEFAULT_BASELINE = {k:6500,tint:0}`, and `whiteXyz(6500,0)` is exactly today's hard-coded destination — so existing callers and existing renders are unchanged.
- Test commands: `pnpm --filter @lumio/shared test`, `pnpm --filter @lumio/ingest test`.

---

## File structure

- `packages/shared/src/photo-color.ts` — add `WbBaseline`, `DEFAULT_BASELINE`, `wbBaselineOf`; baseline-aware `adaptMatrixRgb`/`linearParams`/`buildColorModel`; new `estimateAsShotWhite`.
- `packages/shared/src/types.ts` — add `asShotTempK`/`asShotTint` to `PhotoDTO`.
- `packages/db/prisma/schema.prisma` (+ hand-written migration) — two nullable `Float` columns.
- `packages/db/src/mappers.ts` — map the two columns into the DTO.
- `packages/ingest/src/wb-estimate.ts` (new) — decode-the-thumbnail wrapper around `estimateAsShotWhite`.
- `packages/ingest/src/process.ts` / `store.ts` — compute + persist the baseline at ingest.
- `packages/ingest/src/color-bake.ts` / `renditions.ts` / `regenerate.ts` — thread baseline into the bake.
- `apps/web/.../server/photo-edits-service.ts`, `.../photos/[id]/edited/route.ts`, `lib/server/download-archive.ts` — pass the photo's baseline to the bake.
- `apps/web/.../use-edit-session.tsx`, `adjusted-image.tsx`, `base-image-stage.tsx`, `edited-result.tsx`, `zoomable-image.tsx`, `lightbox-edit-panel.tsx` — thread baseline to the GL preview + slider neutral.

---

## Task 1: Baseline-aware white-balance matrix (shared)

**Files:**
- Modify: `packages/shared/src/photo-color.ts`
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/photo-color.test.ts` (it already imports from `./photo-color.js` and has the `px` helper). Add the new imports `DEFAULT_BASELINE`, `wbBaselineOf`, and a `WbBaseline` type import, then:

```ts
describe("white-balance baseline", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };

  it("DEFAULT_BASELINE is 6500K / 0 tint", () => {
    expect(DEFAULT_BASELINE).toEqual({ k: 6500, tint: 0 });
  });

  it("absent temperature + custom baseline ⇒ identity (no pixel change)", () => {
    const model = buildColorModel(base, 1024, { k: 5200, tint: 30 });
    expect(model.linear).toBeNull(); // identity ⇒ null linear pre-pass
  });

  it("temperature === baseline.k ⇒ identity", () => {
    const model = buildColorModel({ ...base, temperature: 5200 }, 1024, { k: 5200, tint: 0 });
    expect(model.linear).toBeNull();
  });

  it("default-baseline output is unchanged from today (no baseline arg)", () => {
    // A warm edit with no baseline must match the same edit with DEFAULT_BASELINE.
    const a = buildColorModel({ ...base, temperature: 4000 });
    const b = buildColorModel({ ...base, temperature: 4000 }, 1024, DEFAULT_BASELINE);
    expect(a.linear?.m).toEqual(b.linear?.m);
  });

  it("slider above baseline warms; below cools (grey pixel)", () => {
    // baseline 5000; push slider to 8000 ⇒ warmer ⇒ R > B.
    const warm = new Uint8Array([128, 128, 128]);
    applyColorToRaw(warm, 1, 1, 3, 255, buildColorModel({ ...base, temperature: 8000 }, 1024, { k: 5000, tint: 0 }));
    expect(warm[0]!).toBeGreaterThan(warm[2]!);
    const cool = new Uint8Array([128, 128, 128]);
    applyColorToRaw(cool, 1, 1, 3, 255, buildColorModel({ ...base, temperature: 3000 }, 1024, { k: 5000, tint: 0 }));
    expect(cool[2]!).toBeGreaterThan(cool[0]!);
  });

  it("wbBaselineOf falls back to neutral on null/absent", () => {
    expect(wbBaselineOf({ asShotTempK: null, asShotTint: null })).toEqual({ k: 6500, tint: 0 });
    expect(wbBaselineOf({})).toEqual({ k: 6500, tint: 0 });
    expect(wbBaselineOf({ asShotTempK: 5200, asShotTint: -20 })).toEqual({ k: 5200, tint: -20 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/shared test -- photo-color`
Expected: FAIL — `DEFAULT_BASELINE`/`wbBaselineOf` are not exported; `buildColorModel`/baseline behavior not implemented.

- [ ] **Step 3: Implement the baseline type + helpers**

In `packages/shared/src/photo-color.ts`, just after the `NEUTRAL` export (around line 46), add:

```ts
/** A photo's white-balance baseline: the Temperature(K)/Tint at which the WB
 *  matrix is identity (the as-shot anchor). Estimated at ingest. */
export interface WbBaseline {
  k: number;
  tint: number;
}

/** The global default baseline — identical to the pre-baseline behaviour
 *  (identity at 6500K / 0 tint). Used whenever a photo has no estimated baseline. */
export const DEFAULT_BASELINE: WbBaseline = { k: NEUTRAL_K, tint: 0 };

/** Build a baseline from a photo row / DTO. null/absent columns ⇒ neutral. */
export function wbBaselineOf(p: { asShotTempK?: number | null; asShotTint?: number | null }): WbBaseline {
  return { k: p.asShotTempK ?? NEUTRAL_K, tint: p.asShotTint ?? 0 };
}
```

(`NEUTRAL_K` is defined at line 56; these exports may sit just below it instead if the implementer prefers — keep them above `adaptMatrixRgb`.)

- [ ] **Step 4: Make `adaptMatrixRgb` target the baseline**

Replace the body of `adaptMatrixRgb` (currently lines ~202-210) with:

```ts
/** Linear-sRGB chromatic-adaptation matrix that re-balances the image as if its
 *  neutral were lit at `K`/`tint`, normalized back to the BASELINE white. Identity
 *  at (baseline.k, baseline.tint). Higher K ⇒ bluer source ⇒ warmer result. */
function adaptMatrixRgb(K: number, tint: number, baseline: WbBaseline = DEFAULT_BASELINE): M3 {
  const ws = whiteXyz(K, tint);
  const wd = whiteXyz(baseline.k, baseline.tint);
  const cs = m3vec(BRADFORD, ws);
  const cd = m3vec(BRADFORD, wd);
  const D: M3 = [cd[0]! / cs[0]!, 0, 0, 0, cd[1]! / cs[1]!, 0, 0, 0, cd[2]! / cs[2]!];
  const mXyz = m3mul(BRADFORD_INV, m3mul(D, BRADFORD));
  return m3mul(XYZ2RGB, m3mul(mXyz, RGB2XYZ));
}
```

- [ ] **Step 5: Make `linearParams` baseline-aware**

Replace `linearParams` (currently lines ~220-236) with:

```ts
export function linearParams(
  e: PhotoEdits | null,
  baseline: WbBaseline = DEFAULT_BASELINE,
): LinearParams | null {
  const ev = val(e, "exposure");
  // Temperature/tint default to the photo's baseline when absent — so an unedited
  // photo (no temperature key) is identity, NOT a shift toward 6500.
  const K = e?.temperature ?? baseline.k;
  const tint = e?.tint ?? baseline.tint;
  const wbActive = K !== baseline.k || tint !== baseline.tint;
  if (ev === 0 && !wbActive) return null;
  const r: M3 = wbActive ? adaptMatrixRgb(K, tint, baseline) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const s = Math.pow(2, ev); // exposure in stops → linear scale
  // fold exposure (uniform scale) and transpose row-major → column-major
  return {
    m: [
      r[0]! * s, r[3]! * s, r[6]! * s,
      r[1]! * s, r[4]! * s, r[7]! * s,
      r[2]! * s, r[5]! * s, r[8]! * s,
    ],
  };
}
```

- [ ] **Step 6: Forward the baseline through `buildColorModel`**

Replace `buildColorModel` (currently lines ~355-362) with:

```ts
export function buildColorModel(
  e: PhotoEdits | null,
  toneSamples = 1024,
  baseline: WbBaseline = DEFAULT_BASELINE,
): ColorModel {
  return {
    linear: linearParams(e, baseline),
    tone: buildToneLut(e, toneSamples),
    chroma: chromaParams(e),
    vignette: vignetteParams(e),
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/shared test -- photo-color`
Expected: PASS (all new tests + the existing suite — backward-compat is exact).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(shared): per-photo white-balance baseline in the color matrix"
```

---

## Task 2: Estimate the as-shot white from pixels (shared)

**Files:**
- Modify: `packages/shared/src/photo-color.ts`
- Test: `packages/shared/src/photo-color.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/photo-color.test.ts` (import `estimateAsShotWhite`). The round-trip uses the forward color science as ground truth:

```ts
describe("estimateAsShotWhite", () => {
  // Fill a w×h RGB buffer with one sRGB-byte colour.
  const fill = (r: number, g: number, b: number, w = 8, h = 8): Uint8Array => {
    const buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b; }
    return buf;
  };

  it("a neutral grey buffer estimates ≈ 6500K / 0 tint", () => {
    const wb = estimateAsShotWhite(fill(128, 128, 128), 8, 8, 3)!;
    expect(wb).not.toBeNull();
    expect(wb.k).toBeGreaterThan(6000);
    expect(wb.k).toBeLessThan(7000);
    expect(Math.abs(wb.tint)).toBeLessThan(15);
  });

  it("an orange-cast (warm-looking) buffer estimates a LOW K", () => {
    const wb = estimateAsShotWhite(fill(190, 140, 90), 8, 8, 3)!;
    expect(wb.k).toBeLessThan(5500);
  });

  it("a blue-cast (cool-looking) buffer estimates a HIGH K", () => {
    const wb = estimateAsShotWhite(fill(90, 140, 190), 8, 8, 3)!;
    expect(wb.k).toBeGreaterThan(7500);
  });

  it("round-trips a known baseline through whiteXyz at the default (slider==baseline ⇒ identity)", () => {
    // Build the grey whose chromaticity IS the estimated baseline, then confirm
    // editing at temperature=k is identity for that baseline.
    const wb = estimateAsShotWhite(fill(170, 150, 120), 8, 8, 3)!;
    const model = buildColorModel({ rotate: 0, flipH: false, flipV: false, temperature: wb.k, tint: wb.tint }, 1024, wb);
    expect(model.linear).toBeNull(); // editing exactly to the estimate is the identity
  });

  it("returns null when there are no usable pixels (all black)", () => {
    expect(estimateAsShotWhite(fill(0, 0, 0), 8, 8, 3)).toBeNull();
  });

  it("ignores a saturated minority and follows the neutral majority", () => {
    // 60 grey pixels + 4 fully-saturated red ⇒ still ≈ neutral.
    const buf = fill(128, 128, 128, 8, 8);
    for (let i = 0; i < 4; i++) { buf[i * 3] = 255; buf[i * 3 + 1] = 0; buf[i * 3 + 2] = 0; }
    const wb = estimateAsShotWhite(buf, 8, 8, 3)!;
    expect(wb.k).toBeGreaterThan(5800);
    expect(wb.k).toBeLessThan(7200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/shared test -- photo-color`
Expected: FAIL — `estimateAsShotWhite` is not exported.

- [ ] **Step 3: Implement `estimateAsShotWhite`**

Add to `packages/shared/src/photo-color.ts` (near the WB math; it reuses the private `planckUv`, `srgbToLinear`, `RGB2XYZ`, `DUV_MAX`, `TINT_SIGN`, `TINT_RANGE`):

```ts
/** McCamy's correlated-colour-temperature approximation from CIE 1931 xy. */
function cctFromXy(x: number, y: number): number {
  const n = (x - 0.3320) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

/**
 * Estimate a photo's as-shot white `(k, tint)` from a small decoded RGB buffer
 * (robust gray-world). Because the editor default is identity-at-baseline, a
 * rough estimate only changes the slider's anchor number, never the pixels — so
 * this is deliberately simple. Returns null when no usable (near-neutral, non-
 * black, non-clipped) pixels exist. `channels` may be 3 (RGB) or 4 (RGBA).
 */
export function estimateAsShotWhite(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
): WbBaseline | null {
  const inv = 1 / 255;
  let sr = 0, sg = 0, sb = 0, wsum = 0;
  for (let i = 0; i + channels <= rgb.length; i += channels) {
    const r = rgb[i]! * inv, g = rgb[i + 1]! * inv, b = rgb[i + 2]! * inv;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 0.02 || luma > 0.98) continue;        // drop near-black / near-clipped
    const sat = mx <= 0 ? 0 : (mx - mn) / mx;
    if (sat > 0.6) continue;                          // drop strongly-coloured pixels
    const w = 1 - sat;                                // weight toward neutral pixels
    sr += srgbToLinear(r) * w;
    sg += srgbToLinear(g) * w;
    sb += srgbToLinear(b) * w;
    wsum += w;
  }
  if (wsum < 1e-6) return null;
  const lr = sr / wsum, lg = sg / wsum, lb = sb / wsum;

  // linear RGB average → XYZ → chromaticity.
  const X = RGB2XYZ[0]! * lr + RGB2XYZ[1]! * lg + RGB2XYZ[2]! * lb;
  const Y = RGB2XYZ[3]! * lr + RGB2XYZ[4]! * lg + RGB2XYZ[5]! * lb;
  const Z = RGB2XYZ[6]! * lr + RGB2XYZ[7]! * lg + RGB2XYZ[8]! * lb;
  const sum = X + Y + Z;
  if (sum <= 0) return null;
  const x = X / sum, y = Y / sum;

  let k = cctFromXy(x, y);
  if (!Number.isFinite(k)) return null;
  k = Math.max(2000, Math.min(11000, k));

  // Tint = signed Duv from the locus at k, inverted through whiteXyz's mapping.
  const denom = -2 * x + 12 * y + 3;
  const u = (4 * x) / denom, v = (6 * y) / denom;
  const [u0, v0] = planckUv(k);
  const [u1, v1] = planckUv(k * 1.0001);
  const [u2, v2] = planckUv(k * 0.9999);
  let tu = u1 - u2, tv = v1 - v2;
  const len = Math.hypot(tu, tv) || 1e-9;
  tu /= len; tv /= len;
  // whiteXyz offsets along the normal (-tv, tu) by `off = TINT_SIGN*(tint/TINT_RANGE)*DUV_MAX`.
  const duv = (u - u0) * -tv + (v - v0) * tu;
  let tint = TINT_SIGN * (duv / DUV_MAX) * TINT_RANGE;
  tint = Math.max(-150, Math.min(150, tint));

  return { k, tint };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/shared test -- photo-color`
Expected: PASS. If the orange/blue K-direction assertions fail, the `cctFromXy`/Duv math is wrong — fix here, not by loosening the test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/photo-color.ts packages/shared/src/photo-color.test.ts
git commit -m "feat(shared): estimateAsShotWhite (robust gray-world → K/tint)"
```

---

## Task 3: Add baseline columns to the DTO type (shared)

**Files:**
- Modify: `packages/shared/src/types.ts:84-103`

- [ ] **Step 1: Add the two fields to `PhotoDTO`**

In `packages/shared/src/types.ts`, inside `interface PhotoDTO`, immediately after the `edits: PhotoEdits | null;` line (line 98), add:

```ts
  /** As-shot white-balance baseline (estimated at ingest). null = use 6500K/0
   *  (the WB matrix's default identity point). Drives the editor's Temp/Tint
   *  default + reset; non-destructive at the default. */
  asShotTempK: number | null;
  asShotTint: number | null;
```

- [ ] **Step 2: Verify shared still compiles its tests**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (type-only addition; no runtime change).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): PhotoDTO carries the as-shot WB baseline"
```

---

## Task 4: Database columns + migration + mapper (db)

**Files:**
- Modify: `packages/db/prisma/schema.prisma:69-101`
- Create: `packages/db/prisma/migrations/20260625120000_add_photo_as_shot_wb/migration.sql`
- Modify: `packages/db/src/mappers.ts:13-32` and `:34-53`

- [ ] **Step 1: Add the columns to the Prisma schema**

In `packages/db/prisma/schema.prisma`, inside `model Photo`, add after the `edits` line (line 88):

```prisma
  asShotTempK    Float? // estimated as-shot white-balance temperature (K); null = use 6500
  asShotTint     Float? // estimated as-shot tint (green−/magenta+); null = use 0
```

- [ ] **Step 2: Hand-write the migration SQL (do NOT use `migrate dev`)**

Create `packages/db/prisma/migrations/20260625120000_add_photo_as_shot_wb/migration.sql` with exactly:

```sql
-- AddAsShotWhiteBalance
ALTER TABLE "Photo" ADD COLUMN "asShotTempK" DOUBLE PRECISION;
ALTER TABLE "Photo" ADD COLUMN "asShotTint" DOUBLE PRECISION;
```

(`Float?` ⇒ nullable `DOUBLE PRECISION`.)

- [ ] **Step 3: Check migration status, then apply non-destructively**

Run:
```bash
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate status
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma generate
```
Expected: `migrate deploy` applies `20260625120000_add_photo_as_shot_wb` (and only that, plus any already-applied). It NEVER resets. If `status` shows drift from sibling branches, do NOT reset and do NOT copy their migrations in — just `migrate deploy` your own and `generate`.

- [ ] **Step 4: Verify the columns are live**

Run:
```bash
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='Photo' AND column_name IN ('asShotTempK','asShotTint');
SQL
```
Expected: both column names listed.

- [ ] **Step 5: Map the columns in `toPhotoDTO` and `toTrashedPhotoDTO`**

In `packages/db/src/mappers.ts`, in `toPhotoDTO` add after the `edits:` line (line 27):

```ts
    asShotTempK: row.asShotTempK,
    asShotTint: row.asShotTint,
```

In `toTrashedPhotoDTO` add after its `edits: null,` line (line 48) — TrashedPhoto has no such columns:

```ts
    asShotTempK: null,
    asShotTint: null,
```

- [ ] **Step 6: Verify the working tree contains ONLY this feature's schema/migration change**

Run: `git status --porcelain packages/db`
Expected: only `schema.prisma`, the new migration dir, and `mappers.ts`. If a sibling branch's migration appears, remove it (do not commit it).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260625120000_add_photo_as_shot_wb packages/db/src/mappers.ts
git commit -m "feat(db): asShotTempK/asShotTint columns + DTO mapping"
```

---

## Task 5: Ingest estimation wrapper (ingest)

**Files:**
- Create: `packages/ingest/src/wb-estimate.ts`
- Create: `packages/ingest/src/wb-estimate.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/wb-estimate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { estimateAsShotFromImage } from "./wb-estimate.js";

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: { r, g, b } } }).webp().toBuffer();

describe("estimateAsShotFromImage", () => {
  it("estimates ≈ neutral for a grey image", async () => {
    const wb = (await estimateAsShotFromImage(await solid(128, 128, 128)))!;
    expect(wb).not.toBeNull();
    expect(wb.k).toBeGreaterThan(6000);
    expect(wb.k).toBeLessThan(7000);
  });

  it("estimates a low K for a warm image and handles RGBA", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 190, g: 140, b: 90, alpha: 1 } } }).png().toBuffer();
    const wb = (await estimateAsShotFromImage(png))!;
    expect(wb.k).toBeLessThan(5500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/ingest test -- wb-estimate`
Expected: FAIL — module `./wb-estimate.js` does not exist.

- [ ] **Step 3: Implement the wrapper**

Create `packages/ingest/src/wb-estimate.ts`:

```ts
import sharp from "sharp";
import { estimateAsShotWhite, type WbBaseline } from "@lumio/shared";

/**
 * Estimate a photo's as-shot white balance from an image (Buffer or path). Decodes
 * a ≤128px raw RGB thumbnail of an ALREADY-small input (the ingest thumbnail), so
 * this adds a single tiny decode — no full-resolution re-decode. Returns null when
 * the image has no usable near-neutral pixels.
 */
export async function estimateAsShotFromImage(image: string | Buffer): Promise<WbBaseline | null> {
  try {
    const { data, info } = await sharp(image)
      .resize(128, 128, { fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return estimateAsShotWhite(new Uint8Array(data), info.width, info.height, info.channels);
  } catch {
    return null; // a bad/odd image must never block ingest
  }
}
```

- [ ] **Step 4: Export it**

In `packages/ingest/src/index.ts`, add after the `./regenerate.js` line:

```ts
export * from "./wb-estimate.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/ingest test -- wb-estimate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/wb-estimate.ts packages/ingest/src/wb-estimate.test.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): estimateAsShotFromImage wrapper"
```

---

## Task 6: Compute + persist the baseline at ingest (ingest)

**Files:**
- Modify: `packages/ingest/src/process.ts`
- Modify: `packages/ingest/src/store.ts`
- Test: `packages/ingest/src/store.test.ts`

- [ ] **Step 1: Write the failing test**

`store.test.ts` already exercises `storePhoto`. Add a test that the baseline columns are written. Inspect the existing test's `db` mock / `ProcessedPhoto` factory and follow it; the assertion is:

```ts
it("persists the as-shot baseline on create", async () => {
  // build `input` exactly as the other storePhoto tests do, but set:
  //   input.processed.asShot = { k: 5200, tint: -10 }
  // then after storePhoto(input, deps):
  expect(upsertArg.create).toMatchObject({ asShotTempK: 5200, asShotTint: -10 });
  expect(upsertArg.update).toMatchObject({ asShotTempK: 5200, asShotTint: -10 });
});
```

(Use the same mock-capture pattern the file already uses for `db.photo.upsert`. If `asShot` is absent, both should be `null`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lumio/ingest test -- store`
Expected: FAIL — `ProcessedPhoto` has no `asShot`; columns not written.

- [ ] **Step 3: Add `asShot` to `ProcessedPhoto` and compute it in `processImage`**

In `packages/ingest/src/process.ts`:

Add the import:
```ts
import { estimateAsShotFromImage } from "./wb-estimate.js";
import type { ExifData, WbBaseline } from "@lumio/shared";
```
(merge `WbBaseline` into the existing `@lumio/shared` type import; it already imports `ExifData`.)

Add to the `ProcessedPhoto` interface:
```ts
  asShot: WbBaseline | null;
```

In `processImage`, after `const hash = hashBuffer(original);`, compute the baseline from the already-built thumbnail and include it:
```ts
    const asShot = await estimateAsShotFromImage(thumbnail);

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display, asShot };
```

- [ ] **Step 4: Persist the columns in `storePhoto`**

In `packages/ingest/src/store.ts`, inside the `data` object (after `exif: processed.exif as object,`), add:

```ts
    // As-shot WB baseline (estimated at ingest). On re-import the update path also
    // clears `edits` (below), so a recomputed baseline always lands on an unedited
    // photo — the recipe stays consistent with its anchor.
    asShotTempK: processed.asShot?.k ?? null,
    asShotTint: processed.asShot?.tint ?? null,
```

(`...data` is spread into both `create` and `update`, so both paths get the columns.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/ingest test -- store`
Expected: PASS. Also run `pnpm --filter @lumio/ingest test -- process` if a process test exists.

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/process.ts packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "feat(ingest): estimate + persist the as-shot baseline on ingest"
```

---

## Task 7: Thread the baseline through the Sharp bake (ingest)

**Files:**
- Modify: `packages/ingest/src/color-bake.ts`
- Modify: `packages/ingest/src/renditions.ts`
- Modify: `packages/ingest/src/regenerate.ts`
- Test: `packages/ingest/src/color-bake.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ingest/src/color-bake.test.ts` (it has `grey`/`meanR` helpers; import `wbBaselineOf` is not needed — pass a literal baseline):

```ts
it("at the baseline, a temperature edit is identity (no channel shift)", async () => {
  // temperature === baseline.k ⇒ WB matrix identity ⇒ grey stays grey.
  const out = await applyColorBake(
    grey(128),
    { rotate: 0, flipH: false, flipV: false, temperature: 5200 },
    { k: 5200, tint: 0 },
  );
  const s = (await out.stats()).channels;
  expect(Math.abs(s[0]!.mean - s[2]!.mean)).toBeLessThan(1.5);
});

it("a temperature above the baseline warms (R > B)", async () => {
  const out = await applyColorBake(
    grey(128),
    { rotate: 0, flipH: false, flipV: false, temperature: 9000 },
    { k: 5000, tint: 0 },
  );
  const s = (await out.stats()).channels;
  expect(s[0]!.mean).toBeGreaterThan(s[2]!.mean);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lumio/ingest test -- color-bake`
Expected: FAIL — `applyColorBake` takes only 2 args; the 3rd is ignored, so `temperature:5200` shifts toward 6500 (not identity).

- [ ] **Step 3: Add the baseline param to `applyColorBake`**

In `packages/ingest/src/color-bake.ts`, change the import and signature:

```ts
import { applyColorToRaw, buildColorModel, DEFAULT_BASELINE, hasColor, type PhotoEdits, type WbBaseline } from "@lumio/shared";
```

```ts
export async function applyColorBake(
  img: Sharp,
  edits: PhotoEdits | null,
  baseline: WbBaseline = DEFAULT_BASELINE,
): Promise<Sharp> {
  if (!hasColor(edits)) return img;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const model = buildColorModel(edits, 1024, baseline);
  applyColorToRaw(data, info.width, info.height, info.channels, 255, model);
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}
```

- [ ] **Step 4: Thread baseline through `buildRenditions` and `encodeEditedJpeg`**

In `packages/ingest/src/renditions.ts`:

Add to the `@lumio/shared` import: `DEFAULT_BASELINE`, `type WbBaseline`.

`buildRenditions` — add the param and pass it to the bake:
```ts
export async function buildRenditions(
  input: RenditionInput,
  edits: PhotoEdits | null,
  baseline: WbBaseline = DEFAULT_BASELINE,
): Promise<Renditions> {
```
and change the `applyColorBake(framed, edits)` call (line ~120) to:
```ts
  const baked = await applyColorBake(framed, edits, baseline);
```

`encodeEditedJpeg` — add the param and pass it:
```ts
export async function encodeEditedJpeg(
  input: RenditionInput,
  edits: PhotoEdits | null,
  baseline: WbBaseline = DEFAULT_BASELINE,
): Promise<Buffer> {
```
and change its `applyColorBake(framed, edits)` (line ~85) to:
```ts
  const baked = await applyColorBake(framed, edits, baseline);
```
(The no-edit early-return path in `encodeEditedJpeg` is unaffected — no color to bake.)

- [ ] **Step 5: Thread baseline through `regenerateRenditions`**

In `packages/ingest/src/regenerate.ts`:

Add to imports: `import { DEFAULT_BASELINE, type PhotoEdits, type WbBaseline } from "@lumio/shared";` (replace the existing type-only `PhotoEdits` import).

Add the param and pass it to the EDITED rendition build (the edit-free base needs none):
```ts
export async function regenerateRenditions(
  absPath: string,
  edits: PhotoEdits | null,
  id: string,
  deps: RegenerateDeps,
  baseline: WbBaseline = DEFAULT_BASELINE,
): Promise<{ thumbhash: string; width: number; height: number }> {
```
and change `const edited = await buildRenditions(decoded.input, edits);` (line ~39) to:
```ts
      const edited = await buildRenditions(decoded.input, edits, baseline);
```

- [ ] **Step 6: Run the ingest suite to verify it passes**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS (new color-bake tests + the existing renditions/regenerate suites — all default-baseline callers are unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/ingest/src/color-bake.ts packages/ingest/src/renditions.ts packages/ingest/src/regenerate.ts packages/ingest/src/color-bake.test.ts
git commit -m "feat(ingest): thread the WB baseline through the bake chain"
```

---

## Task 8: Pass the baseline to the server bake paths (web server)

**Files:**
- Modify: `apps/web/src/features/photo-editor/server/photo-edits-service.ts:30-39`
- Modify: `apps/web/src/app/api/c/[catalog]/photos/[id]/edited/route.ts:18`
- Modify: `apps/web/src/lib/server/download-archive.ts:109`

- [ ] **Step 1: `applyPhotoEdits` — pass the photo's baseline to `regenerateRenditions`**

In `photo-edits-service.ts`, add `wbBaselineOf` to the `@lumio/shared` import, then change the `regenerateRenditions(...)` call to pass the baseline derived from the already-fetched `photo` row:

```ts
  const { thumbhash, width, height } = await regenerateRenditions(
    originalPath(catalog, photo.path),
    recipe,
    id,
    catalogCacheDirs(catalog.id),
    wbBaselineOf(photo),
  );
```

- [ ] **Step 2: Edited-download route — pass the baseline**

In `.../photos/[id]/edited/route.ts`, `photo` is a `PhotoDTO` from `getPhoto` (now carries the columns). Add `wbBaselineOf` to a `@lumio/shared` import and change line 18:

```ts
    const jpeg = await encodeEditedJpeg(decoded.input, photo.edits, wbBaselineOf(photo));
```

- [ ] **Step 3: Zip download — pass the baseline**

In `lib/server/download-archive.ts`, add `wbBaselineOf` to the `@lumio/shared` import and change the `encodeEditedJpeg` call (line ~109):

```ts
              const jpeg = await encodeEditedJpeg(decoded.input, recipe, wbBaselineOf(photo));
```

Then confirm the `photos` the archive iterates carry `asShotTempK`/`asShotTint`: open the caller that builds `photos` for `buildDownloadArchive` and ensure its Prisma query either selects all Photo columns or explicitly includes `asShotTempK`/`asShotTint`. If it uses an explicit `select`, add the two columns. (If absent, `wbBaselineOf` falls back to neutral — safe, but the download then won't honor the baseline.)

- [ ] **Step 4: Typecheck + lint the web changes**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json
pnpm --filter @lumio/web exec eslint apps/web/src/features/photo-editor/server/photo-edits-service.ts apps/web/src/app/api/c/[catalog]/photos/[id]/edited/route.ts apps/web/src/lib/server/download-archive.ts
```
Expected: 0 errors.

- [ ] **Step 5: Run the download-archive test**

Run: `pnpm --filter @lumio/web test -- download-archive`
Expected: PASS (the `encodeEditedJpeg` mock ignores the extra arg).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/photo-editor/server/photo-edits-service.ts "apps/web/src/app/api/c/[catalog]/photos/[id]/edited/route.ts" apps/web/src/lib/server/download-archive.ts
git commit -m "feat(web): server bakes honor the per-photo WB baseline"
```

---

## Task 9: Thread the baseline to the GL preview (web client)

**Files:**
- Modify: `apps/web/src/features/photo-editor/adjusted-image.tsx`
- Modify: `apps/web/src/features/photo-editor/base-image-stage.tsx`
- Modify: `apps/web/src/features/photo-editor/use-edit-session.tsx`
- Modify: `apps/web/src/features/photo-editor/edited-result.tsx`
- Modify: `apps/web/src/features/photo-editor/zoomable-image.tsx`

- [ ] **Step 1: Expose `baseline` from the edit session**

In `use-edit-session.tsx`:

Add to the `@lumio/shared` import: `wbBaselineOf`, `type WbBaseline`. Add `useMemo` to the React import.

Add to `interface EditSessionValue` (e.g. after `saved: PhotoEdits;`):
```ts
  /** The photo's as-shot WB baseline: the Temp/Tint where the WB matrix is identity. */
  baseline: WbBaseline;
```

Inside `EditSessionProvider`, after `const saved = photo.edits ?? NO_EDITS;`:
```ts
  const baseline = useMemo(
    () => wbBaselineOf(photo),
    [photo.asShotTempK, photo.asShotTint],
  );
```

Add `baseline,` to the `value` object (around line 401).

- [ ] **Step 2: Use the baseline as the temp/tint neutral in the session**

Still in `use-edit-session.tsx`, add a helper above the callbacks:
```ts
  const neutralFor = useCallback(
    (key: ColorKey): number =>
      key === "temperature" ? baseline.k
      : key === "tint" ? baseline.tint
      : COLOR_FIELDS.find((f) => f.key === key)?.neutral ?? 0,
    [baseline],
  );
```
Replace the `const neutral = COLOR_FIELDS.find((f) => f.key === key)?.neutral ?? 0;` line inside BOTH `setColorLive` and `setColor` with `const neutral = neutralFor(key);`, and add `neutralFor` to each callback's dependency array.

(Result: dragging Temperature exactly to `baseline.k` removes the field ⇒ absent ⇒ identity ⇒ `hasColor` stays false. No change needed to `hasColor`/`sameEdits`/`coercePhotoEdits`.)

- [ ] **Step 3: Add a `baseline` prop to `AdjustedImage` and feed `glModel`**

In `adjusted-image.tsx`:

Update imports:
```ts
import {
  buildToneLut,
  chromaParams,
  linearParams,
  vignetteParams,
  DEFAULT_BASELINE,
  type PhotoEdits,
  type WbBaseline,
} from "@lumio/shared";
```

Change `glModel`:
```ts
function glModel(working: PhotoEdits, baseline: WbBaseline): GlColorModel {
  return {
    linear: linearParams(working, baseline),
    tone: buildToneLut(working, 256),
    chroma: chromaParams(working),
    vignette: vignetteParams(working),
  };
}
```

Add `baseline` to the prop list (default `DEFAULT_BASELINE` so the component stays drop-in):
```ts
  working,
  baseline = DEFAULT_BASELINE,
  onNaturalSize,
```
and in the prop type:
```ts
  working: PhotoEdits;
  baseline?: WbBaseline;
```

Change the memo:
```ts
  const model = useMemo(() => glModel(working, baseline), [working, baseline]);
```

- [ ] **Step 4: Pass `baseline` through `BaseImageStage`**

In `base-image-stage.tsx`:

Add to imports: `DEFAULT_BASELINE`, `type WbBaseline`.

Add the prop (default keeps it optional):
```ts
  working,
  baseline = DEFAULT_BASELINE,
  onNaturalSize,
```
and the type:
```ts
  working: PhotoEdits;
  baseline?: WbBaseline;
```
Pass it down on the `<AdjustedImage ... working={working} baseline={baseline} ... />`.

- [ ] **Step 5: Pass `baseline` at the two `BaseImageStage` render sites**

`edited-result.tsx` and `zoomable-image.tsx` both render `<BaseImageStage .../>`. They already consume the edit session — add `baseline` to their `useEditSession()` destructure and forward it.

- In `edited-result.tsx`, `EditedResult` currently receives `working` as a prop. Add `baseline` to its props (type `WbBaseline`, import from `@lumio/shared`) and pass `baseline={baseline}` to `<BaseImageStage>` (line ~95). Then update `EditedResult`'s caller to pass `baseline` from `useEditSession()`. (Search `apps/web/src` for `<EditedResult` to find the caller.)
- In `zoomable-image.tsx`, find where it pulls values from `useEditSession()` and add `baseline`; pass `baseline={baseline}` to `<BaseImageStage>` (line ~421).

If a render site does not use `useEditSession` directly, thread `baseline` from whichever ancestor does (mirroring how `working`/`orientedBase` already flow).

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json
pnpm --filter @lumio/web exec eslint apps/web/src/features/photo-editor/adjusted-image.tsx apps/web/src/features/photo-editor/base-image-stage.tsx apps/web/src/features/photo-editor/use-edit-session.tsx apps/web/src/features/photo-editor/edited-result.tsx apps/web/src/features/photo-editor/zoomable-image.tsx
```
Expected: 0 errors. (Watch the React-Compiler rules: `neutralFor`/`baseline` must be in the relevant `useCallback`/`useMemo` deps.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/photo-editor/adjusted-image.tsx apps/web/src/features/photo-editor/base-image-stage.tsx apps/web/src/features/photo-editor/use-edit-session.tsx apps/web/src/features/photo-editor/edited-result.tsx apps/web/src/features/photo-editor/zoomable-image.tsx
git commit -m "feat(web): GL preview uses the per-photo WB baseline"
```

---

## Task 10: Editor panel opens/resets Temp & Tint at the baseline (web client)

**Files:**
- Modify: `apps/web/src/features/photo-editor/lightbox-edit-panel.tsx:230-270`

- [ ] **Step 1: Read `baseline` from the session and use it as the temp/tint neutral**

In `lightbox-edit-panel.tsx`, add `baseline` to the `useEditSession()` destructure (around line 40). Then in the `COLOR_FIELDS.map((f) => { ... })` block (line 244), replace the `const value = working[f.key] ?? f.neutral;` line with a baseline-aware neutral:

```ts
        {COLOR_FIELDS.map((f) => {
          const neutral =
            f.key === "temperature" ? baseline.k
            : f.key === "tint" ? baseline.tint
            : f.neutral;
          const value = working[f.key] ?? neutral;
          return (
```

And in the reset button's `onClick` (line 254), reset to that neutral instead of `f.neutral`:

```ts
                  onClick={() => setColor(f.key, neutral)}
```

(The readout `{f.precision ? value.toFixed(f.precision) : value}` and the `<Slider value={[value]} .../>` then naturally show the baseline as the resting value.)

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json
pnpm --filter @lumio/web exec eslint apps/web/src/features/photo-editor/lightbox-edit-panel.tsx
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/photo-editor/lightbox-edit-panel.tsx
git commit -m "feat(web): Temp/Tint sliders open + reset at the as-shot baseline"
```

---

## Task 11: Optional one-off backfill for existing UNEDITED photos

**Files:**
- Create: `packages/ingest/src/backfill-baseline.ts` (a small exported function), wired into the existing rescan/maintenance entry if there is one; otherwise a `tsx` script.

> Skip this task if the team is happy for baselines to appear only as photos are (re)ingested. Existing photos with `null` baselines already render exactly as today.

- [ ] **Step 1: Implement a guarded backfill**

Create `packages/ingest/src/backfill-baseline.ts`:

```ts
import type { PrismaClient } from "@lumio/db";
import { estimateAsShotFromImage } from "./wb-estimate.js";

/**
 * Estimate + store the as-shot baseline for existing photos that don't have one
 * AND are unedited (`edits IS NULL`) — assigning a baseline to an edited photo
 * would shift the meaning of its saved temperature. Reads each photo's thumbnail
 * via `thumbPath(id)`. Returns the number updated.
 */
export async function backfillBaselines(
  db: Pick<PrismaClient, "photo">,
  thumbPath: (id: string) => string,
): Promise<number> {
  const rows = await db.photo.findMany({
    where: { edits: null, asShotTempK: null },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of rows) {
    const wb = await estimateAsShotFromImage(thumbPath(id));
    if (!wb) continue;
    await db.photo.update({ where: { id }, data: { asShotTempK: wb.k, asShotTint: wb.tint } });
    n++;
  }
  return n;
}
```

- [ ] **Step 2: Export and (optionally) wire into the worker's rescan**

Add `export * from "./backfill-baseline.js";` to `packages/ingest/src/index.ts`. If the worker has a maintenance/rescan job, call `backfillBaselines(prisma, (id) => path.join(thumbnailsDir, ` + "`${id}.webp`" + `))` from there; otherwise document running it via a one-off `tsx` invocation with `DATABASE_URL` set.

- [ ] **Step 3: Commit**

```bash
git add packages/ingest/src/backfill-baseline.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): optional backfill of as-shot baselines for unedited photos"
```

---

## Task 12: Full verification

- [ ] **Step 1: Unit suites**

Run:
```bash
pnpm --filter @lumio/shared test
pnpm --filter @lumio/ingest test
pnpm --filter @lumio/web test
```
Expected: all PASS.

- [ ] **Step 2: Web typecheck + targeted lint**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json
```
Expected: 0 errors.

- [ ] **Step 3: Confirm the diff is only this feature (no sibling-migration pollution)**

Run: `git diff origin/main --name-only`
Expected: only the files listed in this plan (shared color/types, db schema+migration+mapper, ingest, web editor/server). If any unrelated migration or schema change appears, remove it.

- [ ] **Step 4: Manual browser check (WYSIWYG)**

Open a photo with a visible color cast in the editor. Confirm:
- The Temperature slider opens at a non-6500 value (the estimate); the photo looks identical to before this feature (no pixel shift at the default).
- Dragging Temperature right warms, left cools; the reset (click the value) returns to the opened baseline.
- Apply, then download the edited JPEG and the edited zip — both match the preview.
- A freshly-ingested photo gets a baseline (check the row's `asShotTempK`).

---

## Self-review notes (addressed)

- **Spec coverage:** non-destructive anchor (Tasks 1, 9, 10) ✓; pixel-only estimate (Tasks 2, 5, 6) ✓; storage = two nullable columns (Task 4) ✓; backward compat via `DEFAULT_BASELINE` (Tasks 1, 7) ✓; edit-safety — baseline recomputed only when the row is (re)ingested, and the update path clears `edits` in the same write, so it always lands on an unedited photo; backfill is explicitly gated on `edits IS NULL` (Task 11) ✓; no ingest slowdown — estimate runs on the existing thumbnail buffer (Task 6) ✓; preview == bake with a baseline (Tasks 7, 9) ✓.
- **Type consistency:** `WbBaseline {k,tint}`, `DEFAULT_BASELINE`, `wbBaselineOf`, `estimateAsShotWhite` (shared) are used identically across ingest/web. `ProcessedPhoto.asShot: WbBaseline | null`. Columns `asShotTempK`/`asShotTint: number | null` on the row, DTO, and Prisma schema (`Float?`).
- **Why `val`/`hasColor`/`sameEdits` are NOT baseline-aware:** the recipe only stores `temperature`/`tint` when the user moves OFF the baseline (the session's `neutralFor` removes the field at the baseline value). So "absent ⇒ at rest" holds with the existing 6500 default, and the matrix path reads absent ⇒ baseline ⇒ identity. This keeps the change surface small and is covered by the Task 1 identity tests.
