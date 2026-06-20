# Photo Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive rotate/flip editing to photos (visible everywhere, original preserved) with edited/original downloads, on a foundation that crop + adjustment sliders extend later.

**Architecture:** Edits are a JSON recipe (`{rotate, flipH, flipV}`) stored on `Photo`; the original file is never touched. Applying an edit regenerates the cached display + thumbnail renditions via `sharp` and bumps `updatedAt`, which the client uses as a `?v=` cache-bust token so the grid + lightbox refresh. The Edit tab in the lightbox sidebar previews edits with CSS transforms and persists on **Apply**. Downloads come in edited (full-res JPEG, recipe baked in) and original variants.

**Tech Stack:** Next.js (App Router, Node runtime route handlers), Prisma (Postgres), `sharp`, `zod`, `vitest`, React 19, shadcn `ui/*`, Tailwind.

---

## Conventions

- **Run all tests:** `pnpm -r test` (from repo root).
- **Run one package's tests:** `pnpm --filter @lumio/shared test`
- **Run one test file:** `pnpm --filter @lumio/shared exec vitest run src/photo-edits.test.ts`
- **Typecheck a package:** `pnpm --filter @lumio/web exec tsc --noEmit`
- Use TS `enum`/literal-union style already in the repo; `"use client"` must be line 1 of client files.
- Do **not** modify anything under `apps/web/src/components/ui/` — compose/copy styles instead.

## File structure (what gets created / modified)

**Created**
- `packages/shared/src/photo-edits.ts` — pure recipe helpers (`NO_EDITS`, `hasEdits`, rotate/flip/orientedSize).
- `packages/shared/src/photo-edits.test.ts`
- `packages/ingest/src/renditions.ts` — `applyEdits`, `buildRenditions`.
- `packages/ingest/src/renditions.test.ts`
- `apps/web/src/lib/photo-edits-service.ts` — `applyPhotoEdits`.
- `apps/web/src/lib/rendition-url.ts` — versioned `thumbUrl`/`displayUrl`.
- `apps/web/src/app/api/photos/[id]/edit/route.ts` — POST edit recipe.
- `apps/web/src/app/api/photos/[id]/edited/route.ts` — GET full-res edited JPEG.
- `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx` — Edit tab body.
- `apps/web/src/components/photo-grid/use-edit-session.tsx` — edit session state + provider.
- `apps/web/src/components/photo-actions/download-split-button.tsx` — split download control.

**Modified**
- `packages/db/prisma/schema.prisma` — add `edits Json?` (+ migration).
- `packages/shared/src/types.ts` — `PhotoEdits`, `PhotoDTO.edits`.
- `packages/shared/src/api.ts` + `api.test.ts` — `photoEditsSchema`, `editPhotoSchema`, download `variant`.
- `packages/db/src/mappers.ts` + `mappers.test.ts` — map `edits`.
- `packages/ingest/src/process.ts` — use `buildRenditions`.
- `apps/web/src/lib/download-service.ts` — variant-aware zip.
- `apps/web/src/lib/download-client.ts` — `variant` arg.
- `apps/web/src/lib/photos-service.ts` — `listPhotosForDownload` selects `edits`.
- `apps/web/src/app/api/photos/download/route.ts` — accept `variant`.
- `apps/web/src/components/photo-actions/use-photo-actions.tsx` — `variant`.
- `apps/web/src/components/photo-grid/photo-thumb.tsx` — versioned thumb URL.
- `apps/web/src/components/photo-grid/film-strip.tsx` — versioned thumb URL.
- `apps/web/src/components/photo-grid/lightbox.tsx` — versioned display URL, edit session, preview, nav guard.
- `apps/web/src/components/photo-grid/photo-collection.tsx` — versioned preload, `photosByIds`, optional hook.
- `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` — Edit tab + split download.
- `apps/web/src/components/photo-grid/photo-context-menu.tsx` — adaptive download items.

---

## Task 1: Shared recipe types, schema, and pure helpers

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/api.ts`
- Create: `packages/shared/src/photo-edits.ts`
- Test: `packages/shared/src/photo-edits.test.ts`
- Modify (export): `packages/shared/src/index.ts` (barrel — confirm exports)

- [ ] **Step 1: Add the `PhotoEdits` type and extend `PhotoDTO`**

In `packages/shared/src/types.ts`, add above `PhotoDTO`:

```ts
/** Non-destructive edit recipe applied on top of EXIF auto-orientation.
 *  Canonical application order: flipH → flipV → rotate (clockwise). */
export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}
```

Add to the `PhotoDTO` interface (after `colorLabel`):

```ts
  edits: PhotoEdits | null;
```

- [ ] **Step 2: Write failing tests for the recipe helpers**

Create `packages/shared/src/photo-edits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NO_EDITS,
  hasEdits,
  rotateLeft,
  rotateRight,
  toggleFlipH,
  toggleFlipV,
  orientedSize,
  coercePhotoEdits,
} from "./photo-edits.js";

