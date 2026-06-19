# Photo Grid — Phase 2: ThumbHash Progressive Placeholders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a blurred color preview (ThumbHash) for each photo between the gray skeleton and the real thumbnail — carried in the list payload so a whole screen previews from one request.

**Architecture:** Store a compact ThumbHash (base64, ~33 chars) per photo. Compute it in the ingest pipeline from the generated thumbnail (so a backfill can recompute identically from existing thumbnails). Ship it in `PhotoDTO`; the client decodes it to a data-URL placeholder that fades out when the real `<img>` loads.

**Tech Stack:** Prisma/Postgres migration, `sharp` (already an ingest dep), the `thumbhash` npm package (isomorphic, tiny, no native deps), Next.js client component, Vitest.

**Layering recap:** Phase 1's per-cell gray skeleton is the base; this adds the blur layer between skeleton and photo. Skeleton (cell has no data) → blur (cell loaded, `<img>` not yet decoded) → photo.

---

## File Structure
- `packages/db/prisma/schema.prisma` (+ generated migration) — `thumbhash String?` on `Photo` and `TrashedPhoto`.
- `packages/shared/src/types.ts` — `thumbhash` on `PhotoDTO`.
- `packages/db/src/mappers.ts` — map `thumbhash` in `toPhotoDTO` + `toTrashedPhotoDTO`.
- `packages/ingest/src/thumbhash.ts` *(new)* + `index.ts` export — `computeThumbhash(thumbnail)`.
- `packages/ingest/src/process.ts` — compute + return `thumbhash` on `ProcessedPhoto`.
- `packages/ingest/src/store.ts` — persist `thumbhash`.
- `apps/web/src/lib/trash-service.ts` — copy `thumbhash` on trash snapshot + restore.
- `apps/worker/src/backfill-thumbhash.ts` *(new)* + worker `package.json` script — backfill existing photos.
- `apps/web/src/components/photo-grid/photo-thumb.tsx` — decode + render the blur placeholder.
- `package.json` deps: `thumbhash` in `@lumio/ingest` and `@lumio/web`.

---

### Task 1: Add `thumbhash` to `PhotoDTO` + mappers (null-safe, no behavior yet)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/db/src/mappers.ts`

- [ ] **Step 1: Add the field to `PhotoDTO`**

In `packages/shared/src/types.ts`, add to the `PhotoDTO` interface (after `hash`):

```ts
  hash: string | null;
  /** Base64 ThumbHash — a ~25-byte blurred preview shown while the thumbnail loads. */
  thumbhash: string | null;
```

- [ ] **Step 2: Map it (will not typecheck against Prisma until Task 2 adds the column — that's expected; this commit's verification is the shared build only)**

In `packages/db/src/mappers.ts`, add `thumbhash: row.thumbhash,` after the `hash:` line in BOTH `toPhotoDTO` and `toTrashedPhotoDTO`:

```ts
    hash: row.hash,
    thumbhash: row.thumbhash,
```

- [ ] **Step 3: Verify shared package compiles**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit`
Expected: PASS. (`@lumio/db` will not typecheck until Task 2 — that's why Task 2 follows immediately.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/db/src/mappers.ts
git commit -m "feat(shared): add thumbhash to PhotoDTO + mappers"
```

---

### Task 2: DB migration — `thumbhash` column on `Photo` and `TrashedPhoto`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: a Prisma migration (generated)

- [ ] **Step 1: Add the columns**

In `packages/db/prisma/schema.prisma`, add to `model Photo` (after the `hash` line):

```prisma
  hash       String?
  thumbhash  String?
```

And to `model TrashedPhoto` (after its `hash` line):

```prisma
  hash         String?
  thumbhash    String?
```

- [ ] **Step 2: Generate + apply the migration (DB must be running on :5433)**

