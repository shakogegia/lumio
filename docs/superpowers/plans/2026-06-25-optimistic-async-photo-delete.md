# Optimistic, Worker-Finalized Photo Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Backspace/Delete shortcut (grid + lightbox) that moves selected photos to Trash optimistically — tiles vanish instantly with an Undo toast — while a background worker performs the snapshot + file moves asynchronously.

**Architecture:** Soft-delete marker (`Photo.trashedAt`). The web request only sets the marker and enqueues a `process_trash` job, returning instantly. A worker job (`finalizeTrash`) drains marked rows: snapshot → `TrashedPhoto`, move files, delete the row. All live-photo queries filter `trashedAt IS NULL`. Trash view/restore/purge become dual-state (pending `Photo` ∪ finalized `TrashedPhoto`). The client removes tiles immediately, fires the POST in the background, and offers Undo (dual-state restore) + reload-based rollback.

**Tech Stack:** Next.js (App Router, REST route handlers), Prisma 6 + Postgres, a custom Postgres-backed job queue (`@lumio/jobs` + `apps/worker`), React 19 client store (`usePhotoPages` sparse page store), sonner toasts, vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-optimistic-async-photo-delete-design.md`

---

## File Structure

**Created:**
- `packages/db/prisma/migrations/<ts>_add_photo_trashed_at/migration.sql` — the `trashedAt` column + index.
- `packages/jobs/src/finalize-trash.ts` — worker drain logic (port of today's `trashPhotos` per-photo file/db ops + drain loop).
- `packages/jobs/src/finalize-trash.test.ts` — unit test for the drain.
- `apps/web/src/lib/server/photo-filters.ts` — `LIVE_PHOTO` where-fragment (greppable single source).
- `apps/web/src/lib/trash-optimistic.ts` — shared optimistic-trash + Undo helper (grid + lightbox).

**Modified:**
- `packages/db/prisma/schema.prisma` — add `trashedAt` to `Photo`.
- `packages/shared/src/jobs.ts` — add `JobType.process_trash`.
- `packages/jobs/src/purge.ts` — add `purgePendingPhotos`.
- `packages/jobs/src/index.ts` — export `finalizeTrash`, `purgePendingPhotos` (verify barrel).
- `apps/worker/src/handlers.ts` — handle `process_trash`; extend empty-trash to purge pending.
- `apps/web/src/lib/server/photos-service.ts` — `LIVE_PHOTO` on list/neighbors/getPhoto.
- `apps/web/src/lib/server/albums-service.ts` — `LIVE_PHOTO` on summaries/download.
- `apps/web/src/lib/server/folders-service.ts` — `LIVE_PHOTO` on summaries/counts.
- `apps/web/src/lib/server/calendar-service.ts` — `LIVE_PHOTO` on facets.
- `apps/web/src/lib/server/search-service.ts` — `LIVE_PHOTO` on count.
- `apps/web/src/lib/server/locate-photo.ts` — `LIVE_PHOTO` on locate.
- `apps/web/src/lib/server/status-service.ts` — `LIVE_PHOTO` on stats.
- `apps/web/src/lib/server/catalog-fs-service.ts` — `LIVE_PHOTO` on subtree count.
- `apps/web/src/lib/server/trash-service.ts` — `listTrash` UNION + dual-state `restorePhotos`; delete old `trashPhotos`.
- `apps/web/src/app/api/c/[catalog]/photos/trash/route.ts` — mark + enqueue (no file I/O).
- `apps/web/src/app/api/c/[catalog]/trash/purge/route.ts` — also purge pending.
- `apps/web/src/lib/photo-mutations.ts` — add `restorePhotos` client wrapper.
- `apps/web/src/features/photo-grid/use-photo-pages.ts` — add `reload()`.
- `apps/web/src/features/photo-grid/photo-page-store.ts` — add `resetStore()`.
- `apps/web/src/features/photo-grid/photo-page-store.test.ts` — test `resetStore` (create if missing).
- `apps/web/src/features/photo-grid/photo-collection.tsx` — expose `reload`.
- `apps/web/src/features/photo-grid/photo-grid.tsx` — add `reload` to `PhotoGridHandle`.
- `apps/web/src/components/photo-actions/use-photo-actions.tsx` — optimistic `trash()`.
- `apps/web/src/components/photo-actions/selection-actions.tsx` — drop trash spinner.
- `apps/web/src/features/lightbox/lightbox-actions.tsx` — optimistic trash.
- `apps/web/src/features/lightbox/use-lightbox-keyboard.ts` — Backspace/Delete → `trashCurrent`.
- `apps/web/src/features/lightbox/lightbox.tsx` — wire `trashCurrent`.
- `apps/web/src/lib/grid-shortcut.ts` — Backspace/Delete → `{ kind: "trash" }`.
- `apps/web/src/lib/grid-shortcut.test.ts` — new cases (create if missing).
- `apps/web/src/features/photo-grid/grid-shortcuts.tsx` — dispatch trash.

**Test commands** (run a single file): `pnpm -C apps/web exec vitest run <relative-path>` and `pnpm -C packages/jobs exec vitest run <relative-path>`. Typecheck a package: `pnpm -C apps/web exec tsc --noEmit`.

---

## Phase 1 — Data model + live-view filter

### Task 1: Add the `trashedAt` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Photo model, lines 69-103)
- Create: `packages/db/prisma/migrations/<ts>_add_photo_trashed_at/migration.sql`

> ⚠️ **Shared-DB caveat** ([[lumio-shared-db-drift]]): this dev Postgres is shared across worktrees, so other branches' migrations look like drift and `prisma migrate dev` may try to **reset** — do not let it. Use `--create-only` to author the migration, then apply just this additive, idempotent column manually. Coordinate with the user before applying (per the spec's open-coordination note).

- [ ] **Step 1: Add the field + index to the schema**

In `packages/db/prisma/schema.prisma`, inside `model Photo`, add the field after `isFavorite Boolean @default(false)` (line 91):

```prisma
  trashedAt      DateTime?
```

And add this index alongside the other `@@index` lines (after `@@index([isFavorite, sortDate])`):

```prisma
  @@index([catalogId, trashedAt])
```

- [ ] **Step 2: Author the migration without applying it**

Run:
```bash
pnpm -C packages/db exec dotenv -e ../../.env -- prisma migrate dev --create-only --name add_photo_trashed_at
```
Expected: creates `packages/db/prisma/migrations/<ts>_add_photo_trashed_at/migration.sql` and does NOT modify the database. If it instead reports drift / offers to reset, answer **No** and fall back to writing the migration file by hand (Step 3).

- [ ] **Step 3: Ensure the migration SQL is additive + idempotent**

Open the generated `migration.sql` and confirm it is exactly (edit to add `IF NOT EXISTS` so a re-run on the shared DB is safe):

```sql
-- AlterTable
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "trashedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Photo_catalogId_trashedAt_idx" ON "Photo"("catalogId", "trashedAt");
```

- [ ] **Step 4: Apply the column + regenerate the client**

Apply just this additive change (does not reset, does not touch migration history):
```bash
pnpm -C packages/db exec dotenv -e ../../.env -- prisma db execute --file prisma/migrations/<ts>_add_photo_trashed_at/migration.sql --schema prisma/schema.prisma
pnpm -C packages/db exec prisma generate
```
Expected: `prisma generate` succeeds and the generated client now types `Photo.trashedAt: Date | null`.

- [ ] **Step 5: Verify the column exists**

Run:
```bash
pnpm -C packages/db exec dotenv -e ../../.env -- prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='Photo' AND column_name='trashedAt';
SQL
```
Expected: one row `trashedAt`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Photo.trashedAt soft-delete marker"
```

