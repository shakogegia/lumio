# Edits-safe Re-ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the worker's re-ingest from clobbering user edits, renditions, dimensions, and sort order — re-import a file only when its content hash actually changed; otherwise refresh the stamp or heal a missing cache edits-aware.

**Architecture:** Change detection switches from mtime/size to **content hash**, with mtime/size kept as a cheap pre-filter. A scan/watch of an already-ingested path resolves to one of: skip, refresh-stamp-only, heal-cache (edits-aware rendition rebuild, no DB write), or full re-import (only on a real hash change, which also resets `edits`). New rendition-rebuild and hashing helpers live in `@lumio/ingest`; the per-file decision is two pure functions in the worker, shared by both the scan and the watcher.

**Tech Stack:** TypeScript, pnpm workspace, Prisma (Postgres), sharp, chokidar, vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-reingest-no-clobber-design.md`

> **Pre-existing typecheck baseline (read before any `typecheck` step):** At the
> base commit, `packages/shared/src/calendar.ts` already has 3 TypeScript errors
> (`(34,28)` TS2769, `(34,31)` TS18048, `(35,27)` TS2769). These are unrelated to
> this work and surface in every package that references `@lumio/shared`. So a
> `typecheck` step's success criterion is: **no NEW errors are introduced — the
> only errors reported are those 3 in `packages/shared/src/calendar.ts`.** Do not
> fix calendar.ts (out of scope).

---

## File Structure

- `packages/ingest/src/hash.ts` — **create** — `hashBuffer`/`hashFile`; content-hash helpers.
- `packages/ingest/src/process.ts` — **modify** — use `hashBuffer` (DRY) instead of inline `createHash`.
- `packages/ingest/src/regenerate.ts` — **create** — `regenerateRenditions`: edits-aware rebuild of display+thumbnail by id, no DB write.
- `packages/ingest/src/store.ts` — **modify** — reset `edits` to `JsonNull` on the upsert *update* path (genuine re-import only).
- `packages/ingest/src/index.ts` — **modify** — export the two new modules.
- `apps/worker/src/scan.ts` — **modify** — replace `isUnchanged` with `planScan` + `planAfterHash` (pure) and a shared `reconcileFile`; expand the row select; add `healed`/`restamped` counters.
- `apps/worker/src/scan.test.ts` — **modify** — replace `isUnchanged` tests with `planScan`/`planAfterHash` tests.
- `apps/worker/src/watch.ts` — **modify** — route `add`/`change` through `reconcileFile`.
- `apps/web/src/app/(app)/settings/page.tsx` — **modify** — honest rescan copy.

---

## Task 1: Content-hash helpers in `@lumio/ingest`

**Files:**
- Create: `packages/ingest/src/hash.ts`
- Create: `packages/ingest/src/hash.test.ts`
- Modify: `packages/ingest/src/process.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/hash.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hashBuffer, hashFile } from "./hash.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-hash-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe("hashBuffer", () => {
  it("is the sha256 hex of the bytes and is deterministic", () => {
    const a = hashBuffer(Buffer.from("hello"));
    expect(a).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(hashBuffer(Buffer.from("hello"))).toBe(a);
  });

  it("differs when the bytes differ", () => {
    expect(hashBuffer(Buffer.from("a"))).not.toBe(hashBuffer(Buffer.from("b")));
  });
});