describe("photo-edits", () => {
  it("NO_EDITS is the identity recipe", () => {
    expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false });
  });

  it("hasEdits is false for null and identity, true otherwise", () => {
    expect(hasEdits(null)).toBe(false);
    expect(hasEdits(NO_EDITS)).toBe(false);
    expect(hasEdits({ rotate: 90, flipH: false, flipV: false })).toBe(true);
    expect(hasEdits({ rotate: 0, flipH: true, flipV: false })).toBe(true);
  });

  it("rotateRight/Left step by 90 and wrap mod 360", () => {
    expect(rotateRight(NO_EDITS).rotate).toBe(90);
    expect(rotateRight({ rotate: 270, flipH: false, flipV: false }).rotate).toBe(0);
    expect(rotateLeft(NO_EDITS).rotate).toBe(270);
    expect(rotateLeft({ rotate: 90, flipH: false, flipV: false }).rotate).toBe(0);
  });

  it("flip toggles are axis-aware under 90/270 rotation", () => {
    // Upright: H toggles flipH.
    expect(toggleFlipH(NO_EDITS)).toMatchObject({ flipH: true, flipV: false });
    // Rotated 90: on-screen horizontal is the image's vertical axis → toggles flipV.
    expect(toggleFlipH({ rotate: 90, flipH: false, flipV: false })).toMatchObject({ flipV: true });
    expect(toggleFlipV({ rotate: 270, flipH: false, flipV: false })).toMatchObject({ flipH: true });
  });

  it("orientedSize swaps on 90/270 only", () => {
    expect(orientedSize(400, 200, NO_EDITS)).toEqual([400, 200]);
    expect(orientedSize(400, 200, { rotate: 90, flipH: false, flipV: false })).toEqual([200, 400]);
    expect(orientedSize(400, 200, { rotate: 180, flipH: false, flipV: false })).toEqual([400, 200]);
    expect(orientedSize(400, 200, { rotate: 270, flipH: true, flipV: false })).toEqual([200, 400]);
  });

  it("coercePhotoEdits accepts valid, rejects malformed/null", () => {
    expect(coercePhotoEdits({ rotate: 90, flipH: true, flipV: false })).toEqual({ rotate: 90, flipH: true, flipV: false });
    expect(coercePhotoEdits(null)).toBeNull();
    expect(coercePhotoEdits({ rotate: 45, flipH: false, flipV: false })).toBeNull();
    expect(coercePhotoEdits({ rotate: 90 })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-edits.test.ts`
Expected: FAIL — cannot find module `./photo-edits.js`.

- [ ] **Step 4: Implement the helpers**

Create `packages/shared/src/photo-edits.ts`:

```ts
import type { PhotoEdits } from "./types.js";

export const NO_EDITS: PhotoEdits = { rotate: 0, flipH: false, flipV: false };

/** True when the recipe changes the image (non-null and not the identity). */
export function hasEdits(e: PhotoEdits | null): boolean {
  return e !== null && (e.rotate !== 0 || e.flipH || e.flipV);
}

function withRotate(e: PhotoEdits, rotate: number): PhotoEdits {
  return { ...e, rotate: (((rotate % 360) + 360) % 360) as PhotoEdits["rotate"] };
}

export function rotateRight(e: PhotoEdits): PhotoEdits {
  return withRotate(e, e.rotate + 90);
}

export function rotateLeft(e: PhotoEdits): PhotoEdits {
  return withRotate(e, e.rotate - 90);
}

/** When rotated 90/270 the on-screen axes are swapped, so a "flip horizontal"
 *  button must toggle the stored vertical flip (and vice-versa) to stay visually
 *  intuitive. The stored recipe remains canonical. */
function axisSwapped(e: PhotoEdits): boolean {
  return e.rotate === 90 || e.rotate === 270;
}

export function toggleFlipH(e: PhotoEdits): PhotoEdits {
  return axisSwapped(e) ? { ...e, flipV: !e.flipV } : { ...e, flipH: !e.flipH };
}

export function toggleFlipV(e: PhotoEdits): PhotoEdits {
  return axisSwapped(e) ? { ...e, flipH: !e.flipH } : { ...e, flipV: !e.flipV };
}

/** Predicted [width, height] after the recipe (rotate 90/270 swaps). */
export function orientedSize(w: number, h: number, e: PhotoEdits | null): [number, number] {
  return e && (e.rotate === 90 || e.rotate === 270) ? [h, w] : [w, h];
}

/** Defensively coerce an unknown JSON value (e.g. from the DB) into a recipe or
 *  null. Shared by the DTO mapper and the edited-download encoder. */
export function coercePhotoEdits(value: unknown): PhotoEdits | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (![0, 90, 180, 270].includes(e.rotate as number)) return null;
  if (typeof e.flipH !== "boolean" || typeof e.flipV !== "boolean") return null;
  return { rotate: e.rotate as PhotoEdits["rotate"], flipH: e.flipH, flipV: e.flipV };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/photo-edits.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the Zod schemas + export the new module**

In `packages/shared/src/api.ts`, add after `photoIdsSchema`:

```ts
/** Edit recipe payload. Used by POST /api/photos/[id]/edit (null = reset). */
export const photoEditsSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
});
export const editPhotoSchema = z.object({ edits: photoEditsSchema.nullable() });
export type EditPhotoInput = z.infer<typeof editPhotoSchema>;

/** Which bytes a download returns. */
export const downloadVariantSchema = z.enum(["original", "edited"]);
export type DownloadVariant = z.infer<typeof downloadVariantSchema>;

/** Body for POST /api/photos/download — bulk zip, original or edited. */
export const downloadRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  variant: downloadVariantSchema.default("original"),
});
```

Confirm `packages/shared/src/index.ts` re-exports `./photo-edits.js` (add `export * from "./photo-edits.js";` if the barrel lists modules explicitly). `PhotoEdits`/new schemas flow through the existing `types.js`/`api.js` re-exports.

- [ ] **Step 7: Add failing+passing schema tests**

In `packages/shared/src/api.test.ts`, add:

```ts
import { editPhotoSchema, downloadRequestSchema } from "./api.js";

describe("editPhotoSchema", () => {
  it("accepts a valid recipe and null", () => {
    expect(editPhotoSchema.safeParse({ edits: { rotate: 90, flipH: true, flipV: false } }).success).toBe(true);
    expect(editPhotoSchema.safeParse({ edits: null }).success).toBe(true);
  });
  it("rejects bad rotate values", () => {
    expect(editPhotoSchema.safeParse({ edits: { rotate: 45, flipH: false, flipV: false } }).success).toBe(false);
  });
});

describe("downloadRequestSchema", () => {
  it("defaults variant to original", () => {
    const parsed = downloadRequestSchema.parse({ ids: ["a"] });
    expect(parsed.variant).toBe("original");
  });
});
```

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (whole package).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/photo-edits.ts packages/shared/src/photo-edits.test.ts packages/shared/src/types.ts packages/shared/src/api.ts packages/shared/src/api.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): photo edit recipe types, schemas, and pure helpers"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the column**

In `model Photo` (after `colorLabel ColorLabel?`), add:

```prisma
  edits       Json?        // PhotoEdits recipe; null = unedited
```

- [ ] **Step 2: Create and apply the migration**

Ensure the dev DB is up (`pnpm db:up` if needed — Postgres on 5433), then run:

Run: `pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate dev --name add_photo_edits`
Expected: a new folder under `packages/db/prisma/migrations/` and "Your database is now in sync"; the Prisma client regenerates so `Photo` now has `edits`.

- [ ] **Step 3: Verify the client type**

Run: `pnpm --filter @lumio/db exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Photo.edits json column"
```

---

## Task 3: DTO mapper

**Files:**
- Modify: `packages/db/src/mappers.ts`
- Test: `packages/db/src/mappers.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/db/src/mappers.test.ts`, inside the `toPhotoDTO` describe, add (adjust the row factory the file already uses — pass `edits` through):

```ts
it("maps a valid edits recipe", () => {
  const dto = toPhotoDTO({ ...baseRow, edits: { rotate: 90, flipH: true, flipV: false } } as any);
  expect(dto.edits).toEqual({ rotate: 90, flipH: true, flipV: false });
});
it("maps null edits to null", () => {
  const dto = toPhotoDTO({ ...baseRow, edits: null } as any);
  expect(dto.edits).toBeNull();
});
it("maps malformed edits to null", () => {
  const dto = toPhotoDTO({ ...baseRow, edits: { rotate: 45 } } as any);
  expect(dto.edits).toBeNull();
});
```

If the test file doesn't already have a reusable `baseRow`, create one from the existing inline row literal it uses for `toPhotoDTO`, adding `edits: null` to it.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @lumio/db exec vitest run src/mappers.test.ts`
Expected: FAIL — `dto.edits` is undefined.

- [ ] **Step 3: Implement defensive mapping**

In `packages/db/src/mappers.ts`, add `coercePhotoEdits` to the existing `@lumio/shared` import and set `edits` in both mappers:

```ts
import { /* ...existing... */ coercePhotoEdits } from "@lumio/shared";
```

In `toPhotoDTO`, add `edits: coercePhotoEdits(row.edits),`. In `toTrashedPhotoDTO`, add `edits: null,` (trashed photos don't expose edits).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @lumio/db test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/mappers.ts packages/db/src/mappers.test.ts
git commit -m "feat(db): map Photo.edits into PhotoDTO defensively"
```

---

## Task 4: Shared rendition pipeline (`@lumio/ingest`)

**Files:**
- Create: `packages/ingest/src/renditions.ts`
- Test: `packages/ingest/src/renditions.test.ts`
- Modify: `packages/ingest/src/process.ts`

- [ ] **Step 1: Write failing tests (dimensions + composition via a generated fixture)**

Create `packages/ingest/src/renditions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildRenditions } from "./renditions.js";

// A 4x2 PNG (landscape). No EXIF orientation.
async function landscape(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
}

describe("buildRenditions", () => {
  it("keeps dimensions with no edits", async () => {
    const r = await buildRenditions(await landscape(), null);
    expect([r.width, r.height]).toEqual([4, 2]);
    expect(r.display.length).toBeGreaterThan(0);
    expect(r.thumbnail.length).toBeGreaterThan(0);
    expect(typeof r.thumbhash).toBe("string");
  });

  it("swaps dimensions on a 90° rotation", async () => {
    const r = await buildRenditions(await landscape(), { rotate: 90, flipH: false, flipV: false });
    expect([r.width, r.height]).toEqual([2, 4]);
  });

  it("keeps dimensions on 180° rotation", async () => {
    const r = await buildRenditions(await landscape(), { rotate: 180, flipH: false, flipV: false });
    expect([r.width, r.height]).toEqual([4, 2]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @lumio/ingest exec vitest run src/renditions.test.ts`
Expected: FAIL — cannot find `./renditions.js`.

- [ ] **Step 3: Implement the module**

Create `packages/ingest/src/renditions.ts`:

```ts
import sharp from "sharp";
import type { Sharp } from "sharp";
import type { PhotoEdits } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { computeThumbhash } from "./thumbhash.js";

const FIT = { fit: "inside", withoutEnlargement: true } as const;

export type RenditionInput = Buffer | string;

export interface Renditions {
  display: Buffer;
  thumbnail: Buffer;
  thumbhash: string;
  width: number;
  height: number;
}

/** Apply the user recipe to an already EXIF-oriented pipeline: flipH (flop),
 *  flipV (flip), then rotate clockwise. No-op when edits is null. */
export function applyEdits(img: Sharp, edits: PhotoEdits | null): Sharp {
  if (!edits) return img;
  let out = img;
  if (edits.flipH) out = out.flop();
  if (edits.flipV) out = out.flip();
  if (edits.rotate) out = out.rotate(edits.rotate);
  return out;
}

/**
 * Build the display + thumbnail WebP renditions (and thumbhash + oriented size)
 * for an image, optionally with a user edit recipe. The no-edit path matches the
 * original ingest pipeline (single decode → auto-orient → resize). With geometry
 * edits, the EXIF orientation is first baked into a buffer so the explicit
 * flip/rotate compose unambiguously (auto-orient + explicit rotate must not mix).
 */
export async function buildRenditions(
  input: RenditionInput,
  edits: PhotoEdits | null,
): Promise<Renditions> {
  const geom = !!edits && (edits.rotate !== 0 || edits.flipH || edits.flipV);

  let source: RenditionInput = input;
  let exifBaked = false;
  if (geom) {
    source = await sharp(input).rotate().toBuffer(); // EXIF orientation now baked in
    exifBaked = true;
  }

  const start = () => (exifBaked ? sharp(source) : sharp(source).rotate());
  const display = await applyEdits(start(), edits)
    .resize(DISPLAY_MAX, DISPLAY_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbnail = await sharp(display)
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT)
    .webp({ quality: 80 })
    .toBuffer();
  const thumbhash = await computeThumbhash(thumbnail);

  const meta = await sharp(source).metadata();
  let width: number;
  let height: number;
  if (exifBaked) {
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } else {
    const swap = (meta.orientation ?? 1) >= 5; // EXIF 5-8 rotate 90/270
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  }
  if (geom && (edits!.rotate === 90 || edits!.rotate === 270)) {
    [width, height] = [height, width];
  }

  return { display, thumbnail, thumbhash, width, height };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @lumio/ingest exec vitest run src/renditions.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `process.ts` onto `buildRenditions`**

In `packages/ingest/src/process.ts`, replace the inline metadata/display/thumbnail/thumbhash block (the `const meta = ...` through `const thumbhash = ...` lines) with:

```ts
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      null,
    );
```

Remove the now-unused `FIT`, `DISPLAY_MAX`, `THUMBNAIL_MAX`, `computeThumbhash` imports and the local `FIT` const from `process.ts` (they live in `renditions.ts` now). Add `import { buildRenditions } from "./renditions.js";`. Keep the `original` read, `extractMetadata`, and `hash` logic unchanged. The returned object is unchanged.

- [ ] **Step 6: Run the ingest package tests**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS (existing process tests still green — no-edit behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts packages/ingest/src/process.ts
git commit -m "feat(ingest): shared buildRenditions/applyEdits pipeline; reuse in process"
```

---

## Task 5: Edit service + API route

**Files:**
- Create: `apps/web/src/lib/photo-edits-service.ts`
- Create: `apps/web/src/app/api/photos/[id]/edit/route.ts`

- [ ] **Step 1: Implement the service**

Create `apps/web/src/lib/photo-edits-service.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma, toPhotoDTO } from "@lumio/db";
import { hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { buildRenditions, decodeToSharpInput } from "@lumio/ingest";
import { displayPath, originalPath, thumbnailPath } from "@/lib/paths";

/**
 * Regenerate a photo's renditions for the given edit recipe and persist it.
 * Passing `null` (or the identity recipe) resets the photo to its original.
 * Returns the updated DTO, or null if the photo doesn't exist.
 */
export async function applyPhotoEdits(
  id: string,
  edits: PhotoEdits | null,
): Promise<PhotoDTO | null> {
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return null;

  const recipe = hasEdits(edits) ? edits : null;
  const decoded = await decodeToSharpInput(originalPath(photo.path));
  try {
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      recipe,
    );
    await mkdir(path.dirname(displayPath(id)), { recursive: true });
    await mkdir(path.dirname(thumbnailPath(id)), { recursive: true });
    await writeFile(displayPath(id), display);
    await writeFile(thumbnailPath(id), thumbnail);

    const updated = await prisma.photo.update({
      where: { id },
      // Prisma needs the JsonNull sentinel (not JS null) to clear a Json column.
      data: { edits: recipe ?? Prisma.JsonNull, width, height, thumbhash },
    });
    return toPhotoDTO(updated);
  } finally {
    await decoded.cleanup();
  }
}
```

> If `@lumio/db` re-exports `Prisma`, import it from there instead of `@prisma/client` to match the repo's import convention — check `packages/db/src/index.ts`.

- [ ] **Step 2: Implement the route**

Create `apps/web/src/app/api/photos/[id]/edit/route.ts`:

```ts
import { NextResponse } from "next/server";
import { editPhotoSchema } from "@lumio/shared";
import { applyPhotoEdits } from "@/lib/photo-edits-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const parsed = editPhotoSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid edit recipe" }, { status: 400 });
    }
    const dto = await applyPhotoEdits(id, parsed.data.edits);
    if (!dto) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    return NextResponse.json(dto);
  },
);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS. (Confirm `buildRenditions`, `applyEdits`, `decodeToSharpInput` are exported from `@lumio/ingest`'s package entrypoint; if `@lumio/ingest` only exports select symbols, add them to its `src/index.ts` barrel.)

- [ ] **Step 4: Smoke test the endpoint**

With `pnpm dev` running and logged in, in the browser devtools console on the app origin:

```js
const id = /* an existing photo id from the grid */;
await fetch(`/api/photos/${id}/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits: { rotate: 90, flipH: false, flipV: false } }) }).then(r => r.json());
```

Expected: returns the DTO with `edits.rotate === 90` and swapped `width`/`height`. Reset with `{ edits: null }` and confirm `edits` is null again.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photo-edits-service.ts apps/web/src/app/api/photos/[id]/edit/route.ts
git commit -m "feat(web): apply-edits service + POST /api/photos/[id]/edit"
```