---

### Task 2: `LIVE_PHOTO` filter + apply to every live-photo query

**Files:**
- Create: `apps/web/src/lib/server/photo-filters.ts`
- Modify: `photos-service.ts`, `albums-service.ts`, `folders-service.ts`, `calendar-service.ts`, `search-service.ts`, `locate-photo.ts`, `status-service.ts`, `catalog-fs-service.ts`
- Test: `apps/web/src/lib/server/photo-filters.test.ts` (create)

**Rule:** every query returning *live* photos to a user-facing view gets `...LIVE_PHOTO`. Explicit-id mutations (`setPhotoFavorite`, `setPhotoColorLabel`), file-serving (`getPhotoFile`), existence checks used by the trash/edit paths, and the trash/finalize/restore/purge code do **not**.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/photo-filters.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listPhotos } from "./photos-service";

describe("live-photo filter", () => {
  it("listPhotos excludes trashed (pending) photos via trashedAt: null", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const db = { photo: { findMany, count } } as never;
    await listPhotos("cat1", { limit: 50, offset: 0 } as never, db);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: "cat1", trashedAt: null }) }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: "cat1", trashedAt: null }) }),
    );
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C apps/web exec vitest run src/lib/server/photo-filters.test.ts`
Expected: FAIL — `where` lacks `trashedAt: null`.

- [ ] **Step 3: Create the filter constant**

Create `apps/web/src/lib/server/photo-filters.ts`:

```ts
import type { Prisma } from "@lumio/db";

/**
 * Where-fragment selecting only LIVE photos (not pending-trash). A photo marked
 * `trashedAt` is awaiting the worker's finalize and must not appear in any
 * user-facing list/count/cover. Spread (`...LIVE_PHOTO`) into every live-photo
 * query. The trash/finalize/restore/purge paths deliberately omit it.
 */
export const LIVE_PHOTO = { trashedAt: null } satisfies Prisma.PhotoWhereInput;
```

- [ ] **Step 4: Apply to `photos-service.ts`**

In `listPhotosForWhere` (line 41), change:
```ts
  const full: Prisma.PhotoWhereInput = { catalogId, ...where };
```
to:
```ts
  const full: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };
```

In `getNeighborsForWhere` (line 164), the `where` is supplied by callers; add the filter at both `findMany` calls (lines 174, 182) by replacing `where,` with `where: { ...where, ...LIVE_PHOTO },` in each.

In `getPhoto` (line 126), change the lookup to exclude pending so a deep-link to a just-trashed photo 404s:
```ts
  const row = await db.photo.findFirst({ where: { id, catalogId, ...LIVE_PHOTO }, include: { albums: { select: { albumId: true } } } });
```

Add the import at the top of `photos-service.ts`:
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 5: Apply to `albums-service.ts`**

Add import:
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```
In `albumSummary` (line 28), change `const where = { catalogId, ...smartWhere };` to `const where = { catalogId, ...LIVE_PHOTO, ...smartWhere };`.
In `listAlbumPhotosForDownload` (line 152), change `where: { catalogId, ...scoped },` to `where: { catalogId, ...LIVE_PHOTO, ...scoped },`.
In `addPhotosToAlbum` (line 195), change the `owned` lookup `where: { catalogId, id: { in: photoIds } },` to `where: { catalogId, ...LIVE_PHOTO, id: { in: photoIds } },`.

- [ ] **Step 6: Apply to `folders-service.ts`**