Run: `pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate dev --name add_thumbhash`
Expected: creates `packages/db/prisma/migrations/<ts>_add_thumbhash/migration.sql` containing two `ALTER TABLE ... ADD COLUMN "thumbhash"`, applies it, and regenerates the Prisma client.

- [ ] **Step 3: Verify the whole db + web typecheck now (mappers compile against the new column)**

Run: `pnpm --filter @lumio/db exec tsc --noEmit && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm -r test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add thumbhash column to Photo and TrashedPhoto"
```

---

### Task 3: `computeThumbhash` helper + ingest pipeline

**Files:**
- Create: `packages/ingest/src/thumbhash.ts`
- Create: `packages/ingest/src/thumbhash.test.ts`
- Modify: `packages/ingest/src/index.ts` (export)
- Modify: `packages/ingest/src/process.ts`
- Modify: `packages/ingest/src/store.ts`
- Add dep: `thumbhash` to `@lumio/ingest`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @lumio/ingest add thumbhash`

- [ ] **Step 2: Write the failing test**

```ts
// packages/ingest/src/thumbhash.test.ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { computeThumbhash } from "./thumbhash.js";

describe("computeThumbhash", () => {
  it("returns a short base64 hash for an image buffer", async () => {
    // a 64x64 solid-red webp
    const img = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .webp()
      .toBuffer();
    const hash = await computeThumbhash(img);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash.length).toBeLessThan(60); // ThumbHash is ~25 bytes → ~33 base64 chars
    // deterministic
    expect(await computeThumbhash(img)).toBe(hash);
  });
});
```

- [ ] **Step 3: Run it (fails — module missing)**

Run: `pnpm --filter @lumio/ingest exec vitest run src/thumbhash.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the helper**

```ts
// packages/ingest/src/thumbhash.ts
import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";

/**
 * Compute a base64 ThumbHash from an image (a Buffer or a file path). ThumbHash
 * needs raw RGBA at <=100px per side. We feed it the already-generated thumbnail
 * so the ingest pipeline and the backfill produce identical hashes.
 */
export async function computeThumbhash(image: string | Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .resize(100, 100, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = rgbaToThumbHash(info.width, info.height, new Uint8Array(data));
  return Buffer.from(hash).toString("base64");
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter @lumio/ingest exec vitest run src/thumbhash.test.ts`
Expected: PASS.

- [ ] **Step 6: Export from the package index**

In `packages/ingest/src/index.ts`, add:

```ts
export { computeThumbhash } from "./thumbhash.js";
```

- [ ] **Step 7: Wire into `process.ts`**

In `packages/ingest/src/process.ts`:
- Add `thumbhash: string;` to the `ProcessedPhoto` interface (after `hash: string;`).
- Import: `import { computeThumbhash } from "./thumbhash.js";`
- After the `thumbnail` buffer is created, compute the hash from it, and include it in the returned object:

```ts
    const thumbnail = await sharp(decoded.path)
      .rotate()
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbhash = await computeThumbhash(thumbnail);
```

and in the return:

```ts
    return { width: meta.width ?? 0, height: meta.height ?? 0, takenAt, hash, exif, thumbnail, display, thumbhash };
```

- [ ] **Step 8: Persist in `store.ts`**

In `packages/ingest/src/store.ts`, add `thumbhash: processed.thumbhash,` to the `data` object (after `hash`):

```ts
  const data = {
    takenAt: processed.takenAt,
    sortDate: processed.takenAt ?? new Date(),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
  };
```

- [ ] **Step 9: Update `process.test.ts` and `store.test.ts` for the new field**

Read both test files. In `process.test.ts`, any assertion on the full `ProcessedPhoto` shape must include `thumbhash` (a string). In `store.test.ts`, any `ProcessedPhoto` fixture must add `thumbhash: "AAAA"` (or similar) and, if the test asserts the upsert `data`, include `thumbhash`. Make these surgical — do not remove other assertions.

- [ ] **Step 10: Run the ingest suite + typecheck**

