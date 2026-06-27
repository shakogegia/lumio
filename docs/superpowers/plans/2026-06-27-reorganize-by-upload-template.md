# Reorganize files by upload template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Danger Zone action that moves a catalog's existing photo files into the folder layout its current upload template produces, as an async worker job with a count-preview confirmation dialog.

**Architecture:** A dependency-injected core mover in `@lumio/jobs` (`reorganizePhotos` + `previewReorganize`) updates each `Photo.path` in the DB **first**, then renames the file on disk — making the filesystem watcher's resulting `unlink`+`add` events no-ops (no duplication, no trashing). Two job types (`reorganize`, `reorganize_all`) encode the "include filesystem photos" toggle without a DB migration. A worker handler runs the mover; thin Next API routes enqueue the job and serve the preview count; a React card in the Danger Zone drives it.

**Tech Stack:** TypeScript, Node `fs/promises`, Prisma (`@lumio/db`), Vitest, Next.js App Router, React, Tailwind, shadcn UI. Spec: `docs/superpowers/specs/2026-06-27-reorganize-by-upload-template-design.md`.

---

## File Structure

- **Create** `packages/jobs/src/reorganize.ts` — core mover + preview (`desiredPath`, `previewReorganize`, `reorganizePhotos`).
- **Create** `packages/jobs/src/reorganize.test.ts` — unit tests against a temp dir + mock db.
- **Modify** `packages/jobs/src/index.ts` — export the new module.
- **Modify** `packages/shared/src/jobs.ts` — add `reorganize` + `reorganize_all` to `JobType`.
- **Modify** `apps/worker/src/handlers.ts` — add `reorganize` to `HandlerDeps`, `depsForCatalog`, and two handlers.
- **Modify** `apps/worker/src/handlers.test.ts` — add `reorganize` to existing dep fakes + new handler tests.
- **Create** `apps/web/src/app/api/c/[catalog]/photos/reorganize/route.ts` — POST: validate + enqueue.
- **Create** `apps/web/src/app/api/c/[catalog]/photos/reorganize/preview/route.ts` — GET: preview count.
- **Create** `apps/web/src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx` — UI card.
- **Modify** `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx` — render the card in the `danger` tab.

---

## Task 1: Add the two job types

**Files:**
- Modify: `packages/shared/src/jobs.ts:4-9`

This is a config/constant change (the enum mirrors the `Job.type` column, which is a free-text string — no migration needed). No dedicated test; downstream tasks fail to typecheck if it's wrong.

- [ ] **Step 1: Add the enum values**

In `packages/shared/src/jobs.ts`, change the `JobType` enum to:

```typescript
export enum JobType {
  rescan = "rescan",
  purge_all = "purge_all",
  empty_trash = "empty_trash",
  process_trash = "process_trash",
  reorganize = "reorganize",
  reorganize_all = "reorganize_all",
}
```

- [ ] **Step 2: Typecheck the shared package**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no new errors from `jobs.ts` (pre-existing unrelated errors elsewhere, if any, are fine).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/jobs.ts
git commit -m "feat(jobs): add reorganize / reorganize_all job types"
```

---

## Task 2: Core preview — `desiredPath` + `previewReorganize`

**Files:**
- Create: `packages/jobs/src/reorganize.ts`
- Test: `packages/jobs/src/reorganize.test.ts`

`desiredPath` computes the catalog-relative path the template yields for a photo. `previewReorganize` counts how many in-scope photos are not already there. Both are pure DB-reads (no filesystem, no writes).

- [ ] **Step 1: Write the failing tests**

Create `packages/jobs/src/reorganize.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { desiredPath, previewReorganize } from "./reorganize.js";

const TEMPLATE = "{TAKEN_YYYY}/{TAKEN_MM}-{TAKEN_DD}/{filename}";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    path: "incoming/IMG.jpg",
    takenAt: new Date("2024-03-14T09:00:00.000Z"),
    fileModifiedAt: new Date("2022-01-01T00:00:00.000Z"),
    fileCreatedAt: new Date("2021-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...over,
  };
}