Add import:
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```
In `folderSummary` (line 67), change `const where = { catalogId, ...scopedWhere };` to `const where = { catalogId, ...LIVE_PHOTO, ...scopedWhere };`.
In `listFolderContents` (line 138), change `db.photo.count({ where: { catalogId, ...scopedWhere } });` to `db.photo.count({ where: { catalogId, ...LIVE_PHOTO, ...scopedWhere } });`.

- [ ] **Step 7: Apply to `calendar-service.ts`**

Add import and change `buildCalendarFacets` (line 32) `const scopedWhere: Prisma.PhotoWhereInput = { catalogId, ...where };` to `const scopedWhere: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };`.
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 8: Apply to `search-service.ts`**

Add import. In `searchWhere` (line 24), change `const withCatalog = { catalogId, ...buildSearchWhere(params) };` to `const withCatalog = { catalogId, ...LIVE_PHOTO, ...buildSearchWhere(params) };` (this covers `countSearchPhotos`; the list path already routes through `listPhotosForWhere`, filtered in Step 4).
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 9: Apply to `locate-photo.ts`**

Add import. In `locatePhoto` (line 72), change `const catalogScoped = { catalogId, ...scopeWhere };` to `const catalogScoped = { catalogId, ...LIVE_PHOTO, ...scopeWhere };`, and the row lookup (line 65) `where: { id, catalogId },` to `where: { id, catalogId, ...LIVE_PHOTO },`.
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 10: Apply to `status-service.ts`**

Add import. At the photo count + latest queries (lines 63-64), add `...LIVE_PHOTO` into the `where`:
```ts
    prisma.photo.count({ where: { catalogId, ...LIVE_PHOTO } }),
    prisma.photo.findFirst({
      where: { catalogId, ...LIVE_PHOTO },
```
(keep the rest of the `findFirst` args). Add:
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 11: Apply to `catalog-fs-service.ts`**

Add import. At line 32, change `countPhotos: (catalogId, rel) => prisma.photo.count({ where: subtreeWhere(catalogId, rel) }),` to spread the filter into the where:
```ts
  countPhotos: (catalogId, rel) => prisma.photo.count({ where: { ...subtreeWhere(catalogId, rel), ...LIVE_PHOTO } }),
```
Add:
```ts
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
```

- [ ] **Step 12: Run the test — verify it passes**

Run: `pnpm -C apps/web exec vitest run src/lib/server/photo-filters.test.ts`
Expected: PASS.

- [ ] **Step 13: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/lib/server
git commit -m "feat(web): exclude pending-trash photos from all live queries"
```

---

## Phase 2 — Worker finalize + fast trash route

### Task 3: `process_trash` job type + `finalizeTrash` drain

**Files:**
- Modify: `packages/shared/src/jobs.ts` (lines 4-8)
- Create: `packages/jobs/src/finalize-trash.ts`
- Create: `packages/jobs/src/finalize-trash.test.ts`
- Modify: `packages/jobs/src/index.ts` (barrel export)

- [ ] **Step 1: Add the job type**

In `packages/shared/src/jobs.ts`, add to the `JobType` enum (after `empty_trash = "empty_trash",`):
```ts
  process_trash = "process_trash",
```

- [ ] **Step 2: Write the failing test**

Create `packages/jobs/src/finalize-trash.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { finalizeTrash } from "./finalize-trash.js";

function photoRow(id: string) {
  return {
    id, path: `${id}.jpg`, source: "filesystem", takenAt: null, sortDate: new Date(0),
    width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null,
    albums: [{ albumId: "a1" }],
  };
}

describe("finalizeTrash", () => {
  it("drains all pending photos: snapshot, move files, delete row; loops until empty", async () => {
    const pending = [photoRow("p1"), photoRow("p2")];
    const findFirst = vi
      .fn()
      // drain loop: first call returns p1, second p2, third none
      .mockResolvedValueOnce(pending[0])
      .mockResolvedValueOnce(pending[1])
      .mockResolvedValueOnce(null);
    const create = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { findFirst, deleteMany }, trashedPhoto: { create } } as never;
    const moveFile = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeTrash({
      db, catalogId: "cat1", photosDir: "/photos", cacheDir: "/cache", trashDir: "/trash", moveFile,
    });

    expect(result).toEqual({ finalized: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: "p1", albumIds: ["a1"] }) }));
    expect(moveFile).toHaveBeenCalledTimes(6); // 3 files × 2 photos
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "p1", catalogId: "cat1" } });
  });

  it("skips a photo whose trashedAt was cleared (undo) — only finds still-pending rows", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null); // nothing pending
    const db = { photo: { findFirst, deleteMany: vi.fn() }, trashedPhoto: { create: vi.fn() } } as never;
    const result = await finalizeTrash({
      db, catalogId: "cat1", photosDir: "/p", cacheDir: "/c", trashDir: "/t", moveFile: vi.fn(),
    });
    expect(result).toEqual({ finalized: 0 });
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm -C packages/jobs exec vitest run src/finalize-trash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `finalizeTrash`**

Create `packages/jobs/src/finalize-trash.ts` (a 1:1 port of the proven file/db ops in `apps/web/src/lib/server/trash-service.ts:trashPhotos`, driven by a `trashedAt`-keyed drain loop, with an injectable `moveFile` for tests):

```ts
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";

type Db = Pick<PrismaClient, "photo" | "trashedPhoto">;

export interface FinalizeTrashDeps {
  db: Db;
  catalogId: string;
  /** Catalog originals dir (catalog.path). */
  photosDir: string;
  /** Per-catalog cache dir (CACHE_DIR/<catalogId>). */
  cacheDir: string;
  /** Per-catalog trash dir (TRASH_DIR/<catalogId>). */
  trashDir: string;
  /** Injectable for tests; defaults to the real move. */
  moveFile?: (from: string, to: string) => Promise<void>;
}

/** Move a file, tolerating a missing source and cross-device renames. */
async function realMoveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "EXDEV") {
      await copyFile(from, to);
      await rm(from, { force: true });
      return;
    }
    throw err;
  }
}

/**
 * Drain pending-trash photos (Photo.trashedAt IS NOT NULL) for one catalog:
 * snapshot to TrashedPhoto, move renditions + original into the trash, delete the
 * Photo row. Loops one-at-a-time re-querying the oldest still-pending row, so a
 * photo marked WHILE this job runs is still picked up (the enqueue dedups against
 * the running job), and a photo un-trashed via Undo is simply never seen again.
 */
export async function finalizeTrash(
  deps: FinalizeTrashDeps,
  onProgress?: (done: number) => void,
): Promise<{ finalized: number }> {
  const move = deps.moveFile ?? realMoveFile;
  let finalized = 0;
  for (;;) {
    const photo = await deps.db.photo.findFirst({
      where: { catalogId: deps.catalogId, trashedAt: { not: null } },
      orderBy: { trashedAt: "asc" },
      include: { albums: { select: { albumId: true } } },
    });
    if (!photo) break;

    // 1. Snapshot BEFORE any deletion so no race loses the metadata.
    await deps.db.trashedPhoto.create({
      data: {
        id: photo.id,
        catalogId: deps.catalogId,
        originalPath: photo.path,
        source: photo.source,
        takenAt: photo.takenAt,
        sortDate: photo.sortDate,
        width: photo.width,
        height: photo.height,
        hash: photo.hash,
        thumbhash: photo.thumbhash,
        exif: photo.exif as object,
        colorLabel: photo.colorLabel,
        albumIds: photo.albums.map((a) => a.albumId),
      },
    });

    // 2. Move renditions + original into the trash.
    const id = photo.id;
    const ext = path.extname(photo.path);
    await move(path.join(deps.cacheDir, "thumbnails", `${id}.webp`), path.join(deps.trashDir, "thumbnails", `${id}.webp`));
    await move(path.join(deps.cacheDir, "displays", `${id}.webp`), path.join(deps.trashDir, "displays", `${id}.webp`));
    await move(path.join(deps.photosDir, photo.path), path.join(deps.trashDir, "originals", `${id}${ext}`));

    // 3. Delete the Photo row (tolerant: the watcher's unlink may delete it first).
    await deps.db.photo.deleteMany({ where: { id, catalogId: deps.catalogId } });
    finalized++;
    onProgress?.(finalized);
  }
  return { finalized };
}
```

> Note: `TrashedPhoto.create` reuses the live `Photo` id, so during the create→delete gap the same id can exist in both tables — `listTrash` dedupes by id (Task 6) to avoid a duplicate React key.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm -C packages/jobs exec vitest run src/finalize-trash.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Export from the package barrel**

In `packages/jobs/src/index.ts`, add (next to the existing `purge` exports):
```ts
export { finalizeTrash, type FinalizeTrashDeps } from "./finalize-trash.js";
```
(If the barrel re-exports via `export *`, confirm `finalize-trash.js` is included; otherwise add it.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/jobs.ts packages/jobs/src/finalize-trash.ts packages/jobs/src/finalize-trash.test.ts packages/jobs/src/index.ts
git commit -m "feat(jobs): finalizeTrash drain + process_trash job type"
```

---

### Task 4: Wire the worker handler

**Files:**
- Modify: `apps/worker/src/handlers.ts`

- [ ] **Step 1: Add `processTrash` to the deps**

In `apps/worker/src/handlers.ts`, update the import and `HandlerDeps`/`depsForCatalog`. Change the import (line 3):
```ts
import { type JobHandlers, finalizeTrash, purgeAllPhotos, purgeTrash } from "@lumio/jobs";
```
Add to `HandlerDeps` (after `emptyTrash`):
```ts
  processTrash: (onProgress?: (done: number) => void) => Promise<{ finalized: number }>;
```
In `depsForCatalog`, add `processTrash` (leave `emptyTrash` as-is for now — Task 8 extends it to also purge pending):
```ts
    processTrash: async (onProgress) => {
      const c = await getCatalogById(catalogId);
      if (!c) return { finalized: 0 };
      return finalizeTrash(
        { db: prisma, catalogId, photosDir: c.path, cacheDir: path.join(CACHE_DIR, catalogId), trashDir: path.join(TRASH_DIR, catalogId) },
        onProgress,
      );
    },
```