Run: `pnpm --filter @lumio/ingest exec vitest run && pnpm --filter @lumio/ingest exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/ingest package.json pnpm-lock.yaml
git commit -m "feat(ingest): compute + persist thumbhash for new photos"
```

---

### Task 4: Copy thumbhash through trash snapshot + restore

**Files:**
- Modify: `apps/web/src/lib/trash-service.ts`

- [ ] **Step 1: Snapshot on trash**

In `trashPhotos`, the `deps.db.trashedPhoto.create({ data: { ... } })` snapshot currently copies `hash: photo.hash,`. Add directly after it:

```ts
        hash: photo.hash,
        thumbhash: photo.thumbhash,
```

- [ ] **Step 2: Restore back to Photo**

In `restorePhotos`, the `deps.db.photo.create({ data: { ... } })` copies `hash: t.hash,`. Add after it:

```ts
        hash: t.hash,
        thumbhash: t.thumbhash,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/trash-service.ts
git commit -m "feat(trash): carry thumbhash through trash snapshot and restore"
```

---

### Task 5: Backfill existing photos from their thumbnails

**Files:**
- Create: `apps/worker/src/backfill-thumbhash.ts`
- Modify: `apps/worker/package.json` (add a script)

- [ ] **Step 1: Write the backfill script**

```ts
// apps/worker/src/backfill-thumbhash.ts
import { readFile } from "node:fs/promises";
import { prisma } from "@lumio/db";
import { computeThumbhash } from "@lumio/ingest";
import { thumbnailPath } from "./config.js";

/**
 * One-time backfill: compute a ThumbHash for every photo missing one, reading
 * the already-generated thumbnail (no originals needed). Idempotent — rerunning
 * only touches rows still null. Tolerates a missing thumbnail file (skips it).
 */
async function main(): Promise<void> {
  const rows = await prisma.photo.findMany({
    where: { thumbhash: null },
    select: { id: true },
  });
  console.log(`Backfilling thumbhash for ${rows.length} photos…`);
  let done = 0;
  let skipped = 0;
  for (const { id } of rows) {
    try {
      const buf = await readFile(thumbnailPath(id));
      const thumbhash = await computeThumbhash(buf);
      await prisma.photo.update({ where: { id }, data: { thumbhash } });
      done++;
    } catch {
      skipped++; // missing/unreadable thumbnail — leave null, retry on a later run
    }
    if ((done + skipped) % 200 === 0) {
      console.log(`  ${done + skipped}/${rows.length} (updated ${done}, skipped ${skipped})`);
    }
  }
  console.log(`Backfill complete — updated ${done}, skipped ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 2: Add the worker script**