describe("desiredPath", () => {
  it("uses takenAt for {TAKEN_*} and the file basename for {filename}", () => {
    expect(desiredPath(TEMPLATE, row() as never)).toBe("2024/03-14/IMG.jpg");
  });

  it("falls back to fileModifiedAt when takenAt is null", () => {
    expect(desiredPath(TEMPLATE, row({ takenAt: null }) as never)).toBe("2022/01-01/IMG.jpg");
  });

  it("resolves {NOW_*} from createdAt", () => {
    expect(desiredPath("{NOW_YYYY}/{filename}", row() as never)).toBe("2026/IMG.jpg");
  });
});

describe("previewReorganize", () => {
  it("counts only photos whose templated path differs from the current path", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({ id: "a", path: "incoming/IMG.jpg" }),          // → 2024/03-14/IMG.jpg (moves)
      row({ id: "b", path: "2024/03-14/OK.jpg", takenAt: new Date("2024-03-14T00:00:00.000Z") }), // already there
    ]);
    const db = { photo: { findMany } } as never;
    const res = await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: true });
    expect(res).toEqual({ total: 2, willMove: 1 });
  });

  it("scopes to non-trashed uploads when includeFilesystem is false", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { photo: { findMany } } as never;
    await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: false });
    expect(findMany).toHaveBeenCalledWith({
      where: { catalogId: "cat1", trashedAt: null, source: "upload" },
      select: expect.anything(),
    });
  });

  it("includes all sources (no source filter) when includeFilesystem is true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { photo: { findMany } } as never;
    await previewReorganize({ db, catalogId: "cat1", uploadTemplate: TEMPLATE, includeFilesystem: true });
    expect(findMany).toHaveBeenCalledWith({
      where: { catalogId: "cat1", trashedAt: null },
      select: expect.anything(),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/jobs && npx vitest run src/reorganize.test.ts`
Expected: FAIL — `Failed to resolve import "./reorganize.js"` (module doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/jobs/src/reorganize.ts`:

```typescript
import { access, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import { renderTemplate } from "@lumio/shared";

export interface ReorganizeDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  photosDir: string;
  uploadTemplate: string;
  includeFilesystem: boolean;
  onProgress?: (processed: number, total: number) => void | Promise<void>;
  /** Diagnostic sink for per-photo anomalies (missing file, rename failure). */
  onWarn?: (message: string) => void;
}

interface PhotoRow {
  id: string;
  path: string;
  takenAt: Date | null;
  fileModifiedAt: Date;
  fileCreatedAt: Date;
  createdAt: Date;
}

const SCOPE_SELECT = {
  id: true,
  path: true,
  takenAt: true,
  fileModifiedAt: true,
  fileCreatedAt: true,
  createdAt: true,
} as const;

/** WHERE clause for the photos a reorg considers: non-trashed, optionally upload-only. */
function scopeWhere(catalogId: string, includeFilesystem: boolean) {
  return {
    catalogId,
    trashedAt: null,
    ...(includeFilesystem ? {} : { source: "upload" as const }),
  };
}

/** The catalog-relative path the template produces for one photo. */
export function desiredPath(uploadTemplate: string, row: PhotoRow): string {
  const date = row.takenAt ?? row.fileModifiedAt ?? row.fileCreatedAt;
  return renderTemplate(uploadTemplate, {
    date,
    now: row.createdAt,
    originalFilename: row.path.split("/").pop() ?? row.path,
  });
}

/** Count how many in-scope photos are not already at their template path. */
export async function previewReorganize(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "uploadTemplate" | "includeFilesystem">,
): Promise<{ total: number; willMove: number }> {
  const rows = (await deps.db.photo.findMany({
    where: scopeWhere(deps.catalogId, deps.includeFilesystem),
    select: SCOPE_SELECT,
  })) as PhotoRow[];
  let willMove = 0;
  for (const r of rows) {
    if (desiredPath(deps.uploadTemplate, r) !== r.path) willMove += 1;
  }
  return { total: rows.length, willMove };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/jobs && npx vitest run src/reorganize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/reorganize.ts packages/jobs/src/reorganize.test.ts
git commit -m "feat(jobs): reorganize preview (desiredPath + previewReorganize)"
```

---

## Task 3: Core mover — `reorganizePhotos`

**Files:**
- Modify: `packages/jobs/src/reorganize.ts`
- Test: `packages/jobs/src/reorganize.test.ts`

Moves files DB-first (watcher-safe), with collision suffixing, empty-dir pruning, and DB revert on rename failure.

- [ ] **Step 1: Write the failing tests**

Append to `packages/jobs/src/reorganize.test.ts`:

```typescript
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reorganizePhotos } from "./reorganize.js";

async function photosRoot() {
  return mkdtemp(path.join(tmpdir(), "lumio-reorg-"));
}

function moverDb(rows: unknown[], findUnique = vi.fn().mockResolvedValue(null)) {
  return {
    photo: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique,
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("reorganizePhotos", () => {
  it("repoints the row then moves the file to its template path", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res).toEqual({ moved: 1, skipped: 0, failed: 0 });
    expect(existsSync(path.join(photosDir, "2024/03-14/IMG.jpg"))).toBe(true);
    expect(existsSync(path.join(photosDir, "incoming/IMG.jpg"))).toBe(false);
    expect(await readFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "utf8")).toBe("data");
    expect(db.photo.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { path: "2024/03-14/IMG.jpg", dirPath: "2024/03-14" },
    });
  });

  it("skips a photo already at its template path", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "2024/03-14"), { recursive: true });
    await writeFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "data");
    const db = moverDb([row({ path: "2024/03-14/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res).toEqual({ moved: 0, skipped: 1, failed: 0 });
    expect(db.photo.update).not.toHaveBeenCalled();
  });

  it("suffixes -1 when the target path is already taken by another row", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    // First collision check (the desired path) returns an occupant; next is free.
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "other" })
      .mockResolvedValue(null);
    const db = moverDb([row({ path: "incoming/IMG.jpg" })], findUnique);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(res.moved).toBe(1);
    expect(existsSync(path.join(photosDir, "2024/03-14/IMG-1.jpg"))).toBe(true);
    expect(db.photo.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { path: "2024/03-14/IMG-1.jpg", dirPath: "2024/03-14" },
    });
  });

  it("prunes directories left empty by the move", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
    });

    expect(existsSync(path.join(photosDir, "incoming"))).toBe(false);
    expect(existsSync(photosDir)).toBe(true);
  });

  it("counts a missing source file as failed without touching the DB", async () => {
    const photosDir = await photosRoot();
    const db = moverDb([row({ path: "incoming/GONE.jpg" })]);
    const warnings: string[] = [];

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onWarn: (m) => warnings.push(m),
    });

    expect(res).toEqual({ moved: 0, skipped: 0, failed: 1 });
    expect(db.photo.update).not.toHaveBeenCalled();
    expect(warnings.length).toBe(1);
  });

  it("reverts the row repoint when the rename fails", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "incoming"), { recursive: true });
    await writeFile(path.join(photosDir, "incoming/IMG.jpg"), "data");
    // Make "2024" a FILE so mkdir of "2024/03-14" throws ENOTDIR.
    await writeFile(path.join(photosDir, "2024"), "i am a file");
    const db = moverDb([row({ path: "incoming/IMG.jpg" })]);

    const res = await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onWarn: () => {},
    });

    expect(res).toEqual({ moved: 0, skipped: 0, failed: 1 });
    expect(existsSync(path.join(photosDir, "incoming/IMG.jpg"))).toBe(true);
    // Repoint then revert: last update restores the original path.
    expect(db.photo.update).toHaveBeenLastCalledWith({
      where: { id: "p1" },
      data: { path: "incoming/IMG.jpg", dirPath: "incoming" },
    });
  });

  it("reports progress for every photo considered", async () => {
    const photosDir = await photosRoot();
    await mkdir(path.join(photosDir, "2024/03-14"), { recursive: true });
    await writeFile(path.join(photosDir, "2024/03-14/IMG.jpg"), "data");
    const db = moverDb([row({ path: "2024/03-14/IMG.jpg" })]);
    const progress: Array<[number, number]> = [];

    await reorganizePhotos({
      db: db as never,
      catalogId: "cat1",
      photosDir,
      uploadTemplate: TEMPLATE,
      includeFilesystem: true,
      onProgress: (p, t) => { progress.push([p, t]); },
    });

    expect(progress).toEqual([[1, 1]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/jobs && npx vitest run src/reorganize.test.ts`
Expected: FAIL — `reorganizePhotos is not a function` (not implemented yet). The Task-2 tests still pass.

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/jobs/src/reorganize.ts`:

```typescript
async function exists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

/** True if another Photo row or an on-disk file already occupies `relCandidate`. */
async function targetTaken(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "photosDir">,
  relCandidate: string,
): Promise<boolean> {
  const row = await deps.db.photo.findUnique({
    where: { catalogId_path: { catalogId: deps.catalogId, path: relCandidate } },
    select: { id: true },
  });
  if (row) return true;
  return exists(path.join(deps.photosDir, relCandidate));
}

/** Resolve a collision-free catalog-relative target, suffixing "-1", "-2", … */
async function freeTarget(
  deps: Pick<ReorganizeDeps, "db" | "catalogId" | "photosDir">,
  desired: string,
): Promise<string> {
  const ext = path.posix.extname(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  let candidate = desired;
  let n = 0;
  while (await targetTaken(deps, candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

/** Catalog-relative parent dir of a path ("" for root). */
function relDir(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "." ? "" : dir;
}

/** Remove directories left empty by the moves, bottom-up, never past photosDir. */
async function pruneEmptyDirs(vacated: Set<string>, photosDir: string): Promise<void> {
  const root = path.resolve(photosDir);
  for (const start of vacated) {
    let dir = path.resolve(start);
    while (dir !== root && dir.startsWith(root + path.sep)) {
      try {
        const entries = await readdir(dir);
        if (entries.length > 0) break;
        await rmdir(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
  }
}

/**
 * Danger zone: move every in-scope photo into the folder its upload template
 * produces. Per photo, the DB row's `path`/`dirPath` are updated BEFORE the file
 * is renamed, so the filesystem watcher's resulting unlink/add events are
 * no-ops (the row already matches the new path; the old path has no row). The
 * photo id, edits, and renditions (keyed by id) are preserved.
 */
export async function reorganizePhotos(
  deps: ReorganizeDeps,
): Promise<{ moved: number; skipped: number; failed: number }> {
  const rows = (await deps.db.photo.findMany({
    where: scopeWhere(deps.catalogId, deps.includeFilesystem),
    select: SCOPE_SELECT,
  })) as PhotoRow[];

  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const vacated = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const desired = desiredPath(deps.uploadTemplate, row);
    if (desired === row.path) {
      skipped += 1;
      await deps.onProgress?.(i + 1, rows.length);
      continue;
    }

    const fromAbs = path.join(deps.photosDir, row.path);
    if (!(await exists(fromAbs))) {
      failed += 1;
      deps.onWarn?.(`source file missing, skipped: ${row.path}`);
      await deps.onProgress?.(i + 1, rows.length);
      continue;
    }

    const target = await freeTarget(deps, desired);
    const toAbs = path.join(deps.photosDir, target);

    // DB first (watcher-safe).
    await deps.db.photo.update({
      where: { id: row.id },
      data: { path: target, dirPath: relDir(target) },
    });

    try {
      await mkdir(path.dirname(toAbs), { recursive: true });
      await rename(fromAbs, toAbs);
      vacated.add(path.dirname(fromAbs));
      moved += 1;
    } catch (err) {
      // Revert the repoint so the row keeps matching the still-in-place file.
      await deps.db.photo.update({
        where: { id: row.id },
        data: { path: row.path, dirPath: relDir(row.path) },
      });
      failed += 1;
      deps.onWarn?.(
        `move failed for ${row.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await deps.onProgress?.(i + 1, rows.length);
  }

  await pruneEmptyDirs(vacated, deps.photosDir);
  return { moved, skipped, failed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/jobs && npx vitest run src/reorganize.test.ts`
Expected: PASS (all 13 tests across Task 2 + Task 3).

- [ ] **Step 5: Export the module + verify the package suite**

Add to `packages/jobs/src/index.ts` (after the `purge.js` export line):

```typescript
export * from "./reorganize.js";
```

Run: `cd packages/jobs && npx vitest run`
Expected: PASS (whole jobs package, including the new file).

- [ ] **Step 6: Commit**

```bash
git add packages/jobs/src/reorganize.ts packages/jobs/src/reorganize.test.ts packages/jobs/src/index.ts
git commit -m "feat(jobs): reorganizePhotos mover (DB-first, collision-safe, prunes empty dirs)"
```

---

## Task 4: Worker handlers

**Files:**
- Modify: `apps/worker/src/handlers.ts`
- Test: `apps/worker/src/handlers.test.ts`

Wire the mover into the worker for both job types. `HandlerDeps` gains a `reorganize` method, so every existing dep-fake in the test file must add it.

- [ ] **Step 1: Update the existing handler tests + add new ones (failing)**

In `apps/worker/src/handlers.test.ts`, add `reorganize: vi.fn()` to **every** `buildHandlers(() => ({ … }))` object (there are 8 of them — the `scan`/`purgeAll`/`emptyTrash`/`processTrash` fakes). Then append these new tests inside the `describe("buildHandlers", …)` block:

```typescript
  it("reorganize runs the mover (uploads only) and reports the moved count", async () => {
    const reorganize = vi.fn().mockResolvedValue({ moved: 4, skipped: 1, failed: 0 });
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.reorganize](report, { catalogId: "cat1" } as never);

    expect(reorganize).toHaveBeenCalledWith(false, expect.any(Function));
    expect(report).toHaveBeenLastCalledWith(4, 4, null);
  });

  it("reorganize_all runs the mover with includeFilesystem=true", async () => {
    const reorganize = vi.fn().mockResolvedValue({ moved: 2, skipped: 0, failed: 0 });
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.reorganize_all](report, { catalogId: "cat1" } as never);

    expect(reorganize).toHaveBeenCalledWith(true, expect.any(Function));
    expect(report).toHaveBeenLastCalledWith(2, 2, null);
  });

  it("reorganize is a no-op when catalogId is null", async () => {
    const reorganize = vi.fn();
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn();

    await handlers[JobType.reorganize](report, { catalogId: null } as never);

    expect(reorganize).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/worker && npx vitest run src/handlers.test.ts`
Expected: FAIL — `handlers[JobType.reorganize] is not a function` (and TS may flag the missing `reorganize` dep). The point is the new handler keys don't exist yet.

- [ ] **Step 3: Implement the handler deps + handlers**

In `apps/worker/src/handlers.ts`:

(a) Add `reorganizePhotos` to the `@lumio/jobs` import:

```typescript
import {
  type JobHandlers,
  finalizeTrash,
  purgeAllPhotos,
  purgePendingPhotos,
  purgeTrash,
  reorganizePhotos,
} from "@lumio/jobs";
```

(b) Add `reorganize` to the `HandlerDeps` interface (after `processTrash`):

```typescript
  reorganize: (
    includeFilesystem: boolean,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<{ moved: number; skipped: number; failed: number }>;
```

(c) Add the `reorganize` impl inside `depsForCatalog`'s returned object (after `processTrash`):

```typescript
    reorganize: async (includeFilesystem, onProgress) => {
      const c = await getCatalogById(catalogId);
      if (!c) return { moved: 0, skipped: 0, failed: 0 };
      return reorganizePhotos({
        db: prisma,
        catalogId,
        photosDir: c.path,
        uploadTemplate: c.uploadTemplate,
        includeFilesystem,
        onProgress,
        onWarn: (message) => log.warn(message, { scope: "consumer", catalogId }),
      });
    },
```

(d) Add the two handlers inside `buildHandlers`'s returned object (after `process_trash`):

```typescript
    [JobType.reorganize]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Reorganizing files…");
      const { moved } = await makeDeps(job.catalogId).reorganize(false, (done, total) => {
        void report(done, total, "Reorganizing files…").catch(() => {});
      });
      await report(moved, moved, null);
    },
    [JobType.reorganize_all]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Reorganizing files…");
      const { moved } = await makeDeps(job.catalogId).reorganize(true, (done, total) => {
        void report(done, total, "Reorganizing files…").catch(() => {});
      });
      await report(moved, moved, null);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/worker && npx vitest run src/handlers.test.ts`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/handlers.ts apps/worker/src/handlers.test.ts
git commit -m "feat(worker): reorganize / reorganize_all job handlers"
```

---

## Task 5: API routes (enqueue + preview)

**Files:**
- Create: `apps/web/src/app/api/c/[catalog]/photos/reorganize/route.ts`
- Create: `apps/web/src/app/api/c/[catalog]/photos/reorganize/preview/route.ts`

Thin wrappers over `enqueueJob` / `previewReorganize`, following the `photos/purge` route conventions (`withCatalog`, `runtime`, `dynamic`). The `includeFilesystem` flag is read from the query string (`useAsyncJob` POSTs with no body). The core logic they call is already unit-tested, so these get a lint check rather than a unit test (matching the untested `purge` route).

- [ ] **Step 1: Create the POST (enqueue) route**

Create `apps/web/src/app/api/c/[catalog]/photos/reorganize/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType, validateTemplate } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const check = validateTemplate(catalog.uploadTemplate);
  if (!check.ok) {
    return NextResponse.json({ error: `Invalid upload template: ${check.error}` }, { status: 400 });
  }
  const includeFilesystem =
    new URL(request.url).searchParams.get("includeFilesystem") === "true";
  const type = includeFilesystem ? JobType.reorganize_all : JobType.reorganize;
  const job = await enqueueJob(prisma, type, catalog.id);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
```

- [ ] **Step 2: Create the GET (preview) route**

Create `apps/web/src/app/api/c/[catalog]/photos/reorganize/preview/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { previewReorganize } from "@lumio/jobs";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const includeFilesystem =
    new URL(request.url).searchParams.get("includeFilesystem") === "true";
  const result = await previewReorganize({
    db: prisma,
    catalogId: catalog.id,
    uploadTemplate: catalog.uploadTemplate,
    includeFilesystem,
  });
  return NextResponse.json(result);
});
```

- [ ] **Step 3: Lint the new routes**

Run: `cd apps/web && npx eslint "src/app/api/c/[catalog]/photos/reorganize/route.ts" "src/app/api/c/[catalog]/photos/reorganize/preview/route.ts"`
Expected: no errors (exit 0).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/c/[catalog]/photos/reorganize/route.ts" "apps/web/src/app/api/c/[catalog]/photos/reorganize/preview/route.ts"
git commit -m "feat(web): reorganize enqueue + preview API routes"
```

---

## Task 6: Danger Zone UI card

**Files:**
- Create: `apps/web/src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx`
- Modify: `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx`

A confirm-word dialog (like `DeleteAllPhotos`) plus an "Include filesystem-imported photos" checkbox and a live preview count. UI components aren't unit-tested in this repo, so this task ends with a lint + manual browser verification.

- [ ] **Step 1: Create the component**

Create `apps/web/src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsyncJob } from "@/lib/hooks/use-async-job";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

const CONFIRM_WORD = "REORGANIZE";

export function ReorganizePhotos() {
  const router = useRouter();
  const { slug } = useCatalog();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [includeFilesystem, setIncludeFilesystem] = useState(false);
  const [preview, setPreview] = useState<{ total: number; willMove: number } | null>(null);

  const query = `?includeFilesystem=${includeFilesystem}`;
  const jobType = includeFilesystem ? JobType.reorganize_all : JobType.reorganize;
  const { phase, isActive, run } = useAsyncJob(
    jobType,
    catalogApiUrl(slug, `/photos/reorganize${query}`),
    {
      onComplete: () => router.refresh(),
      toasts: {
        pending: "Reorganizing files…",
        success: "Files reorganized",
        error: "Reorganize failed. Some files may not have moved.",
      },
    },
  );
  const busy = phase === "pending" || isActive;

  // Fetch the preview count whenever the dialog is open and the scope changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    fetch(catalogApiUrl(slug, `/photos/reorganize/preview${query}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { total: number; willMove: number }) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, query]);

  const canRun = confirm === CONFIRM_WORD && (preview?.willMove ?? 0) > 0 && !busy;

  function start() {
    setOpen(false);
    setConfirm("");
    void run();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">Reorganize files</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reorganize files by upload template?</DialogTitle>
          <DialogDescription>
            Moves photos on disk into the folders your current upload template produces.
            Photo edits and metadata are preserved. The on-disk layout change cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Checkbox
            id="include-filesystem"
            checked={includeFilesystem}
            onCheckedChange={(v) => setIncludeFilesystem(v === true)}
          />
          <Label htmlFor="include-filesystem">Include filesystem-imported photos</Label>
        </div>

        <p className="text-sm text-muted-foreground tabular-nums">
          {preview === null
            ? "Calculating…"
            : `${preview.willMove} of ${preview.total} photos will be relocated.`}
        </p>

        <Field>
          <FieldLabel htmlFor="confirm-reorganize">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </FieldLabel>
          <Input
            id="confirm-reorganize"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
          />
          {phase === "error" && (
            <FieldError>Something went wrong. Some files may not have moved. Try again.</FieldError>
          )}
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={!canRun} onClick={start}>
            {busy ? "Reorganizing…" : "Reorganize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Render the card in the danger tab**

In `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx`, find the `<TabsContent value="danger">` block (around line 194-206). Add the import near the other danger-zone import:

```tsx
import { ReorganizePhotos } from "./reorganize-photos";
```

Then, inside `<TabsContent value="danger">`, add a second `<Card>` **above** the existing "Delete all photos" card:

```tsx
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Reorganize files</CardTitle>
                <CardDescription>
                  Move existing photos into the folder structure your upload template produces.
                  Edits and metadata are preserved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReorganizePhotos />
              </CardContent>
            </Card>
```

(Keep the existing `DeleteAllPhotos` card as-is below it.)

- [ ] **Step 3: Lint the new component + page**

Run: `cd apps/web && npx eslint "src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx" "src/app/(app)/settings/catalogs/[id]/page.tsx"`
Expected: no errors (exit 0). If the React Compiler lint flags `query` in the effect deps, that's expected and satisfied (it's a primitive derived from state).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx" "apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx"
git commit -m "feat(web): Reorganize files Danger Zone card with count preview"
```

---

## Task 7: Full verification + manual browser check

**Files:** none (verification only)

- [ ] **Step 1: Run all affected automated suites**

```bash
cd packages/jobs && npx vitest run
cd ../../apps/worker && npx vitest run src/handlers.test.ts
cd ../../packages/shared && npx vitest run src/uploads.test.ts
```
Expected: all green. (Note: `apps/worker/src/scan.test.ts` and the pre-existing `packages/ingest` / `packages/db` metadata failures documented earlier are unrelated to this work — confirm any failure is one of those, not a new one, by checking it reproduces on `git stash`.)

- [ ] **Step 2: Lint all changed web files**

```bash
cd apps/web && npx eslint \
  "src/app/api/c/[catalog]/photos/reorganize/route.ts" \
  "src/app/api/c/[catalog]/photos/reorganize/preview/route.ts" \
  "src/app/(app)/settings/catalogs/[id]/reorganize-photos.tsx" \
  "src/app/(app)/settings/catalogs/[id]/page.tsx"
```
Expected: exit 0.

- [ ] **Step 3: Manual browser verification (requires the web app + worker running)**

1. Open a catalog → Settings → Danger Zone. Confirm the new "Reorganize files" card renders above "Delete all photos".
2. Open the dialog → confirm the count shows `N of M photos will be relocated`; toggle "Include filesystem-imported photos" and confirm the count updates.
3. Type `REORGANIZE`, click Reorganize. Confirm the activity aperture shows progress and the page refreshes when done.
4. Verify on disk that files moved into the template's folders and that the photos still display (renditions intact, edits preserved). Re-open the dialog and confirm the count is now `0 of M` (idempotent).

- [ ] **Step 4: Mark the spec status Done**

In `docs/superpowers/specs/2026-06-27-reorganize-by-upload-template-design.md`, change the `Status:` line to `Implemented`.

```bash
git add docs/superpowers/specs/2026-06-27-reorganize-by-upload-template-design.md
git commit -m "docs: mark reorganize-by-upload-template spec implemented"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Scope toggle (uploads vs all, exclude trashed) → `scopeWhere` (Task 2), checkbox (Task 6), two job types (Task 1/4/5).
- `{NOW_*}`=createdAt, `{TAKEN_*}`=takenAt→fileModifiedAt→fileCreatedAt → `desiredPath` (Task 2), tested.
- Count preview + confirm word → preview route (Task 5) + dialog (Task 6).
- Watcher-safe DB-first ordering → `reorganizePhotos` update-before-rename (Task 3), revert-on-failure tested.
- Collision suffix, empty-dir prune, missing-file tolerance → Task 3 (each tested).
- Worker job + progress → Task 4.

**Placeholder scan:** none — every code step contains full code; every run step has an exact command + expected result.

**Type consistency:** `ReorganizeDeps`, `desiredPath`, `previewReorganize`, `reorganizePhotos`, and the `{ moved, skipped, failed }` / `{ total, willMove }` shapes are used identically across the mover, handler (`reorganize(includeFilesystem, onProgress)`), routes, and UI. Job-type names `reorganize` / `reorganize_all` match across enum, handler keys, route, and `useAsyncJob`. The composite key `catalogId_path` matches the watcher's usage and the `@@unique([catalogId, path])` schema constraint.

**Known deviation from the prose spec:** a missing source file is counted as `failed` (with an `onWarn`), not `skipped` — it's an anomaly worth surfacing, and `skipped` is reserved for "already at target". Behavior is otherwise as specified.