- [ ] **Step 2: Register the handler**

In `buildHandlers`, add a `process_trash` entry (after `empty_trash`):
```ts
    [JobType.process_trash]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Moving photos to Trash…");
      const { finalized } = await makeDeps(job.catalogId).processTrash((done) => {
        void report(done, null, "Moving photos to Trash…").catch(() => {});
      });
      await report(finalized, finalized, null);
    },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C apps/worker exec tsc --noEmit`
Expected: no errors. (`Required<JobHandlers>` now demands `process_trash`, which we added.)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/handlers.ts
git commit -m "feat(worker): handle process_trash + purge pending on empty-trash"
```

---

### Task 5: Make `POST /photos/trash` instant (mark + enqueue)

**Files:**
- Modify: `apps/web/src/app/api/c/[catalog]/photos/trash/route.ts`
- Modify: `apps/web/src/lib/server/trash-service.ts` (delete the old `trashPhotos`)

- [ ] **Step 1: Rewrite the route**

Replace the entire body of `apps/web/src/app/api/c/[catalog]/photos/trash/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType, photoIdsSchema } from "@lumio/shared";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optimistic trash: mark the rows (instant) and enqueue the worker to do the
// heavy lifting (snapshot + file moves) asynchronously. The grid already removed
// the tiles client-side; live queries filter trashedAt IS NULL, so the photos are
// gone from every view the moment this returns.
export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const { count } = await prisma.photo.updateMany({
    where: { id: { in: parsed.data.ids }, catalogId: catalog.id, trashedAt: null },
    data: { trashedAt: new Date() },
  });
  if (count > 0) await enqueueJob(prisma, JobType.process_trash, catalog.id);
  return NextResponse.json({ trashed: count });
});
```

- [ ] **Step 2: Delete the obsolete `trashPhotos` service**

In `apps/web/src/lib/server/trash-service.ts`, delete the `trashPhotos` function (lines 59-113) — its file/db logic now lives in `packages/jobs/finalize-trash.ts`. Keep `moveFile`, `freePath`, `existingAlbumIds`, `listTrash` (changed in Task 6), and `restorePhotos` (changed in Task 7). After deletion, run a grep to confirm nothing else imports it:

Run: `grep -rn "trashPhotos" apps/web/src/lib/server apps/web/src/app`
Expected: no remaining references to the *server* `trashPhotos` (the client wrapper in `lib/photo-mutations.ts` is a different symbol and stays).

- [ ] **Step 3: Typecheck**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/c/[catalog]/photos/trash/route.ts apps/web/src/lib/server/trash-service.ts
git commit -m "feat(web): trash route marks + enqueues, no inline file I/O"
```

---

## Phase 3 — Trash view dual-state

### Task 6: `listTrash` UNION (pending ∪ finalized)

**Files:**
- Modify: `apps/web/src/lib/server/trash-service.ts` (`listTrash`, lines 115-131)
- Test: `apps/web/src/lib/server/trash-service.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/trash-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listTrash } from "./trash-service";

describe("listTrash (dual-state)", () => {
  it("merges pending Photos + TrashedPhoto, newest-first, deduped by id", async () => {
    const pending = [
      { id: "p_new", path: "p_new.jpg", source: "filesystem", takenAt: null, sortDate: new Date(0),
        width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null,
        edits: null, asShotTempK: null, asShotTint: null, isFavorite: false,
        fileModifiedAt: new Date(0), fileCreatedAt: new Date(0),
        createdAt: new Date(0), updatedAt: new Date(0), trashedAt: new Date("2026-06-25T12:00:00Z") },
    ];
    const trashed = [
      { id: "t_old", originalPath: "t_old.jpg", source: "filesystem", takenAt: null, sortDate: new Date(0),
        width: 1, height: 1, hash: null, thumbhash: null, exif: {}, colorLabel: null, albumIds: [],
        deletedAt: new Date("2026-06-25T10:00:00Z"), catalogId: "cat1" },
    ];
    const db = {
      photo: { findMany: vi.fn().mockResolvedValue(pending), count: vi.fn().mockResolvedValue(1) },
      trashedPhoto: { findMany: vi.fn().mockResolvedValue(trashed), count: vi.fn().mockResolvedValue(1) },
    } as never;
    const page = await listTrash("cat1", { limit: 50, offset: 0 } as never, db);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual(["p_new", "t_old"]); // newest trash-time first
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C apps/web exec vitest run src/lib/server/trash-service.test.ts`
Expected: FAIL — pending photos not included.

- [ ] **Step 3: Rewrite `listTrash`**

Replace `listTrash` (lines 115-131) in `trash-service.ts` with:

```ts
export async function listTrash(
  catalogId: string,
  params: PhotosQuery,
  db: Pick<PrismaClient, "photo" | "trashedPhoto"> = prisma,
): Promise<PhotosPage> {
  const { limit, offset } = params;
  const window = offset + limit; // most rows this page could need from either source
  const [pending, trashed, pendingCount, trashedCount] = await Promise.all([
    db.photo.findMany({
      where: { catalogId, trashedAt: { not: null } },
      take: window,
      orderBy: [{ trashedAt: "desc" }, { id: "desc" }],
    }),
    db.trashedPhoto.findMany({
      where: { catalogId },
      take: window,
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    }),
    db.photo.count({ where: { catalogId, trashedAt: { not: null } } }),
    db.trashedPhoto.count({ where: { catalogId } }),
  ]);

  // Merge into one newest-trash-first stream. A photo mid-finalize can briefly
  // exist in BOTH tables (same id) — dedupe, preferring the pending Photo row.
  const seen = new Set<string>();
  const merged = [
    ...pending.map((p) => ({ id: p.id, at: p.trashedAt as Date, dto: toPhotoDTO(p) })),
    ...trashed.map((t) => ({ id: t.id, at: t.deletedAt, dto: toTrashedPhotoDTO(t) })),
  ]
    .sort((a, b) => (b.at.getTime() - a.at.getTime()) || (a.id < b.id ? 1 : -1))
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));

  const items = merged.slice(offset, offset + limit).map((r) => r.dto);
  return { items, total: pendingCount + trashedCount };
}
```

Update the import at the top of `trash-service.ts` so `toPhotoDTO` is available:
```ts
import { type PrismaClient, prisma, toPhotoDTO, toTrashedPhotoDTO } from "@lumio/db";
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm -C apps/web exec vitest run src/lib/server/trash-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trash-service.ts apps/web/src/lib/server/trash-service.test.ts
git commit -m "feat(web): listTrash unions pending + finalized, deduped"
```

---

### Task 7: Dual-state `restorePhotos`