In `apps/worker/package.json` `scripts`, add (mirroring the existing `ingest` script's dotenv pattern):

```json
    "backfill:thumbhash": "dotenv -e ../../.env -- tsx src/backfill-thumbhash.ts",
```

- [ ] **Step 3: Typecheck the worker**

Run: `pnpm --filter @lumio/worker exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run the backfill (DB running, thumbnails present)**

Run: `pnpm --filter @lumio/worker backfill:thumbhash`
Expected: logs progress and "Backfill complete — updated N, skipped M." Verify a couple of rows now have a non-null thumbhash:
`pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma db execute --stdin <<< 'SELECT count(*) FILTER (WHERE thumbhash IS NOT NULL) AS with_hash, count(*) AS total FROM "Photo";'`
(or open Prisma Studio). Most/all should have a hash.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/backfill-thumbhash.ts apps/worker/package.json
git commit -m "feat(worker): one-time thumbhash backfill from existing thumbnails"
```

---

### Task 6: Client — render the blur placeholder

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-thumb.tsx`
- Add dep: `thumbhash` to `@lumio/web`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @lumio/web add thumbhash`

- [ ] **Step 2: Update `PhotoThumb`**

Read `apps/web/src/components/photo-grid/photo-thumb.tsx`. Add a decoded-placeholder layer behind the `<img>` and fade it out when the image loads. Make these changes:

- At the top of the file add:
```tsx
import { useMemo, useState } from "react";
import { thumbHashToDataURL } from "thumbhash";
```

- Inside `PhotoThumb`, before the `return`, add:
```tsx
  const [loaded, setLoaded] = useState(false);
  const blurUrl = useMemo(() => {
    if (!photo.thumbhash) return null;
    try {
      const bytes = Uint8Array.from(atob(photo.thumbhash), (c) => c.charCodeAt(0));
      return thumbHashToDataURL(bytes);
    } catch {
      return null;
    }
  }, [photo.thumbhash]);
```

- Inside the outer wrapper `<div className="group/tile relative ...">`, add the placeholder as the FIRST child (so it sits behind the image):
```tsx
      {blurUrl && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-sm bg-cover bg-center transition-opacity duration-300"
          style={{ backgroundImage: `url(${blurUrl})`, opacity: loaded ? 0 : 1 }}
        />
      )}
```

- On the `<img>`, add `onLoad={() => setLoaded(true)}` and ensure it sits above the placeholder (it already has `absolute`; the placeholder is also absolute and rendered first, so the image paints on top). Keep all existing `<img>` attributes (`loading="lazy"`, `decoding="async"`, the transform style, etc.).

- [ ] **Step 3: Typecheck + lint + unit suite**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web exec vitest run`
Expected: PASS (no new unit tests; this is browser-verified).

- [ ] **Step 4: Browser verification**

Open `/photos`, hard-reload. On a fresh load you should briefly see each tile show a **blurred color preview** that sharpens into the photo (most visible on a throttled network — DevTools → Network → Slow 3G makes the blur-then-sharpen obvious). No layout shift; no broken images. Album/search/trash grids unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-thumb.tsx package.json pnpm-lock.yaml
git commit -m "feat(grid): ThumbHash blur placeholder that fades to the thumbnail"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `pnpm -r test` → all pass.
- [ ] **Step 2:** `pnpm --filter @lumio/web exec tsc --noEmit` → clean.
- [ ] **Step 3:** `pnpm --filter @lumio/web build` → succeeds.
- [ ] **Step 4:** Browser pass on `/photos`, `/albums/<id>`, `/search`, `/trash`: blur previews appear then sharpen; the gray skeleton still shows for not-yet-loaded cells (Phase 1 layer); no regressions.
- [ ] **Step 5:** Confirm new imports/uploads also get a thumbhash (run `pnpm --filter @lumio/worker ingest` or upload a photo, then check the row has a non-null thumbhash) — proves the pipeline path, not just the backfill.

---

## Self-Review

**Spec coverage:** DB column on Photo+TrashedPhoto (T2) ✓; pipeline compute+persist (T3) ✓; backfill from existing thumbnails (T5) ✓; DTO field (T1) ✓; client decode+fade (T6) ✓; trash carry-through (T4) ✓; `thumbhash` dep server+client (T3, T6) ✓.

**Placeholder scan:** none — every code step is complete; commands are exact.

**Type consistency:** `computeThumbhash(image: string | Buffer): Promise<string>` defined in T3, used in T3 (process) and T5 (backfill, via the package export). `thumbhash` on `PhotoDTO` (T1) is read in `photo-thumb.tsx` (T6). `ProcessedPhoto.thumbhash` (T3) persisted in `store.ts` (T3). Prisma `thumbhash` column (T2) read by mappers (T1) and written by store/trash (T3/T4).

**Note on ordering:** Task 1 intentionally leaves `@lumio/db` not-yet-typechecking (the Prisma `Photo` type lacks `thumbhash` until Task 2's migrate regenerates the client). Task 2 immediately resolves it; Task 1's gate is the shared-package typecheck only.
