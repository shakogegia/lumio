# Photo-editor refactor A1 — Shared edit-model hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the persisted photo-edit recipe in `packages/shared` — add a schema `version`, make the color fields a single source of truth, and promote the duplicated preview-geometry derivations to shared pure functions — without changing any behavior.

**Architecture:** This is increment **A1 of Phase A** (spec: `docs/superpowers/specs/2026-06-23-photo-editor-refactor-design.md`). It is pure-logic only, entirely inside `packages/shared`, with no file moves and no UI changes — so it lands and is reviewed in isolation before the folder restructure (A2) consumes its new exports. All three tasks are behavior-preserving; the safety net is the existing `photo-edits` test suite plus new parity tests.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Zod, Vitest. Package `@lumio/shared` — framework-agnostic (no Prisma/Next/React/node). Run tests with `pnpm --filter @lumio/shared test`.

**Scope of A1 (this plan):** spec §5a (version), §5b (single-source color), and the shared half of §5c (the pure `effectiveCrop`/`outputSize` geometry exports). **Not in A1:** moving `colorCssFilter`/`colorOverlays` out of `shared` (that physical move lands in A2 when `edited-result.tsx` relocates and adopts these new exports), the save-path unification (A2/spec §7), the folder restructure and component split (A2/spec §4,§6), and the correctness fixes (A3/spec §8). See "Remaining Phase A increments" at the end.

---

## File structure

All changes are confined to `packages/shared/src/`:

| File | Responsibility | Change |
| --- | --- | --- |
| `types.ts` | `PhotoEdits` interface (the recipe shape) | add optional `version` |
| `photo-edits.ts` | recipe constructors, transforms, coercion, geometry | add `EDITS_VERSION`/version stamping; add `effectiveCrop`/`outputSize`; refactor `orientedSize` to reuse them; type the color-coerce loop |
| `photo-color.ts` | color field registry + bake params + (today) CSS emit | no change in A1 (only consumed) |
| `api.ts` | Zod schemas for the API boundary | derive `photoEditsSchema` color block from `COLOR_FIELDS`; add `version` |
| `photo-edits.test.ts` | unit tests for the recipe module | update 3 exact-shape assertions; add version + geometry tests |
| `api.test.ts` | unit tests for the schemas | add color-limit-derivation tests |

The public surface is unchanged except for two **added** exports (`effectiveCrop`, `outputSize`, `EDITS_VERSION`); nothing is removed or renamed, so no consumer breaks.

---

## Task 1: Add a schema `version` to the edit recipe (zero migration)

Spec §5a. Tag every coerced/saved recipe with a schema version so a future shape change can branch at the read boundary. Legacy rows lack the field and are treated as v1 — no DB migration, no backfill.

**Files:**
- Modify: `packages/shared/src/types.ts` (`PhotoEdits`)
- Modify: `packages/shared/src/photo-edits.ts` (`EDITS_VERSION`, `NO_EDITS`, `coercePhotoEdits`)
- Modify: `packages/shared/src/api.ts` (`photoEditsSchema` — add `version`)
- Test: `packages/shared/src/photo-edits.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/photo-edits.test.ts`, first update the three existing exact-shape assertions to include the new field (they will otherwise fail):
- Line 24 and line 102 (both assert `NO_EDITS`):
```ts
expect(NO_EDITS).toEqual({ version: 1, rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null });
```
- Line 62 (asserts a coerce result):
```ts
expect(coercePhotoEdits({ rotate: 90, flipH: true, flipV: false })).toEqual({ version: 1, rotate: 90, flipH: true, flipV: false, straighten: 0, crop: null });
```

Then append a new describe block at the end of the file (it uses the existing `describe`/`it`/`expect` imports; add `EDITS_VERSION` to the existing `import { ... } from "./photo-edits.js"` list):
```ts
describe("edits schema version", () => {
  it("NO_EDITS carries the current schema version", () => {
    expect(NO_EDITS.version).toBe(EDITS_VERSION);
    expect(EDITS_VERSION).toBe(1);
  });

  it("coercePhotoEdits stamps the current version on a legacy row that lacks one", () => {
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false })?.version).toBe(EDITS_VERSION);
  });

  it("coercePhotoEdits normalizes any input version to the schema this code emits", () => {
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, version: 99 })?.version).toBe(EDITS_VERSION);
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, version: "x" })?.version).toBe(EDITS_VERSION);
  });

  it("sameEdits ignores version (it is metadata, not a visual field)", () => {
    expect(sameEdits({ ...NO_EDITS, version: 1 }, { ...NO_EDITS, version: 99 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/shared test -- photo-edits`
Expected: FAIL — `EDITS_VERSION` is not exported (import error), and the new `version` assertions fail.

- [ ] **Step 3: Add the `version` field to the type**