describe("hashFile", () => {
  it("hashes the file's bytes (matches hashBuffer of the same content)", async () => {
    const p = path.join(dir, "f.bin");
    const bytes = Buffer.from("some-image-bytes");
    await writeFile(p, bytes);
    expect(await hashFile(p)).toBe(hashBuffer(bytes));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/hash.test.ts`
Expected: FAIL — cannot find module `./hash.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/hash.ts`:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** sha256 hex of a buffer's bytes — the value stored on `Photo.hash`. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** sha256 hex of a file's bytes, without decoding it. Used for change detection. */
export async function hashFile(absPath: string): Promise<string> {
  return hashBuffer(await readFile(absPath));
}
```

Add to `packages/ingest/src/index.ts` (after the `process.js` export line):

```ts
export * from "./hash.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `process.ts` to reuse `hashBuffer` (DRY)**

In `packages/ingest/src/process.ts`, remove the `createHash` import line:

```ts
import { createHash } from "node:crypto";
```

Add `hashBuffer` to the existing local imports near the top:

```ts
import { hashBuffer } from "./hash.js";
```

Replace the hash line inside `processImage`:

```ts
    const hash = createHash("sha256").update(original).digest("hex");
```

with:

```ts
    const hash = hashBuffer(original);
```

- [ ] **Step 6: Run the ingest suite to confirm nothing broke**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS (all existing tests + hash.test.ts).

- [ ] **Step 7: Commit**

```bash
git add packages/ingest/src/hash.ts packages/ingest/src/hash.test.ts packages/ingest/src/process.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): content-hash helpers (hashBuffer/hashFile)"
```

---

## Task 2: `regenerateRenditions` — edits-aware cache heal

**Files:**
- Create: `packages/ingest/src/regenerate.ts`
- Create: `packages/ingest/src/regenerate.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/regenerate.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { regenerateRenditions } from "./regenerate.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-regen-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

// A 4x2 landscape PNG, no EXIF orientation.
const src = path.join(dir, "src.png");
await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } })
  .png()
  .toFile(src);

describe("regenerateRenditions", () => {
  it("writes display + thumbnail named by id and returns a thumbhash", async () => {
    const thumbs = path.join(dir, "t1");
    const displays = path.join(dir, "d1");
    const out = await regenerateRenditions(src, null, "pA", { thumbnailsDir: thumbs, displaysDir: displays });

    expect([out.width, out.height]).toEqual([4, 2]);
    expect(typeof out.thumbhash).toBe("string");
    const display = await readFile(path.join(displays, "pA.webp"));
    const meta = await sharp(display).metadata();
    expect([meta.width, meta.height]).toEqual([4, 2]);
  });

  it("bakes the edit recipe — a 90° rotation swaps the rendition's dimensions", async () => {
    const thumbs = path.join(dir, "t2");
    const displays = path.join(dir, "d2");
    const out = await regenerateRenditions(
      src,
      { rotate: 90, flipH: false, flipV: false },
      "pB",
      { thumbnailsDir: thumbs, displaysDir: displays },
    );

    expect([out.width, out.height]).toEqual([2, 4]);
    const display = await readFile(path.join(displays, "pB.webp"));
    const meta = await sharp(display).metadata();
    expect([meta.width, meta.height]).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/regenerate.test.ts`
Expected: FAIL — cannot find module `./regenerate.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/regenerate.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoEdits } from "@lumio/shared";
import { decodeToSharpInput } from "./decode.js";
import { buildRenditions } from "./renditions.js";

export interface RegenerateDeps {
  thumbnailsDir: string;
  displaysDir: string;
}

/**
 * Rebuild a photo's display + thumbnail renditions edits-aware and write them by
 * id. Heals a missing cache WITHOUT re-importing: touches only the rendition
 * files, never the DB. The returned thumbhash + oriented size match what a
 * correct ingest produced, so a caller that already has them stored need not
 * persist anything.
 */
export async function regenerateRenditions(
  absPath: string,
  edits: PhotoEdits | null,
  id: string,
  deps: RegenerateDeps,
): Promise<{ thumbhash: string; width: number; height: number }> {
  const decoded = await decodeToSharpInput(absPath);
  try {
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      edits,
    );
    await mkdir(deps.displaysDir, { recursive: true });
    await mkdir(deps.thumbnailsDir, { recursive: true });
    await writeFile(path.join(deps.displaysDir, `${id}.webp`), display);
    await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), thumbnail);
    return { thumbhash, width, height };
  } finally {
    await decoded.cleanup();
  }
}
```

Add to `packages/ingest/src/index.ts`:

```ts
export * from "./regenerate.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/regenerate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/regenerate.ts packages/ingest/src/regenerate.test.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): regenerateRenditions for edits-aware cache heal"
```

---

## Task 3: Reset `edits` on genuine re-import in `storePhoto`

**Files:**
- Modify: `packages/ingest/src/store.ts`
- Modify: `packages/ingest/src/store.test.ts`

Rationale: after this plan, `storePhoto`'s upsert *update* path runs only on a genuine content change (new files hit *create*). Per spec decision A, a replaced file is a fresh photo, so its stale `edits` recipe must be cleared. `create` leaves `edits` at its column default (null).

- [ ] **Step 1: Write the failing test**

In `packages/ingest/src/store.test.ts`, add this test inside the `describe("storePhoto", ...)` block (after the existing `source` test):

```ts
  it("clears edits on update (a re-import replaces stale recipes) but not on create", async () => {
    const db = fakeDb("photo123");
    await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "t3"), displaysDir: path.join(dir, "d3") },
    );

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    // Prisma's JsonNull sentinel is the only way to clear a Json column.
    expect(args.update.edits).toBe(Prisma.JsonNull);
    expect(args.create).not.toHaveProperty("edits");
  });