---

## Task 6: Edited full-resolution download route

**Files:**
- Create: `apps/web/src/app/api/photos/[id]/edited/route.ts`

- [ ] **Step 1: Implement the route**

Create `apps/web/src/app/api/photos/[id]/edited/route.ts`:

```ts
import sharp from "sharp";
import { NextResponse } from "next/server";
import { hasEdits } from "@lumio/shared";
import { applyEdits, decodeToSharpInput } from "@lumio/ingest";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { attachmentDisposition } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** basename with the extension swapped to .jpg */
function jpegName(relPath: string): string {
  const base = relPath.split("/").pop() || relPath;
  const dot = base.lastIndexOf(".");
  return `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
}

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const decoded = await decodeToSharpInput(originalPath(photo.path));
    try {
      const oriented = await sharp(decoded.input).rotate().toBuffer();
      const recipe = hasEdits(photo.edits) ? photo.edits : null;
      const jpeg = await applyEdits(sharp(oriented), recipe).jpeg({ quality: 92 }).toBuffer();
      const headers: Record<string, string> = {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=0, must-revalidate",
      };
      if (new URL(request.url).searchParams.get("download")) {
        headers["Content-Disposition"] = attachmentDisposition(jpegName(photo.path));
      }
      return new NextResponse(new Uint8Array(jpeg), { headers });
    } catch {
      return NextResponse.json({ error: "Original not found" }, { status: 404 });
    } finally {
      await decoded.cleanup();
    }
  },
);
```

> **Phase-1 simplification (deviates from spec §15):** the re-encode does **not** carry
> EXIF — `sharp` strips metadata by default and the orientation-baking buffer loses it.
> So edited JPEGs have no camera/date/GPS tags. Preserving non-orientation EXIF (read the
> original's tags, re-attach via `.withMetadata({ exif }, ...)` with orientation forced to 1)
> is a documented follow-up, not phase 1. Confirm this is acceptable before implementing
> (raised with the user).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Smoke test**

With an edited photo id, open `/api/photos/<id>/edited?download=1` in the browser — it downloads a `.jpg` reflecting the rotation/flip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/photos/[id]/edited/route.ts
git commit -m "feat(web): GET /api/photos/[id]/edited full-res JPEG"
```