In `packages/shared/src/types.ts`, add `version` as the first member of `PhotoEdits` (above `rotate`):
```ts
export interface PhotoEdits {
  /** Recipe schema version (see EDITS_VERSION in photo-edits.ts). Absent in legacy
   *  rows → treated as v1. Stamped on every coerced/saved recipe; metadata only,
   *  not a visual field (sameEdits ignores it). */
  version?: number;
  rotate: 0 | 90 | 180 | 270;
```

- [ ] **Step 4: Stamp the version in the constructors/coercer**

In `packages/shared/src/photo-edits.ts`, add the constant above `NO_EDITS` (line 5) and include `version` in `NO_EDITS`:
```ts
/** Current edit-recipe schema version. Stamped on every coerced/saved recipe so a
 *  future shape change can branch on it at the read boundary. Zero migration:
 *  legacy rows lack the field and are read as v1. */
export const EDITS_VERSION = 1;

export const NO_EDITS: PhotoEdits = {
  version: EDITS_VERSION,
  rotate: 0,
  flipH: false,
  flipV: false,
  straighten: 0,
  crop: null,
};
```
In `coercePhotoEdits`, add `version: EDITS_VERSION` as the first property of the `out` object (currently `const out: PhotoEdits = { rotate: ..., flipH: ..., flipV: ..., straighten, crop };`):
```ts
const out: PhotoEdits = {
  version: EDITS_VERSION,
  rotate: e.rotate as PhotoEdits["rotate"],
  flipH: e.flipH,
  flipV: e.flipV,
  straighten,
  crop,
};
```

- [ ] **Step 5: Add `version` to the API schema**

In `packages/shared/src/api.ts`, add `version` as the first field of `photoEditsSchema` (line 76) so an incoming payload's version is accepted rather than stripped:
```ts
export const photoEditsSchema = z.object({
  version: z.number().int().min(1).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/shared test -- photo-edits`
Expected: PASS (all existing + new). Then `pnpm --filter @lumio/shared exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/photo-edits.ts packages/shared/src/api.ts packages/shared/src/photo-edits.test.ts
git commit -m "shared: version the photo-edit recipe (zero migration)"
```

---

## Task 2: Single-source the color fields from `COLOR_FIELDS`

Spec §5b. `COLOR_FIELDS` (`photo-color.ts`) becomes the only declaration of color keys + limits. Derive the Zod schema's color block and the coercer's clamp loop from it, and remove the unsafe `as unknown as` cast in the coercer.

**Files:**
- Modify: `packages/shared/src/api.ts` (`photoEditsSchema` color block → derived)
- Modify: `packages/shared/src/photo-edits.ts` (`coercePhotoEdits` color loop → typed)
- Test: `packages/shared/src/api.test.ts` (limits track `COLOR_FIELDS`)

- [ ] **Step 1: Write the failing test**

Append a new describe block to `packages/shared/src/api.test.ts`. Ensure `photoEditsSchema` is imported from `./api.js` and `COLOR_FIELDS` from `./photo-color.js` (add to existing imports or add import lines; the file already imports `describe`/`it`/`expect` from `vitest`):
```ts
describe("photoEditsSchema color fields derive from COLOR_FIELDS", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };
  for (const f of COLOR_FIELDS) {
    it(`${f.key} accepts [${f.min}, ${f.max}] and rejects out-of-range`, () => {
      expect(photoEditsSchema.safeParse({ ...base, [f.key]: f.min }).success).toBe(true);
      expect(photoEditsSchema.safeParse({ ...base, [f.key]: f.max }).success).toBe(true);
      expect(photoEditsSchema.safeParse({ ...base, [f.key]: f.min - 1 }).success).toBe(false);
      expect(photoEditsSchema.safeParse({ ...base, [f.key]: f.max + 1 }).success).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it passes (baseline) then fails after a deliberate mismatch check**

Run: `pnpm --filter @lumio/shared test -- api`
Expected: PASS against the current hardcoded schema (it already matches `COLOR_FIELDS`). This test is the *guard* that keeps the derived schema honest — it must stay green through the refactor. (If you want to see it bite, temporarily change one `COLOR_FIELDS` max and observe the failure, then revert.)

- [ ] **Step 3: Derive the schema color block from `COLOR_FIELDS`**

In `packages/shared/src/api.ts`, add the import and replace the eight hardcoded color lines (currently lines 82-89: `exposure` … `vignette`) with a derived spread. Add near the top:
```ts
import { COLOR_FIELDS } from "./photo-color.js";
```
Then build the color schemas above `photoEditsSchema`:
```ts
/** The color half of the edit schema, derived so COLOR_FIELDS is the single source
 *  of truth for every adjustment's range (see photo-color.ts). */