```

Add the `Prisma` import at the top of `store.test.ts`:

```ts
import { Prisma } from "@lumio/db";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: FAIL — `args.update.edits` is `undefined`, not `Prisma.JsonNull`.

- [ ] **Step 3: Write minimal implementation**

In `packages/ingest/src/store.ts`, add the `Prisma` import to the existing `@lumio/db` import line. Change:

```ts
import type { PrismaClient } from "@lumio/db";
```

to:

```ts
import { Prisma, type PrismaClient } from "@lumio/db";
```

Then change the upsert call's `update` field. Replace:

```ts
  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, source, ...data },
    update: data,
    select: { id: true },
  });
```

with:

```ts
  const row = await deps.db.photo.upsert({
    where: { path: relPath },
    create: { path: relPath, source, ...data },
    // A re-import means the file's bytes changed (the scan/watch only calls this
    // on a genuine hash change); the old edit recipe no longer applies to the
    // new pixels, so clear it. `create` leaves edits at its column default.
    update: { ...data, edits: Prisma.JsonNull },
    select: { id: true },
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: PASS (all storePhoto tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "fix(ingest): clear edits when re-importing changed file content"
```

---

## Task 4: Pure scan decisions — `planScan` + `planAfterHash`

**Files:**
- Modify: `apps/worker/src/scan.ts`
- Modify: `apps/worker/src/scan.test.ts`

This task only adds/replaces the **pure** decision functions and their tests. Wiring happens in Task 5.

- [ ] **Step 1: Write the failing test**

Replace the entire `describe("isUnchanged", ...)` block in `apps/worker/src/scan.test.ts` with:

```ts
import { planAfterHash, planScan } from "./scan.js";

describe("planScan", () => {
  const st = { size: 100, mtimeMs: 5000.5 };

  it("is 'new' when there is no row", () => {
    expect(planScan(undefined, st, false)).toBe("new");
  });

  it("is 'skip' when size+mtime match and the cache exists", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 5000.5 }, st, true)).toBe("skip");
  });

  it("is 'heal' when size+mtime match but the cache is missing", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 5000.5 }, st, false)).toBe("heal");
  });

  it("is 'check-hash' when size differs", () => {
    expect(planScan({ fileSize: 99, fileMtimeMs: 5000.5 }, st, true)).toBe("check-hash");
  });

  it("is 'check-hash' when mtime differs", () => {
    expect(planScan({ fileSize: 100, fileMtimeMs: 1 }, st, true)).toBe("check-hash");
  });

  it("is 'check-hash' for a legacy row with null stats", () => {
    expect(planScan({ fileSize: null, fileMtimeMs: null }, st, true)).toBe("check-hash");
  });
});

describe("planAfterHash", () => {
  it("re-imports when the content hash changed", () => {
    expect(planAfterHash(false, true)).toBe("reimport");
    expect(planAfterHash(false, false)).toBe("reimport");
  });

  it("refreshes the stamp only when the hash matches and the cache exists", () => {
    expect(planAfterHash(true, true)).toBe("stamp-only");
  });

  it("heals when the hash matches but the cache is missing", () => {
    expect(planAfterHash(true, false)).toBe("heal");
  });
});
```

Also remove the now-stale `isUnchanged` import from the top of the file. Change:

```ts
import { isUnchanged, reconcileDeletions } from "./scan.js";
```

to:

```ts
import { reconcileDeletions } from "./scan.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: FAIL — `planScan`/`planAfterHash` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/worker/src/scan.ts`, replace the `isUnchanged` function (the whole block from its doc comment through its closing brace) with:

```ts
export type ScanPlan = "new" | "skip" | "heal" | "check-hash";

/**
 * First decision, from stat + cache presence alone (no file read):
 *  - no row            → "new" (ingest a brand-new file)
 *  - stamp matches      → "skip" (cache present) or "heal" (cache missing)
 *  - stamp differs      → "check-hash" (read the bytes to tell a real change
 *    from a backup/sync that only touched the timestamp)
 */
export function planScan(
  row: { fileSize: number | null; fileMtimeMs: number | null } | undefined,
  st: { size: number; mtimeMs: number },
  cacheExists: boolean,
): ScanPlan {
  if (!row) return "new";
  const stampMatches = row.fileSize === st.size && row.fileMtimeMs === st.mtimeMs;
  if (stampMatches) return cacheExists ? "skip" : "heal";
  return "check-hash";
}

export type HashPlan = "stamp-only" | "heal" | "reimport";

/**
 * Second decision, once the content hash is known. A changed hash is a genuine
 * pixel replacement → re-import. An unchanged hash means only the timestamp
 * moved → refresh the stamp (and heal the cache if it is missing).
 */
export function planAfterHash(hashMatches: boolean, cacheExists: boolean): HashPlan {
  if (!hashMatches) return "reimport";
  return cacheExists ? "stamp-only" : "heal";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: PASS (planScan + planAfterHash + reconcileDeletions tests).

Note: `apps/worker/src/scan.ts` will not typecheck standalone yet because `isUnchanged` is no longer referenced inside `scanAndIngest` — that wiring is Task 5. Do not run a full worker typecheck until Task 5 is done. (The vitest run above only loads the pure functions and passes.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/scan.test.ts
git commit -m "feat(worker): pure scan decisions planScan/planAfterHash (hash-based)"
```

---

## Task 5: Wire the scan to hash-based reconcile

**Files:**
- Modify: `apps/worker/src/scan.ts`

Replace mtime-based skip with the new plan: a shared `reconcileFile`, a `refreshStamp` helper, an edits-aware heal, and expanded counters. `scanAndIngest` and the watcher (Task 6) both call `reconcileFile`.

- [ ] **Step 1: Update imports and `ScanSummary`**

In `apps/worker/src/scan.ts`, replace the existing import of `@lumio/ingest`:

```ts
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
```

with:

```ts
import {
  SUPPORTED_EXTENSIONS,
  hashFile,
  ingestPath,
  regenerateRenditions,
  removePath,
} from "@lumio/ingest";
```

Add this import below the existing `@lumio/ingest` line (the file already imports `prisma` from `@lumio/db` — do not add a second one):

```ts
import { coercePhotoEdits } from "@lumio/shared";
```

Replace the `ScanSummary` interface:

```ts
export interface ScanSummary {
  processed: number;
  skipped: number;
  skippedUnchanged: number;
  removed: number;
}
```

with:

```ts
export interface ScanSummary {
  processed: number; // new files + genuine re-imports
  skipped: number; // errored files
  skippedUnchanged: number; // content unchanged, nothing to do
  healed: number; // missing cache rebuilt edits-aware
  restamped: number; // timestamp moved but content identical
  removed: number;
}
```

- [ ] **Step 2: Add the shared row select, type, and helpers**

In `apps/worker/src/scan.ts`, add after the `planAfterHash` function (from Task 4):