**Files:**
- Modify: `apps/web/src/lib/server/trash-service.ts` (`restorePhotos`, lines 133-203)
- Test: `apps/web/src/lib/server/trash-service.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

Append to `apps/web/src/lib/server/trash-service.test.ts`:

```ts
import { restorePhotos } from "./trash-service";

describe("restorePhotos (dual-state)", () => {
  it("clears trashedAt for pending ids without moving files", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const trashedFindFirst = vi.fn().mockResolvedValue(null); // not finalized
    const db = {
      photo: { updateMany, create: vi.fn() },
      trashedPhoto: { findFirst: trashedFindFirst, deleteMany: vi.fn() },
      album: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const result = await restorePhotos(["pend1"], {
      db, catalogId: "cat1", photosDir: "/p", cacheDir: "/c", trashDir: "/t",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pend1"] }, catalogId: "cat1", trashedAt: { not: null } },
      data: { trashedAt: null },
    });
    expect(result.restored).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C apps/web exec vitest run src/lib/server/trash-service.test.ts`
Expected: FAIL — `restorePhotos` doesn't clear `trashedAt` for pending ids.

- [ ] **Step 3: Add the pending fast-path to `restorePhotos`**

In `restorePhotos` (currently starting line 133), add a pending pass at the very top of the function body (before the existing `for (const id of ids)` loop). The existing loop already tolerates unknown ids (it `continue`s when no `TrashedPhoto` is found), so finalized restores keep working unchanged:

```ts
export async function restorePhotos(
  ids: string[],
  deps: TrashDeps,
): Promise<{ restored: number }> {
  // Pending fast-path: ids still represented by a (marked) Photo row are restored
  // by simply clearing the marker — their files were never moved. Counts toward
  // restored; the finalized loop below skips them (no TrashedPhoto row exists).
  const { count: unmarked } = await deps.db.photo.updateMany({
    where: { id: { in: ids }, catalogId: deps.catalogId, trashedAt: { not: null } },
    data: { trashedAt: null },
  });

  let restored = unmarked;
  for (const id of ids) {
    // ... existing finalized-restore body unchanged ...
```

The function's `TrashDeps.db` type must include `photo` (it already does — `Pick<PrismaClient, "photo" | "trashedPhoto" | "album">`). Leave the rest of the loop and the final `return { restored };` as-is.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm -C apps/web exec vitest run src/lib/server/trash-service.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trash-service.ts apps/web/src/lib/server/trash-service.test.ts
git commit -m "feat(web): restorePhotos clears trashedAt for pending ids"
```

---

### Task 8: Purge pending photos (selected purge + empty-trash)

**Files:**
- Modify: `packages/jobs/src/purge.ts`
- Modify: `packages/jobs/src/index.ts`
- Modify: `apps/worker/src/handlers.ts` (extend `emptyTrash` to purge pending too)
- Modify: `apps/web/src/app/api/c/[catalog]/trash/purge/route.ts`
- Test: `packages/jobs/src/purge.test.ts` (append, or create)

- [ ] **Step 1: Write the failing test**

Append (or create) `packages/jobs/src/purge.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { purgePendingPhotos } from "./purge.js";

describe("purgePendingPhotos", () => {
  it("hard-deletes selected pending Photo rows", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "p1", path: "p1.jpg" }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { findMany, deleteMany } } as never;
    const result = await purgePendingPhotos(["p1"], { db, catalogId: "cat1", photosDir: "/p", cacheDir: "/c" });
    expect(result).toEqual({ deleted: 1 });
    expect(findMany).toHaveBeenCalledWith({
      where: { catalogId: "cat1", trashedAt: { not: null }, id: { in: ["p1"] } },
      select: { id: true, path: true },
    });
    expect(deleteMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C packages/jobs exec vitest run src/purge.test.ts`
Expected: FAIL — `purgePendingPhotos` not exported.

- [ ] **Step 3: Implement `purgePendingPhotos`**

Append to `packages/jobs/src/purge.ts`:

```ts
export interface PurgePendingDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  photosDir: string;
  cacheDir: string;
}

/** Permanently remove pending-trash Photo rows (all when `ids` is undefined) +
 *  their on-disk originals/renditions. Mirrors purgeAllPhotos, scoped to
 *  trashedAt IS NOT NULL. */
export async function purgePendingPhotos(
  ids: string[] | undefined,
  deps: PurgePendingDeps,
): Promise<{ deleted: number }> {
  const where = { catalogId: deps.catalogId, trashedAt: { not: null }, ...(ids ? { id: { in: ids } } : {}) };
  const rows = await deps.db.photo.findMany({ where, select: { id: true, path: true } });
  await Promise.all(
    rows.flatMap((p) => [
      rm(path.join(deps.photosDir, p.path), { force: true }),
      rm(path.join(deps.cacheDir, "thumbnails", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays-edited", `${p.id}.webp`), { force: true }),
    ]),
  );
  const { count } = await deps.db.photo.deleteMany({ where });
  return { deleted: count };
}
```

Export it in `packages/jobs/src/index.ts` if the barrel lists `purge` exports explicitly:
```ts
export { purgeAllPhotos, purgePendingPhotos, purgeTrash } from "./purge.js";
```

- [ ] **Step 4: Extend empty-trash to also purge pending**

Now that `purgePendingPhotos` exists, update `apps/worker/src/handlers.ts`:
Change the import (line 3) to add `purgePendingPhotos`:
```ts
import { type JobHandlers, finalizeTrash, purgeAllPhotos, purgePendingPhotos, purgeTrash } from "@lumio/jobs";
```
Change the `emptyTrash` dep in `depsForCatalog` to purge both finalized + pending:
```ts
    emptyTrash: async () => {
      const c = await getCatalogById(catalogId);
      if (!c) return { deleted: 0 };
      const a = await purgeTrash(undefined, { db: prisma, catalogId, trashDir: path.join(TRASH_DIR, catalogId) });
      const b = await purgePendingPhotos(undefined, { db: prisma, catalogId, photosDir: c.path, cacheDir: path.join(CACHE_DIR, catalogId) });
      return { deleted: a.deleted + b.deleted };
    },
```

- [ ] **Step 5: Wire the selected-purge route**

Replace `apps/web/src/app/api/c/[catalog]/trash/purge/route.ts` body so it purges both finalized + pending for the selected ids:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { purgePendingPhotos, purgeTrash } from "@lumio/jobs";
import { photoIdsSchema } from "@lumio/shared";
import { catalogCacheDir, catalogTrashDir } from "@/lib/server/server-paths";
import { parseJson } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, photoIdsSchema);
  if ("response" in parsed) return parsed.response;
  const ids = parsed.data.ids;
  const finalized = await purgeTrash(ids, { db: prisma, catalogId: catalog.id, trashDir: catalogTrashDir(catalog.id) });
  const pending = await purgePendingPhotos(ids, {
    db: prisma, catalogId: catalog.id, photosDir: catalog.path, cacheDir: catalogCacheDir(catalog.id),
  });
  return NextResponse.json({ deleted: finalized.deleted + pending.deleted });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C packages/jobs exec vitest run src/purge.test.ts`
Expected: PASS.
Run: `pnpm -C apps/web exec tsc --noEmit && pnpm -C apps/worker exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/jobs/src/purge.ts packages/jobs/src/purge.test.ts packages/jobs/src/index.ts apps/worker/src/handlers.ts "apps/web/src/app/api/c/[catalog]/trash/purge/route.ts"
git commit -m "feat: purge pending-trash photos on selected purge + empty-trash"
```

---

## Phase 4 — Client optimistic + Undo

### Task 9: Grid store `reload()`

**Files:**
- Modify: `apps/web/src/features/photo-grid/photo-page-store.ts`
- Modify: `apps/web/src/features/photo-grid/use-photo-pages.ts`
- Modify: `apps/web/src/features/photo-grid/photo-collection.tsx`
- Modify: `apps/web/src/features/photo-grid/photo-grid.tsx`
- Test: `apps/web/src/features/photo-grid/photo-page-store.test.ts` (append or create)

- [ ] **Step 1: Write the failing test**

Append (or create) `apps/web/src/features/photo-grid/photo-page-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPageStore, resetStore, setPage } from "./photo-page-store";

describe("resetStore", () => {
  it("clears pages, lru, and total so the grid refetches from scratch", () => {
    let store = createPageStore<{ id: string }>(2, 10);
    store = setPage(store, 0, [{ id: "a" }, { id: "b" }], 2);
    const fresh = resetStore(store);
    expect(fresh.pages.size).toBe(0);
    expect(fresh.lru).toEqual([]);
    expect(fresh.total).toBeNull();
    expect(fresh.pageSize).toBe(2);
    expect(fresh.maxPages).toBe(10);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C apps/web exec vitest run src/features/photo-grid/photo-page-store.test.ts`
Expected: FAIL — `resetStore` not exported.

- [ ] **Step 3: Add `resetStore`**

Append to `apps/web/src/features/photo-grid/photo-page-store.ts`:

```ts
/** Drop all loaded pages + total, keeping sizing — the grid refetches from
 *  scratch (used for undo/rollback after an optimistic remove). */
export function resetStore<T>(store: PageStore<T>): PageStore<T> {
  return createPageStore<T>(store.pageSize, store.maxPages);
}
```

- [ ] **Step 4: Add `reload()` to the hook**

In `apps/web/src/features/photo-grid/use-photo-pages.ts`:

Add `resetStore` to the import from `./photo-page-store` (line 5-15).
Add the callback after `removePhotos` (line 95):
```ts
  const reload = useCallback(() => {
    mutationGen.current += 1; // drop any in-flight page fetch
    setStore((prev) => resetStore(prev));
  }, []);
```
Add `reload` to the returned object (line 102):
```ts
  return { total: store.total, photoAt, getLoadedIds, getPhotos, ensureRange, patchPhotos, removePhotos, reload, error, retry };
```

- [ ] **Step 5: Expose `reload` through the collection context**

In `apps/web/src/features/photo-grid/photo-collection.tsx`:
Add to the `PhotoCollectionValue` interface (after `removePhotos`, line 36):
```ts
  reload: () => void;
```
Add `reload` to the store destructure (line 116-126):
```ts
  const {
    total, photoAt, getLoadedIds, getPhotos, ensureRange, patchPhotos, removePhotos, reload, error, retry,
  } = store;
```
Add `reload` to the `value` object (line 280-298) and to its dependency array (line 299-316).

- [ ] **Step 6: Expose `reload` on `PhotoGridHandle`**

In `apps/web/src/features/photo-grid/photo-grid.tsx`:
Add to the `PhotoGridHandle` type (line 41-48):
```ts
  /** Reload the grid from the server (drops all loaded pages). For undo/rollback. */
  reload: () => void;
```
Pull `reload` from the collection in the destructure (line 66-69) and include it in `useImperativeHandle` (line 70):
```ts
  useImperativeHandle(apiRef, () => ({ patchPhotos, removePhotos, getPhotos, reload }), [patchPhotos, removePhotos, getPhotos, reload]);
```

- [ ] **Step 7: Run test + typecheck**

Run: `pnpm -C apps/web exec vitest run src/features/photo-grid/photo-page-store.test.ts`
Expected: PASS.
Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/photo-grid/photo-page-store.ts apps/web/src/features/photo-grid/photo-page-store.test.ts apps/web/src/features/photo-grid/use-photo-pages.ts apps/web/src/features/photo-grid/photo-collection.tsx apps/web/src/features/photo-grid/photo-grid.tsx
git commit -m "feat(web): grid store reload() for undo/rollback"
```

---

### Task 10: `restorePhotos` client wrapper

**Files:**
- Modify: `apps/web/src/lib/photo-mutations.ts`

- [ ] **Step 1: Add the wrapper**

In `apps/web/src/lib/photo-mutations.ts`, after the existing `trashPhotos` (line 17-19):

```ts
export async function restorePhotos(slug: string, ids: string[]): Promise<void> {
  await postJson(catalogApiUrl(slug, "/trash/restore"), { ids });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/lib/photo-mutations.ts
git commit -m "feat(web): restorePhotos client wrapper"
```

---

### Task 11: `optimisticTrash` shared helper

**Files:**
- Create: `apps/web/src/lib/trash-optimistic.ts`

- [ ] **Step 1: Create the helper**

Create `apps/web/src/lib/trash-optimistic.ts`:

```ts
import { toast } from "sonner";
import { countLabel } from "@/lib/count-label";
import { restorePhotos, trashPhotos } from "@/lib/photo-mutations";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";

export interface OptimisticTrashArgs {
  slug: string;
  ids: string[];
  /** Drop the tiles immediately (grid handle or collection). */
  removePhotos: (ids: Set<string>) => void;
  /** Re-sync the grid from the server (undo + failure rollback). */
  reload: () => void;
  /** Runs right after the optimistic removal — e.g. clear selection, advance the
   *  lightbox. Not run on undo. */
  onRemoved?: () => void;
}

/**
 * Move photos to Trash optimistically: remove the tiles now, fire the POST in the
 * background, and offer Undo. The POST only marks rows + enqueues the worker, so
 * it's fast; on the rare failure we reload to re-sync. Undo restores (dual-state)
 * and reloads. Shared by the grid (usePhotoActions) and the lightbox.
 */
export function optimisticTrash({ slug, ids, removePhotos, reload, onRemoved }: OptimisticTrashArgs): void {
  if (ids.length === 0) return;
  removePhotos(new Set(ids));
  playSound(SoundEffect.MoveToTrash);
  onRemoved?.();

  let undone = false;
  const label = countLabel(ids.length, "photo", "photos");
  const toastId = toast(`${label} moved to Trash`, {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        void (async () => {
          try {
            await restorePhotos(slug, ids);
            reload();
          } catch {
            toast.error("Failed to restore photos.");
          }
        })();
      },
    },
  });

  void (async () => {
    try {
      await trashPhotos(slug, ids);
    } catch {
      if (undone) return; // user already undid; nothing to roll back
      toast.dismiss(toastId);
      toast.error("Failed to move photos to Trash.");
      reload(); // re-sync: the rows were never marked server-side
    }
  })();
}
```

> sonner's `action: { label, onClick }` renders the Undo button (object form; no JSX needed).

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/lib/trash-optimistic.ts
git commit -m "feat(web): optimisticTrash helper (instant remove + Undo)"
```

---

### Task 12: Optimistic `usePhotoActions.trash()`

**Files:**
- Modify: `apps/web/src/components/photo-actions/use-photo-actions.tsx` (lines 141-166, plus state)
- Modify: `apps/web/src/components/photo-actions/selection-actions.tsx`

- [ ] **Step 1: Rewrite `trash`**

In `use-photo-actions.tsx`, add the import:
```ts
import { optimisticTrash } from "@/lib/trash-optimistic";
```
Replace the `trash` callback (lines 141-166) with:

```ts
  const trash = useCallback(
    (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0) return Promise.resolve();
      optimisticTrash({
        slug,
        ids,
        removePhotos: (set) => gridRef.current?.removePhotos(set),
        reload: () => gridRef.current?.reload(),
        onRemoved: () => {
          onTrashed?.(ids);
          opts?.onSuccess?.();
        },
      });
      return Promise.resolve();
    },
    [slug, gridRef, onTrashed],
  );
```

`trash` stays `Promise<void>`-typed (callers `void` it), but it no longer awaits the network. Remove the now-unused `deleting`/`setDeleting` state (line 81), the `confirm`/`confirmDialog` usage *only if* nothing else needs it — `confirmDialog` is still rendered in `element` and used by `setAlbumCover`? No: `setAlbumCover` doesn't confirm. Check: after this change, `confirm` is unused. Remove `const { confirm, confirmDialog } = useConfirm();` and drop `{confirmDialog}` from `element` (lines 185-190) **only if** no other action uses it. Verify with: `grep -n "confirm" apps/web/src/components/photo-actions/use-photo-actions.tsx` — if `confirm(`/`confirmDialog` have no remaining callers, remove them and the `useConfirm` import.

Update `pending` (line 202): trash is no longer async, so report it as never pending:
```ts
    pending: { download: downloading, label: labelPending, trash: false, favorite: favoritePending },
```
Remove the now-unused `DEFAULT_TRASH_DESCRIPTION`/`trashDescription` plumbing only if nothing references it — `trashDescription` was the confirm body; with the confirm gone it's dead. Remove the `trashDescription` param (line 58, 68) and the `DEFAULT_TRASH_DESCRIPTION` const (line 44), then fix callers that pass it (grep next step).

- [ ] **Step 2: Fix callers that passed `trashDescription`**

Run: `grep -rn "trashDescription" apps/web/src`
For each caller (album view passes a custom body), remove the `trashDescription=...` prop. Expected callers: the album view's `usePhotoActions({ ..., trashDescription })`. Delete that property.

- [ ] **Step 3: Drop the trash spinner in `selection-actions.tsx`**

In `selection-actions.tsx`, the Delete button (lines 69-78) used `actions.pending.trash` for a spinner + disable. Since trash is instant, simplify to:
```tsx
      <Button
        variant="destructive"
        size="icon-sm"
        disabled={none}
        onClick={() => void actions.trash(ids, { onSuccess: clearSelection })}
        aria-label="Delete"
        title="Delete"
      >
        <Trash2 aria-hidden />
      </Button>
```
Remove the now-unused `Loader2` import if nothing else uses it (grep within the file).

- [ ] **Step 4: Typecheck**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx apps/web/src/components/photo-actions/selection-actions.tsx
git commit -m "feat(web): optimistic trash with Undo (no confirm dialog)"
```

---

### Task 13: Optimistic trash in the lightbox actions

**Files:**
- Modify: `apps/web/src/features/lightbox/lightbox-actions.tsx`

- [ ] **Step 1: Rewrite the lightbox `trash()`**

In `lightbox-actions.tsx`:
- Pull `reload` and `removePhotos` from the collection: change `const { removePhotos } = usePhotoCollection();` to `const { removePhotos, reload } = usePhotoCollection();`.
- Replace the `trash` function (lines 44-59) with:
```ts
  function trash() {
    optimisticTrash({
      slug,
      ids: [photo.id],
      removePhotos,
      reload,
      onRemoved: onTrashed,
    });
  }
```
- Add the import:
```ts
import { optimisticTrash } from "@/lib/trash-optimistic";
```
- Remove the now-unused `useConfirm`, `confirm`/`confirmDialog`, the `toast` import (the helper owns toasts), and the `trashPhotos` import — verify each is unused after the edit with a grep, then drop them and the `{confirmDialog}` from the returned JSX (the `resetEdits` flow still uses `confirm`, so KEEP `useConfirm`/`confirmDialog` — only remove `toast`/`trashPhotos` imports). The `<>{confirmDialog}...` wrapper stays for `resetEdits`.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/features/lightbox/lightbox-actions.tsx
git commit -m "feat(web): optimistic trash in lightbox actions"
```

---

## Phase 5 — Keyboard shortcuts

### Task 14: Grid Backspace/Delete

**Files:**
- Modify: `apps/web/src/lib/grid-shortcut.ts`
- Test: `apps/web/src/lib/grid-shortcut.test.ts` (append or create)
- Modify: `apps/web/src/features/photo-grid/grid-shortcuts.tsx`

- [ ] **Step 1: Write the failing test**

Append (or create) `apps/web/src/lib/grid-shortcut.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveGridShortcut, type GridShortcutInput } from "./grid-shortcut";

const base: GridShortcutInput = {
  key: "x", hasModifier: false, repeat: false, selectionSize: 0,
  lightboxOpen: false, inEditable: false, overlayOpen: false,
};

describe("resolveGridShortcut — trash", () => {
  it("maps Backspace to trash when something is selected", () => {
    expect(resolveGridShortcut({ ...base, key: "Backspace", selectionSize: 3 })).toEqual({ kind: "trash" });
  });
  it("maps Delete to trash when something is selected", () => {
    expect(resolveGridShortcut({ ...base, key: "Delete", selectionSize: 1 })).toEqual({ kind: "trash" });
  });
  it("does nothing with an empty selection", () => {
    expect(resolveGridShortcut({ ...base, key: "Backspace", selectionSize: 0 })).toBeNull();
  });
  it("is inert while typing (Backspace must edit text, not delete photos)", () => {
    expect(resolveGridShortcut({ ...base, key: "Backspace", selectionSize: 3, inEditable: true })).toBeNull();
  });
  it("is inert with an overlay open or a modifier held", () => {
    expect(resolveGridShortcut({ ...base, key: "Delete", selectionSize: 3, overlayOpen: true })).toBeNull();
    expect(resolveGridShortcut({ ...base, key: "Delete", selectionSize: 3, hasModifier: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm -C apps/web exec vitest run src/lib/grid-shortcut.test.ts`
Expected: FAIL — `"trash"` not in the action union.

- [ ] **Step 3: Extend the action type + resolver**

In `apps/web/src/lib/grid-shortcut.ts`:
Add to the `GridShortcutAction` union (line 4-7):
```ts
  | { kind: "trash" }
```
Add cases to the `switch` (after the `"f"` case, line 42-43):
```ts
    case "backspace":
    case "delete":
      return input.selectionSize >= 1 ? { kind: "trash" } : null;
```
(The early-return guard block at lines 32-40 already makes Backspace inert in editables / with overlays / modifiers / lightbox.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm -C apps/web exec vitest run src/lib/grid-shortcut.test.ts`
Expected: PASS.

- [ ] **Step 5: Dispatch the action in `grid-shortcuts.tsx`**

In `apps/web/src/features/photo-grid/grid-shortcuts.tsx`, after the `if (action.kind === "favorite") { ... }` block (lines 57-63), add:
```ts
      if (action.kind === "trash") {
        if (!c.actions) return;
        void c.actions.trash([...c.selectedIds]);
        return;
      }
```
(`c.actions` is the `usePhotoActionsContext()` value already captured in the ref. `e.preventDefault()` at line 55 already ran.)

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/lib/grid-shortcut.ts apps/web/src/lib/grid-shortcut.test.ts apps/web/src/features/photo-grid/grid-shortcuts.tsx
git commit -m "feat(web): Backspace/Delete trashes the grid selection"
```

---

### Task 15: Lightbox Backspace/Delete (delete + advance)

**Files:**
- Modify: `apps/web/src/features/lightbox/use-lightbox-keyboard.ts`
- Modify: `apps/web/src/features/lightbox/lightbox.tsx`

- [ ] **Step 1: Add `trashCurrent` to the keyboard contract**

In `use-lightbox-keyboard.ts`, add to the `LightboxKeys` interface (after `toggleFavorite`, line 21):
```ts
  /** Trash the open photo, then advance (or close if it was the last). */
  trashCurrent: () => void;
```
In `onKeyDown`, inside the unmodified single-press block (`if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat) {`, line 87), add — but NOTE the input-guard at line 75-76 already returned for inputs/textareas, so Backspace can't fire while typing in a field:
```ts
        // Move the open photo to Trash.
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          k.trashCurrent();
          return;
        }
```
Place it before the favorite check inside that block.

- [ ] **Step 2: Wire `trashCurrent` in `lightbox.tsx`**

In `LightboxOverlay` (line 63), pull `slug` + collection helpers and define `trashCurrent`:
- Add `useCatalog` import at the top:
```ts
import { useCatalog } from "@/components/providers/catalog-context";
import { optimisticTrash } from "@/lib/trash-optimistic";
```
- In `LightboxOverlay`, extend the collection destructure (line 64) to include `removePhotos` and `reload`:
```ts
  const { openIndex, total, step, close, open, openTab, setOpenTab, removePhotos, reload } = usePhotoCollection();
  const { slug } = useCatalog();
```
- Define `trashCurrent` next to `onTrashed` (after line 95):
```ts
  const trashCurrent = useCallback(() => {
    optimisticTrash({
      slug,
      ids: [photo.id],
      removePhotos,
      reload,
      onRemoved: onTrashed, // advances by index-shift, or closes if it was the last
    });
  }, [slug, photo.id, removePhotos, reload, onTrashed]);
```
- Pass it into `useLightboxKeyboard({ ... })` (line 71-89):
```ts
    trashCurrent,
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.
```bash
git add apps/web/src/features/lightbox/use-lightbox-keyboard.ts apps/web/src/features/lightbox/lightbox.tsx
git commit -m "feat(web): Backspace/Delete trashes the open lightbox photo"
```

---

## Phase 6 — Verification

### Task 16: Full build, lint, tests, manual e2e

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suites**

Run: `pnpm -C packages/jobs exec vitest run`
Run: `pnpm -C apps/web exec vitest run`
Expected: all PASS.

- [ ] **Step 2: Typecheck all touched packages**

Run: `pnpm -C apps/web exec tsc --noEmit && pnpm -C packages/jobs exec tsc --noEmit && pnpm -C apps/worker exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm -C apps/web exec next lint` (or the repo's lint script: `pnpm -C apps/web run lint`).
Expected: no new errors. Watch for React-Compiler rules ([[lumio-react-compiler-lint]]): the `reload` ref usage, `"use client"` on line 1 of any new client file (none added — `trash-optimistic.ts` is framework-agnostic and imported by client code, no directive needed).

- [ ] **Step 4: Manual e2e — start the stack**

Use the project run skill / `make` targets to start web + worker + DB. Then verify each:

- [ ] **Grid optimistic delete:** select ~100 photos, press **Backspace** → tiles vanish instantly, a "100 photos moved to Trash · Undo" toast appears, the move-to-trash sound plays. Within ~1s the worker logs `process_trash` and files land under `TRASH_DIR/<catalogId>/{originals,thumbnails,displays}`.
- [ ] **Undo:** repeat, click **Undo** before/after the worker finishes → photos reappear in the grid (reload), and they're gone from Trash.
- [ ] **Trash view:** delete a few, open **Trash** immediately → the just-deleted photos show (pending), then remain after the worker finalizes (no duplicates, no flicker).
- [ ] **Restore from Trash:** select in Trash → Restore → photos return to the library; their files are back under the catalog dir.
- [ ] **Empty trash:** with both pending + finalized items present, Empty trash → all removed, files gone from both catalog + trash dirs.
- [ ] **Lightbox delete:** open a photo, press **Delete** → it's trashed, the next photo slides in; on the last photo the lightbox closes.
- [ ] **Backspace safety:** focus the search box / a text field, press Backspace → it edits text, does NOT delete photos. Open a dialog/menu, press Delete → no-op.
- [ ] **Worker-down durability:** stop the worker, delete photos (they vanish + show in Trash as pending), confirm a **rescan** does NOT re-import them, restart the worker → it drains and files move.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for optimistic delete"
```

---

## Notes / coordination

- **Migration on the shared DB:** Task 1 is additive + idempotent, but applying it is coordinated with the user per the spec (shared dev Postgres; never let `migrate dev` reset). See [[lumio-shared-db-drift]].
- **Watcher interaction is unchanged:** `finalizeTrash` performs the exact file/db ops the proven `trashPhotos` did (snapshot → move → delete), so the watcher's `unlink`→`removePath` behaves identically; the new `trashedAt` marker is invisible to the watcher and to the scanner's upsert (it never writes that column), so pending photos survive a rescan.
- **Undo/rollback UX:** both reload the grid (drop loaded pages, refetch). Position-accurate re-insertion into the sparse LRU store was deliberately deferred (YAGNI) — reload is correct and simple; revisit only if the scroll reset proves annoying.