const colorFieldSchemas = Object.fromEntries(
  COLOR_FIELDS.map((f) => [f.key, z.number().min(f.min).max(f.max).optional()]),
) as { [K in (typeof COLOR_FIELDS)[number]["key"]]: z.ZodOptional<z.ZodNumber> };
```
And replace the color lines inside `photoEditsSchema` with the spread (keep `version`/`rotate`/`flipH`/`flipV`/`straighten`/`crop` exactly as they are):
```ts
export const photoEditsSchema = z.object({
  version: z.number().int().min(1).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
  straighten: z.number().min(-45).max(45).optional(),
  crop: cropRectSchema.nullable().optional(),
  ...colorFieldSchemas,
});
```

- [ ] **Step 4: Type the coercer's color loop (remove the cast)**

In `packages/shared/src/photo-edits.ts` `coercePhotoEdits`, the color loop currently writes through `(out as unknown as Record<string, unknown>)[f.key] = clamped;`. Replace the loop body so the assignment is type-checked (`f.key` is `ColorKey`, which is a subset of `keyof PhotoEdits`, all `number | undefined`):
```ts
for (const f of COLOR_FIELDS) {
  const v = e[f.key];
  if (typeof v === "number" && Number.isFinite(v)) {
    const clamped = Math.max(f.min, Math.min(f.max, v));
    if (clamped !== f.neutral) out[f.key] = clamped;
  }
}
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (the new derivation test + all existing `photo-edits`/`api` tests, proving identical behavior).
Run: `pnpm --filter @lumio/shared exec tsc --noEmit`
Expected: clean (the `as unknown as` cast is gone and still compiles).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/photo-edits.ts packages/shared/src/api.test.ts
git commit -m "shared: derive edit color schema + coercer from COLOR_FIELDS"
```

---

## Task 3: Promote `effectiveCrop` and `outputSize` to shared pure exports

Spec §5c (shared half). The `working.crop ?? (straighten≠0 ? centeredAspectCrop(...) : full-frame)` derivation is currently inlined in `edited-result.tsx:65` and `zoomable-image.tsx:397`, and the output-dimension math is half-inlined in `orientedSize`. Promote both to named pure functions so the components (in A2) and any future renderer read one source. `orientedSize` is refactored to reuse them, preserving its behavior.

**Files:**
- Modify: `packages/shared/src/photo-edits.ts` (add `effectiveCrop`, `outputSize`; refactor `orientedSize`)
- Test: `packages/shared/src/photo-edits.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/photo-edits.test.ts` (add `effectiveCrop`, `outputSize` to the `./photo-edits.js` import list):
```ts
describe("effectiveCrop / outputSize", () => {
  it("effectiveCrop returns the explicit crop when present", () => {
    const c = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(effectiveCrop({ ...NO_EDITS, crop: c }, 400, 200)).toEqual(c);
  });

  it("effectiveCrop is the full frame with no crop and no straighten", () => {
    expect(effectiveCrop(NO_EDITS, 400, 200)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(effectiveCrop(null, 400, 200)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("effectiveCrop auto-fills an inscribed crop when straightened with no explicit crop", () => {
    const c = effectiveCrop({ ...NO_EDITS, straighten: 10 }, 400, 200);
    expect(c.w).toBeLessThan(1);
    expect(c.h).toBeLessThan(1);
    expect(c.x).toBeGreaterThan(0);
  });

  it("outputSize equals orientedSize across the rotate × straighten × crop matrix", () => {
    const cases: PhotoEdits[] = [
      NO_EDITS,
      { ...NO_EDITS, rotate: 90 },
      { ...NO_EDITS, straighten: 12 },
      { ...NO_EDITS, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { ...NO_EDITS, rotate: 270, crop: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } },
    ];
    for (const e of cases) {
      const [W, H] = orientedSize(400, 200, e);
      const [ow, oh] = e.rotate === 90 || e.rotate === 270 ? [200, 400] : [400, 200];
      expect(outputSize(e, ow, oh)).toEqual({ w: W, h: H });
    }
  });
});
```
(`PhotoEdits` is a type — import it with `import type { PhotoEdits } from "./types.js";` at the top of the test file if not already present.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/shared test -- photo-edits`
Expected: FAIL — `effectiveCrop`/`outputSize` are not exported (import error).

- [ ] **Step 3: Add the two pure functions and refactor `orientedSize`**

In `packages/shared/src/photo-edits.ts`, add above the current `orientedSize` (line 124). Both operate on **oriented** dims `ow×oh` (post coarse-rotate), matching what the components already hold as `orientedBase`:
```ts
/** The crop actually applied when previewing/baking `e` against an oriented base of
 *  `ow×oh` (post coarse-rotate). Explicit crop wins; else a straighten auto-fills a
 *  centered inscribed crop; else the full frame. Normalized to the straightened (O′)
 *  box. Single source for the 3 sites that used to inline this. */
export function effectiveCrop(e: PhotoEdits | null, ow: number, oh: number): CropRect {
  if (e?.crop) return e.crop;
  const deg = e?.straighten ?? 0;
  if (deg !== 0) return centeredAspectCrop(ow / oh, ow, oh, deg);
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Output { w, h } of the recipe applied to an oriented `ow×oh` base: straighten
 *  expands to the O′ box, then the effective crop selects a sub-rect. */
export function outputSize(e: PhotoEdits | null, ow: number, oh: number): { w: number; h: number } {
  const deg = e?.straighten ?? 0;
  const op = straightenedSize(ow, oh, deg);
  const crop = effectiveCrop(e, ow, oh);
  return {
    w: Math.max(1, Math.round(crop.w * op.w)),
    h: Math.max(1, Math.round(crop.h * op.h)),
  };
}
```
Then replace the body of `orientedSize` to delegate (preserving its `[w, h]` tuple signature and its `null → [w, h]` early return):
```ts
/** Predicted [width, height] after the recipe, for optimistic store patching.
 *  Thin wrapper over outputSize that first applies the coarse-rotate axis swap. */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  if (!e) return [w, h];
  const [ow, oh] = e.rotate === 90 || e.rotate === 270 ? [h, w] : [w, h];
  const { w: W, h: H } = outputSize(e, ow, oh);
  return [W, H];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/shared test -- photo-edits`
Expected: PASS — including the matrix test proving `outputSize` reproduces `orientedSize` exactly (parity), and the existing `orientedSize` tests (lines 48-51) still green.

- [ ] **Step 5: Run the full shared suite + typecheck**

Run: `pnpm --filter @lumio/shared test && pnpm --filter @lumio/shared exec tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/photo-edits.ts packages/shared/src/photo-edits.test.ts
git commit -m "shared: promote effectiveCrop/outputSize to pure exports; orientedSize reuses them"
```

---

## Final verification (after all three tasks)

- [ ] Run the whole workspace test suite to confirm nothing downstream regressed (the recipe shape is consumed widely):

Run: `pnpm -r test`
Expected: all packages green. `PhotoEdits` consumers (`@lumio/db` mapper, `@lumio/ingest` bake, web edit session) compile and pass because `version` is optional and `effectiveCrop`/`outputSize` are additive.

- [ ] Lint the changed package:

Run: `pnpm --filter @lumio/web lint` is N/A here; for shared rely on `tsc`. Confirm `pnpm --filter @lumio/shared exec tsc --noEmit` is clean.

---

## Remaining Phase A increments (planned just-in-time)

A1 deliberately stops at pure `packages/shared` logic. The next increments are written as their own plans **after** the prior one lands, because each edits files the previous one reshapes/moves (planning exact code against a predicted tree would drift). All are specified in `docs/superpowers/specs/2026-06-23-photo-editor-refactor-design.md`:

- **A2 — Save-path unification (spec §7):** `@lumio/ingest` owns rendition writes; web `applyPhotoEdits` does only the `prisma.update`; centralize rendition path builders into `shared/paths.ts`. Pure-logic, location-independent — can be planned next in parallel with A3.
- **A3 — Folder restructure + component split (spec §4, §6):** create `features/{photo-grid,lightbox,photo-editor}/` with barrels; move files; **extract** `colorCssFilter`/`colorOverlays` into `photo-editor/render/css-preview.ts` and point `edited-result.tsx` at A1's `effectiveCrop`/`outputSize`; split `ZoomableImage` into `use-display-buffer`/`use-hi-res-swap`/`use-measured-size`/`crop-editor-canvas`/`preview-stage`; split `useEditSession` into state vs actions contexts.
- **A4 — Correctness fixes (spec §8):** the `lightbox-sidebar` `resync` cancellation guard and the `mappers.ts` Zod validation of `exif`/`rules`.

## Self-review

- **Spec coverage (A1 slice):** §5a version → Task 1 ✓; §5b single-source color → Task 2 ✓; §5c shared geometry exports (`effectiveCrop`/`outputSize`) → Task 3 ✓. The §5c *CSS-emit move* is explicitly deferred to A3 (noted in Scope) because its destination dir doesn't exist until the restructure — not a gap.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `EDITS_VERSION` (number, =1) used in `NO_EDITS`, `coercePhotoEdits`, and tests; `effectiveCrop(e, ow, oh)` / `outputSize(e, ow, oh)` signatures consistent between definition (Task 3 Step 3), tests (Step 1), and `orientedSize`'s call site; `COLOR_FIELDS[].{key,min,max,neutral}` used identically in Task 2's schema derivation and the coerce loop. `ColorKey` ⊆ `keyof PhotoEdits` is what makes the cast-free `out[f.key] = clamped` typecheck.