```ts
/** Columns the per-file reconcile needs. */
export const SCAN_SELECT = {
  id: true,
  path: true,
  fileSize: true,
  fileMtimeMs: true,
  hash: true,
  edits: true,
} as const;

export interface ScanRow {
  id: string;
  path: string;
  fileSize: number | null;
  fileMtimeMs: number | null;
  hash: string | null;
  edits: unknown;
}

async function cachePresent(id: string): Promise<boolean> {
  return (await fileExists(thumbnailPath(id))) && (await fileExists(displayPath(id)));
}

/** Rebuild a missing cache from the stored recipe — no DB write. */
async function heal(row: ScanRow, absPath: string): Promise<void> {
  await regenerateRenditions(absPath, coercePhotoEdits(row.edits), row.id, ingestDeps);
}

/** Record the current size+mtime so an unchanged file isn't re-hashed next scan. */
async function refreshStamp(id: string, st: { size: number; mtimeMs: number }): Promise<void> {
  await prisma.photo.update({
    where: { id },
    data: { fileSize: st.size, fileMtimeMs: st.mtimeMs },
  });
}

/**
 * Reconcile one on-disk file against its DB row, mutating `summary`. Shared by
 * the full scan (row supplied from a preloaded map) and the watcher (row fetched
 * per event). Never clobbers edits/sort/renditions for an unchanged file.
 */
export async function reconcileFile(
  relPath: string,
  row: ScanRow | undefined,
  summary: ScanSummary,
): Promise<void> {
  const absPath = path.join(PHOTOS_DIR, relPath);
  const st = await stat(absPath);
  const cacheExists = row ? await cachePresent(row.id) : false;

  let plan = planScan(row, st, cacheExists);
  if (plan === "check-hash") {
    const matches = (await hashFile(absPath)) === row!.hash;
    const after = planAfterHash(matches, cacheExists);
    if (after === "stamp-only") {
      await refreshStamp(row!.id, st);
      summary.restamped++;
      return;
    }
    if (after === "heal") {
      await heal(row!, absPath);
      await refreshStamp(row!.id, st);
      summary.healed++;
      return;
    }
    plan = "new"; // "reimport" → full ingest below (storePhoto clears stale edits)
  }

  if (plan === "skip") {
    summary.skippedUnchanged++;
    return;
  }
  if (plan === "heal") {
    await heal(row!, absPath);
    summary.healed++;
    return;
  }

  const start = performance.now();
  await ingestPath(relPath, ingestDeps);
  summary.processed++;
  console.log(`processed ${timedLine(relPath, performance.now() - start)}`);
}
```

- [ ] **Step 3: Rewrite `scanAndIngest` to use `reconcileFile`**

Replace the body of `scanAndIngest` (from `const relPaths` through the final `return summary;`) with:

```ts
  const relPaths = await listImages();
  const summary: ScanSummary = {
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  };

  const existing = await prisma.photo.findMany({ select: SCAN_SELECT });
  const byPath = new Map(existing.map((p) => [p.path, p]));
  let done = 0;

  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i]!;
    try {
      await reconcileFile(relPath, byPath.get(relPath), summary);
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    } finally {
      onProgress?.(++done, relPaths.length);
    }
  });

  const onDisk = new Set(relPaths);
  const toDelete = new Set(reconcileDeletions(existing.map((p) => p.path), onDisk));
  const deleteRows = existing.filter((p) => toDelete.has(p.path));
  await runPool(deleteRows.length, INGEST_CONCURRENCY, async (i) => {
    const row = deleteRows[i]!;
    try {
      await removePath(row.path, removeDeps);
      summary.removed++;
    } catch (err) {
      console.warn(`remove failed ${row.path}: ${(err as Error).message}`);
    }
  });

  return summary;
```

Note: the now-unused `stat` and `access`/`fileExists` references — `stat` is still used by `reconcileFile`; `fileExists` is still used by `cachePresent`; keep both imports. The `performance` import is still used by `reconcileFile`.

- [ ] **Step 4: Typecheck the worker**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS (no errors). If it reports `isUnchanged` unused or missing, ensure the old function/usages are fully removed.

- [ ] **Step 5: Run the worker + ingest suites**

Run: `pnpm --filter @lumio/worker test && pnpm --filter @lumio/ingest test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/scan.ts
git commit -m "feat(worker): hash-based scan reconcile — never clobber edits/sort"
```

---

## Task 6: Route the watcher through `reconcileFile`

**Files:**
- Modify: `apps/worker/src/watch.ts`

The watcher's `add`/`change` currently call `ingestPath` directly (a full re-ingest that clobbers). Route them through `reconcileFile` so a `change` on an edited file only re-imports on a real content change.

- [ ] **Step 1: Update imports**

In `apps/worker/src/watch.ts`, replace:

```ts
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
```

with:

```ts
import { SUPPORTED_EXTENSIONS, removePath } from "@lumio/ingest";
```

Replace:

```ts
import { ingestDeps, removeDeps } from "./deps.js";
import { timedLine } from "./format.js";
import { scanAndIngest } from "./scan.js";
```

with:

```ts
import { prisma } from "@lumio/db";
import { removeDeps } from "./deps.js";
import { SCAN_SELECT, reconcileFile, scanAndIngest, type ScanSummary } from "./scan.js";
```

(Remove the `ingestDeps` and `timedLine` imports — they are no longer used in this file. Also remove the now-unused `performance` import line `import { performance } from "node:perf_hooks";` at the top.)

- [ ] **Step 2: Replace the `upsert` handler**

Replace the whole `upsert` function:

```ts
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    activity.importing++;
    try {
      const start = performance.now();
      await ingestPath(rel, ingestDeps);
      console.log(`+ ${timedLine(rel, performance.now() - start)}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    } finally {
      activity.importing--;
    }
  };
```

with:

```ts
  const emptySummary = (): ScanSummary => ({
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  });

  // Reconcile a single touched file. A `change` on an already-ingested photo
  // only triggers a full re-import when its content hash actually changed, so
  // editing EXIF or a backup touching the mtime can no longer revert user edits.
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    activity.importing++;
    try {
      const row = await prisma.photo.findUnique({ where: { path: rel }, select: SCAN_SELECT });
      await reconcileFile(rel, row ?? undefined, emptySummary());
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    } finally {
      activity.importing--;
    }
  };
```

- [ ] **Step 3: Typecheck the worker**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS. If `timedLine`, `ingestDeps`, or `performance` are reported unused, confirm their import lines were removed.

- [ ] **Step 4: Run the worker suite**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/watch.ts
git commit -m "feat(worker): watcher change events reconcile by hash, not blind re-ingest"
```

---

## Task 7: Honest rescan-button copy

**Files:**
- Modify: `apps/web/src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Update the description**

In `apps/web/src/app/(app)/settings/page.tsx`, change the Indexing card description. Replace:

```tsx
              <CardDescription>
                Trigger a full rescan of the photos directory.
              </CardDescription>
```

with:

```tsx
              <CardDescription>
                Scan the library for new and deleted files. Existing photos and
                their edits are left untouched.
              </CardDescription>
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @lumio/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/settings/page.tsx"
git commit -m "docs(web): rescan button copy reflects new-files-only reconcile"
```

---

## Task 8: Full verification + manual regression check

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every package that changed**

Run: `pnpm --filter @lumio/ingest typecheck && pnpm --filter @lumio/worker typecheck && pnpm --filter @lumio/web typecheck`
Expected: PASS for all three.

- [ ] **Step 2: Run the whole test suite**

Run: `pnpm -r test`
Expected: PASS across all packages.

- [ ] **Step 3: Manual end-to-end regression (real DB + worker)**

This exercises the integration glue that has no DB-backed unit harness. Run against a dev DB with the worker watching.

1. Start the stack: `pnpm db:up`, then `pnpm dev` (web) and `pnpm watch` (worker) in separate shells.
2. In the UI, open a photo, rotate it 270°, and Apply. Confirm it renders rotated and `edits.rotate === 270`.
3. Simulate a backup/sync touching the mtime: `touch "<PHOTOS_DIR>/<that photo's relative path>"`.
4. Trigger Settings → Rescan now (and/or wait for the watcher's `change` event).
5. **Expected:** the photo still renders rotated; `edits` is still `270`; its grid position (sortDate) is unchanged. Worker log shows a `restamped`/no-op, not a `processed` re-import.
6. Heal check: delete the photo's `cache/displays/<id>.webp`, run Rescan. **Expected:** the display rebuilds **rotated** (edits-aware), `edits`/sort unchanged.
7. Genuine-change check: overwrite the original file with different image bytes at the same path, run Rescan. **Expected:** the photo updates to the new pixels and `edits` resets to none.

- [ ] **Step 4: Final commit (only if any verification fix was needed)**

If steps 1-3 surfaced a fix, commit it:

```bash
git add -A
git commit -m "fix(worker): address re-ingest verification findings"
```

---

## Out of scope (from the spec)

- **Already-clobbered production rows** (recipe says rotate, rendition is un-rotated) are not auto-repaired here. They self-heal when the user re-applies the edit. A one-off backfill (re-apply each row's saved `edits` to regenerate its rendition) can be a follow-up if a bulk repair is wanted.
- No "force re-import / re-read metadata for existing photos" affordance is added.