---

## Task 7: Bulk download variant (service, route, client, actions)

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts`
- Modify: `apps/web/src/lib/download-service.ts`
- Modify: `apps/web/src/app/api/photos/download/route.ts`
- Modify: `apps/web/src/lib/download-client.ts`
- Modify: `apps/web/src/components/photo-actions/use-photo-actions.tsx`
- Test: `apps/web/src/lib/download-service.test.ts` (if present; else create)

- [ ] **Step 1: Select `edits` for downloads**

In `apps/web/src/lib/photos-service.ts`, change `listPhotosForDownload`'s `select` to include `edits`, and the return type to `{ id: string; path: string; edits: unknown }[]` (or import `PhotoEdits` and map). Keep callers compiling.

- [ ] **Step 2: Make the zip variant-aware**

In `apps/web/src/lib/download-service.ts`, update `streamPhotosZip` to accept a `variant` and generate edited JPEGs for edited photos. Add these imports:

```ts
import sharp from "sharp";
import { coercePhotoEdits, hasEdits, type DownloadVariant } from "@lumio/shared";
import { applyEdits, decodeToSharpInput } from "@lumio/ingest";
```

Change the signature and body:

```ts
export function streamPhotosZip(
  photos: { id: string; path: string; edits?: unknown }[],
  zipName: string,
  variant: DownloadVariant = "original",
  resolve: (relPath: string) => string = originalPath,
): Response {
  // ...existing archive/pass setup...
  const used = new Set<string>();
  void (async () => {
    for (const photo of photos) {
      const abs = resolve(photo.path);
      if (!existsSync(abs)) {
        console.warn("[download] skipping missing original:", photo.path);
        continue;
      }
      const base = photo.path.split("/").pop() || photo.path;
      const recipe = coercePhotoEdits(photo.edits);
      if (variant === "edited" && hasEdits(recipe)) {
        const decoded = await decodeToSharpInput(abs);
        try {
          const oriented = await sharp(decoded.input).rotate().toBuffer();
          const jpeg = await applyEdits(sharp(oriented), recipe)
            .jpeg({ quality: 92 })
            .toBuffer();
          const dot = base.lastIndexOf(".");
          const name = `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
          archive.append(jpeg, { name: dedupeEntryName(name, used) });
        } finally {
          await decoded.cleanup();
        }
      } else {
        archive.file(abs, { name: dedupeEntryName(base, used) });
      }
    }
    void archive.finalize();
  })();
  // ...existing return new Response(...)...
}
```

`coercePhotoEdits` is the shared helper defined in Task 1 (already used by the mapper in Task 3).

> Note: the original variant keeps the existing synchronous `archive.file` streaming. Only the edited variant buffers per photo (acceptable — edited selections are smaller; generation is on demand).

- [ ] **Step 3: Accept `variant` in the route**

In `apps/web/src/app/api/photos/download/route.ts`, parse with `downloadRequestSchema`, fetch photos with `edits`, and pass `variant` to `streamPhotosZip`. (Match the file's existing structure — it currently parses `photoIdsSchema` and calls `listPhotosForDownload`.)

- [ ] **Step 4: Thread `variant` through the client**

In `apps/web/src/lib/download-client.ts`, change the signature:

```ts
import type { DownloadVariant } from "@lumio/shared";

export async function downloadSelection(
  ids: string[],
  variant: DownloadVariant = "original",
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length === 1) {
    const path = variant === "edited" ? "edited" : "original";
    downloadFromUrl(`/api/photos/${ids[0]}/${path}?download=1`);
    return;
  }
  const res = await fetch("/api/photos/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, variant }),
  });
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumio-photos-${ids.length}${variant === "edited" ? "-edited" : ""}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 5: Thread `variant` through the actions hook**

In `apps/web/src/components/photo-actions/use-photo-actions.tsx`:
- Add `variant?: DownloadVariant` to the `ActionOpts` type (so callers pass it as the opts arg, e.g. `download(ids, { variant: "edited" })`). Import `DownloadVariant` from `@lumio/shared`.
- In the `download` callback, call `await downloadSelection(ids, opts?.variant)`.
- `PhotoActions.download` already takes `opts?: ActionOpts`, so its signature is unchanged.

- [ ] **Step 6: Test the service variant logic**

Add/extend `apps/web/src/lib/download-service.test.ts`. If the file exists, add a case asserting that with `variant: "edited"` an edited photo produces a `.jpg` entry and an unedited one keeps its original name (use a mocked `resolve` + small fixtures, mirroring existing tests). If no test file exists, write a focused test for `dedupeEntryName` interplay with the `.jpg` rename. Then:

Run: `pnpm --filter @lumio/web test`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` → PASS.

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/download-service.ts apps/web/src/lib/download-service.test.ts apps/web/src/app/api/photos/download/route.ts apps/web/src/lib/download-client.ts apps/web/src/components/photo-actions/use-photo-actions.tsx
git commit -m "feat: edited-variant bulk download"
```

---

## Task 8: Cache-bust rendition URLs

**Files:**
- Create: `apps/web/src/lib/rendition-url.ts`
- Modify: `apps/web/src/components/photo-grid/photo-thumb.tsx`
- Modify: `apps/web/src/components/photo-grid/film-strip.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-collection.tsx`

- [ ] **Step 1: Add URL helpers**

Create `apps/web/src/lib/rendition-url.ts`:

```ts
import type { PhotoDTO } from "@lumio/shared";

/** A cache-bust token derived from updatedAt; changes whenever renditions are
 *  regenerated (edits applied/reset). */
export function renditionVersion(updatedAt: string): number {
  return Date.parse(updatedAt);
}

export function thumbUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/thumbnails/${photo.id}?v=${renditionVersion(photo.updatedAt)}`;
}

export function displayUrl(photo: Pick<PhotoDTO, "id" | "updatedAt">): string {
  return `/api/photos/${photo.id}/display?v=${renditionVersion(photo.updatedAt)}`;
}
```

- [ ] **Step 2: Use it in the grid thumbnail**

In `apps/web/src/components/photo-grid/photo-thumb.tsx`, import `thumbUrl` and replace `src={`/api/thumbnails/${photo.id}`}` with `src={thumbUrl(photo)}`.

- [ ] **Step 3: Use it in the film strip**

The strip receives `items: { id; index }[]`. Carry the version too. In `lightbox.tsx` where the strip array is built (the `out.push({ id: p.id, index: i })` loop), change to `out.push({ id: p.id, index: i, v: renditionVersion(p.updatedAt) })` and widen the local type. In `film-strip.tsx`, change `items` type to `{ id: string; index: number; v: number }[]` and the `<img>` src to `` `/api/thumbnails/${item.id}?v=${item.v}` ``.

- [ ] **Step 4: Use it for the lightbox main image**

In `apps/web/src/components/photo-grid/lightbox.tsx` `LightboxImage`, replace `const src = `/api/photos/${photo.id}/display`;` with `const src = displayUrl(photo);` (import `displayUrl`). The `useImageLoaded(src)` and `useBlurBox(...)` keys already derive from `src`/`photo.id`, so they reset correctly when the version changes.

- [ ] **Step 5: Version the neighbor preload**

In `apps/web/src/components/photo-grid/photo-collection.tsx`, in the preload effect, replace `img.src = `/api/photos/${p.id}/display`;` with `img.src = displayUrl(p);` (import from `@/lib/rendition-url`).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` → PASS.

```bash
git add apps/web/src/lib/rendition-url.ts apps/web/src/components/photo-grid/photo-thumb.tsx apps/web/src/components/photo-grid/film-strip.tsx apps/web/src/components/photo-grid/lightbox.tsx apps/web/src/components/photo-grid/photo-collection.tsx
git commit -m "feat(web): version rendition URLs with updatedAt for cache-busting"
```

---

## Task 9: Edit session (state, preview, nav guard)

**Files:**
- Create: `apps/web/src/components/photo-grid/use-edit-session.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx`

- [ ] **Step 1: Implement the edit-session provider/hook**

Create `apps/web/src/components/photo-grid/use-edit-session.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { toast } from "sonner";
import { NO_EDITS, hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { usePhotoCollection } from "./photo-collection";

interface EditSessionValue {
  working: PhotoEdits;
  dirty: boolean;
  applying: boolean;
  set: (next: PhotoEdits) => void;
  reset: () => void;
  apply: (photo: PhotoDTO) => Promise<void>;
  /** Run `go` unless there are unsaved edits and the user declines to discard. */
  guard: (go: () => void) => Promise<void>;
  /** Re-seed the working recipe for a newly shown photo. */
  seed: (photo: PhotoDTO) => void;
}

const Ctx = createContext<EditSessionValue | null>(null);

export function useEditSession(): EditSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditSession must be used within EditSessionProvider");
  return v;
}

function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return a.rotate === b.rotate && a.flipH === b.flipH && a.flipV === b.flipV;
}

export function EditSessionProvider({
  confirmDiscard,
  children,
}: {
  /** Returns true to discard unsaved edits and proceed. */
  confirmDiscard: () => Promise<boolean>;
  children: React.ReactNode;
}) {
  const { patchPhotos } = usePhotoCollection();
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<PhotoEdits>(NO_EDITS);
  const [working, setWorking] = useState<PhotoEdits>(NO_EDITS);
  const [applying, setApplying] = useState(false);

  const dirty = !sameEdits(working, saved);

  const seed = useCallback((photo: PhotoDTO) => {
    if (photo.id === savedFor) return; // don't clobber in-progress edits on re-render
    const base = photo.edits ?? NO_EDITS;
    setSaved(base);
    setWorking(base);
    setSavedFor(photo.id);
  }, [savedFor]);

  const set = useCallback((next: PhotoEdits) => setWorking(next), []);
  const reset = useCallback(() => setWorking(NO_EDITS), []);

  const apply = useCallback(
    async (photo: PhotoDTO) => {
      if (applying || !dirty) return;
      setApplying(true);
      try {
        const body = hasEdits(working) ? working : null;
        const res = await fetch(`/api/photos/${photo.id}/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ edits: body }),
        });
        if (!res.ok) throw new Error("edit failed");
        const dto = (await res.json()) as PhotoDTO;
        patchPhotos(new Set([photo.id]), {
          edits: dto.edits,
          width: dto.width,
          height: dto.height,
          thumbhash: dto.thumbhash,
          updatedAt: dto.updatedAt,
        });
        setSaved(dto.edits ?? NO_EDITS);
        setWorking(dto.edits ?? NO_EDITS);
      } catch {
        toast.error("Failed to save edits.");
      } finally {
        setApplying(false);
      }
    },
    [applying, dirty, working, patchPhotos],
  );

  const guard = useCallback(
    async (go: () => void) => {
      if (!dirty) {
        go();
        return;
      }
      if (await confirmDiscard()) {
        setWorking(saved);
        go();
      }
    },
    [dirty, saved, confirmDiscard],
  );

  return (
    <Ctx.Provider value={{ working, dirty, applying, set, reset, apply, guard, seed }}>
      {children}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 2: Wrap the lightbox and seed per photo**

In `apps/web/src/components/photo-grid/lightbox.tsx`:
- Import `EditSessionProvider`, `useEditSession`, and `useConfirm` from `@/components/confirm-dialog`.
- In `Lightbox`, create a `confirm` from `useConfirm()` and wrap the returned overlay tree in `<EditSessionProvider confirmDiscard={() => confirm({ title: "Discard edits?", description: "Your unsaved changes will be lost.", confirmLabel: "Discard", destructive: true })}>`. Render `confirmDialog` inside the overlay.
- Add an effect: when `photo` changes, call `session.seed(photo)`. Since `useEditSession` must be inside the provider, do the seeding in a small child component (e.g. the existing `LightboxImage` or a dedicated `<EditSeed photo={photo} />`) that calls `const s = useEditSession(); useEffect(() => s.seed(photo), [photo.id]);`. (Use the callback-in-effect pattern already used in this file to satisfy the react-compiler lint.)

- [ ] **Step 3: Guard all navigation exits**

Still in `lightbox.tsx`, route every navigation through `session.guard`:
- `NavArrow onClick={() => session.guard(() => step(...))}` for prev/next.
- Keyboard handler: wrap `close()` and `stepper.press(...)` calls — simplest is to call `guard` before stepping/closing. Because the keyboard effect lives above the provider, expose a ref to the session's `guard`/`dirty` (set via an effect inside a provider-child) OR move the keyboard effect into a provider-child component that can call `useEditSession()`. Prefer moving the keyboard/`step`/`close` wiring into a child of `EditSessionProvider` so it can use the hook directly.
- Film strip: `onPick={(i) => session.guard(() => open(i))}`.
- Backdrop click + Escape: `session.guard(() => close())`.

- [ ] **Step 4: Apply the live preview transform**

In `LightboxImage`, read `const { working } = useEditSession();` and apply a transform to the `<img>`:

```tsx
style={{
  transform: `scaleX(${working.flipH ? -1 : 1}) scaleY(${working.flipV ? -1 : 1}) rotate(${working.rotate}deg)`,
  transformOrigin: "center",
}}
```

For 90/270 rotations the image must still fit: wrap the `<img>` in a flex-centered container (already present) and, when `working.rotate === 90 || 270`, constrain by swapping the max bounds — set the `<img>` `className` to use `max-h-[80vh]`/`max-w-full` and add `style.maxHeight`/`maxWidth` swap, or scale to fit using the container's measured size. Keep it simple: when rotated 90/270, set the img wrapper to size by the rotated aspect using `orientedSize(photo.width, photo.height, working)`. (This is the one visually fiddly bit; verify in the browser and adjust.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-grid/use-edit-session.tsx apps/web/src/components/photo-grid/lightbox.tsx
git commit -m "feat(web): lightbox edit session with live preview + discard guard"
```

---

## Task 10: Edit tab UI

**Files:**
- Create: `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`

- [ ] **Step 1: Build the edit panel**

Create `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`:

```tsx
"use client";

import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { rotateLeft, rotateRight, toggleFlipH, toggleFlipV } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useEditSession } from "./use-edit-session";

export function LightboxEditPanel({ photo }: { photo: PhotoDTO }) {
  const { working, dirty, applying, set, reset, apply } = useEditSession();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => set(rotateLeft(working))}>
          <RotateCcw aria-hidden /> Rotate left
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(rotateRight(working))}>
          <RotateCw aria-hidden /> Rotate right
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(toggleFlipH(working))}>
          <FlipHorizontal aria-hidden /> Flip H
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(toggleFlipV(working))}>
          <FlipVertical aria-hidden /> Flip V
        </Button>
      </div>
      {dirty && <p className="text-xs text-muted-foreground">Unsaved changes</p>}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!dirty || applying} onClick={() => void apply(photo)}>
          {applying ? "Applying…" : "Apply"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={working.rotate === 0 && !working.flipH && !working.flipV}
          onClick={reset}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the Edit tab to the sidebar**

In `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`:
- Import `LightboxEditPanel`.
- Add a third trigger: `<TabsTrigger value="edit">Edit</TabsTrigger>` in the `TabsList`.
- Add the content: `<TabsContent value="edit"><LightboxEditPanel photo={photo} /></TabsContent>`.

(The sidebar already renders inside the lightbox, which now provides `EditSessionProvider`, so `useEditSession` resolves.)

- [ ] **Step 3: Verify in the browser**

`pnpm dev`, open a photo, go to the Edit tab:
- Rotate left/right and flip update the center image instantly.
- "Unsaved changes" appears; Apply persists (spinner → grid thumbnail + lightbox reflect the edit; the tile re-lays-out on 90/270).
- Reset returns the preview to original; Apply persists the reset.
- Switching photos / closing with unsaved edits prompts "Discard edits?".

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-edit-panel.tsx apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(web): Edit tab with rotate/flip controls"
```

---

## Task 11: Split download button (lightbox)

**Files:**
- Create: `apps/web/src/components/photo-actions/download-split-button.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`

- [ ] **Step 1: Build the split button**

Create `apps/web/src/components/photo-actions/download-split-button.tsx`. Primary click downloads edited; a hover/focus-revealed menu offers both. Use the existing `DropdownMenu` primitives (open on hover via `onMouseEnter`/`onMouseLeave` controlling `open`), or a `HoverCard`. Example with `DropdownMenu`:

```tsx
"use client";

import { useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DownloadSplitButton({
  onDownloadEdited,
  onDownloadOriginal,
}: {
  onDownloadEdited: () => void;
  onDownloadOriginal: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex w-full"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Button variant="outline" size="sm" className="flex-1 rounded-r-none" onClick={onDownloadEdited}>
        <Download aria-hidden /> Download
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-l-none border-l-0 px-2" aria-label="Download options">
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDownloadEdited}>Download edited</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDownloadOriginal}>Download original</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the sidebar**

In `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`, replace the current Download `<a>` block with conditional rendering:

```tsx
import { hasEdits } from "@lumio/shared";
import { downloadFromUrl } from "@/lib/download-client";
import { DownloadSplitButton } from "@/components/photo-actions/download-split-button";
// ...
{hasEdits(photo.edits) ? (
  <DownloadSplitButton
    onDownloadEdited={() => downloadFromUrl(`/api/photos/${photo.id}/edited?download=1`)}
    onDownloadOriginal={() => downloadFromUrl(`/api/photos/${photo.id}/original?download=1`)}
  />
) : (
  <Button asChild variant="outline" size="sm" className="w-full">
    <a href={`/api/photos/${photo.id}/original?download=1`}>
      <Download aria-hidden /> Download
    </a>
  </Button>
)}
```

(`downloadFromUrl` is already exported from `download-client.ts`.)

- [ ] **Step 3: Verify**

Edited photo → hovering the Download button reveals edited/original; click downloads edited. Unedited photo → plain Download (original). Confirm files are correct.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-actions/download-split-button.tsx apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(web): split edited/original download in the lightbox"
```

---

## Task 12: Adaptive context-menu download

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-collection.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-context-menu.tsx`

- [ ] **Step 1: Expose `photosByIds` + an optional collection hook**

In `apps/web/src/components/photo-grid/photo-collection.tsx`:
- Add to `PhotoCollectionValue`: `photosByIds: (ids: string[]) => PhotoDTO[];`.
- Implement using existing primitives (no new store API):

```ts
const photosByIds = useCallback(
  (ids: string[]): PhotoDTO[] => {
    const loaded = getLoadedIds(); // sparse array: index -> id
    const out: PhotoDTO[] = [];
    for (const id of ids) {
      const idx = loaded.indexOf(id);
      if (idx !== -1) {
        const p = photoForIndex(idx);
        if (p) out.push(p);
      }
    }
    return out;
  },
  [getLoadedIds, photoForIndex],
);
```

  Add `photosByIds` to the `value` object and its dependency array.
- Add a non-throwing accessor for components that may render outside a provider:

```ts
export function usePhotoCollectionOptional(): PhotoCollectionValue | null {
  return useContext(Ctx);
}
```

- [ ] **Step 2: Make the context menu adaptive**

In `apps/web/src/components/photo-grid/photo-context-menu.tsx`:
- Call `const collection = usePhotoCollectionOptional();` at the top (before any early return is fine — it's a plain `useContext`, safe to call unconditionally; keep it above the `if (!actions)` return per rules-of-hooks by placing both hook calls first).
- Compute: `const anyEdited = (collection?.photosByIds(targetIds) ?? []).some((p) => hasEdits(p.edits));` (import `hasEdits`).
- Replace the single Download `ContextMenuItem` with:

```tsx
{anyEdited ? (
  <>
    <ContextMenuItem onSelect={() => void actions.download(targetIds, { variant: "edited" })}>
      <Download aria-hidden />
      Download {photos} edited
    </ContextMenuItem>
    <ContextMenuItem onSelect={() => void actions.download(targetIds, { variant: "original" })}>
      <Download aria-hidden />
      Download {photos} original
    </ContextMenuItem>
  </>
) : (
  <ContextMenuItem onSelect={() => void actions.download(targetIds)}>
    <Download aria-hidden />
    Download {photos}
  </ContextMenuItem>
)}
```

(`actions.download` accepts `{ variant }` from Task 7. The phrasing "Download N photos edited/original" — adjust copy to taste, e.g. "Download N edited".)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify**

- Select a mix including ≥1 edited photo → right-click shows two Download items (edited downloads a zip with edited JPEGs + original bytes for the rest; original downloads originals).
- Select only unedited photos → single "Download N photos" as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-collection.tsx apps/web/src/components/photo-grid/photo-context-menu.tsx
git commit -m "feat(web): adaptive edited/original download in the context menu"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm -r test`
Expected: PASS across all packages.

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint (if configured)**

Run: `pnpm --filter @lumio/web lint` (skip if no such script).
Expected: PASS — especially the react-compiler rules (`"use client"` first line; no setState-in-effect; refs-in-effect pattern).

- [ ] **Step 4: Manual browser walkthrough (record a GIF if helpful)**

Verify end to end:
1. Rotate left/right, flip H/V show instant live preview matching the saved result.
2. Apply updates the grid thumbnail (with correct aspect on 90/270), the lightbox, and the film strip (cache-bust works — no stale image).
3. Reset → Apply restores the original everywhere.
4. Nav to another photo / close with unsaved edits prompts to discard; Discard loses changes, Cancel keeps editing.
5. Lightbox split download: edited (primary + menu) and original (menu) produce correct files; unedited photo shows the plain Download.
6. Context menu: mixed selection shows two items; all-unedited shows one; the edited zip contains edited JPEGs and untouched originals.
7. Re-ingest / watcher of an unedited photo still works (no regression in `process.ts`).

- [ ] **Step 5: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test: photo editing verification fixes"
```

---

## Notes for the implementer

- **Barrel exports:** confirm `@lumio/ingest` and `@lumio/shared` export the new symbols (`buildRenditions`, `applyEdits`, `decodeToSharpInput`, `coercePhotoEdits`, `photoEditsSchema`, `editPhotoSchema`, `downloadRequestSchema`, recipe helpers). Add to each package's `src/index.ts` if missing.
- **Prisma JSON null:** use `Prisma.JsonNull` (not JS `null`) when writing `edits` to clear it.
- **react-compiler lint (project rule):** `"use client"` on line 1; don't call setState directly in an effect body (use a callback as the existing lightbox code does); don't mutate refs during render.
- **Don't touch `ui/*`:** compose the split button / tabs from existing primitives.
- **Performance:** the no-edit path in `buildRenditions` is byte-for-byte the old ingest pipeline — keep it that way (only the edited path bakes an extra buffer).
