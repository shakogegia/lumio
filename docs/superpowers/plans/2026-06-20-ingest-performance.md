# Ingest Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ingest skip unchanged files (so restarts cost seconds) and process new files with a cores-sized worker pool plus a matching libuv threadpool (so cold imports run at the hardware's real ceiling).

**Architecture:** Add `fileSize`/`fileMtimeMs` to `Photo`; `scanAndIngest` stats each file and skips when size+mtime match and both cache renditions exist, otherwise re-ingests through a bounded `runPool`. A shared `runPool` (extracted from the seeder) caps in-flight work at `INGEST_CONCURRENCY` (default `os.cpus().length`), and thin entry launchers set `UV_THREADPOOL_SIZE` to that value before Sharp loads — without which the pool plateaus at ~3.9×.

**Tech Stack:** TypeScript (ESM), pnpm workspace, Prisma + Postgres, Sharp, Vitest, tsx, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-06-20-ingest-performance-design.md`

**Pre-req for DB tasks:** Postgres must be running — `pnpm db:up` (it listens on the port in `.env`, currently 5433).

---

### Task 1: Extract a shared `runPool`

A bounded worker pool already lives privately in `apps/worker/src/seed.ts:140`. Extract it (generic, no built-in logging) so both the seeder and the scanner share one implementation.

**Files:**
- Create: `apps/worker/src/pool.ts`
- Create: `apps/worker/src/pool.test.ts`
- Modify: `apps/worker/src/seed.ts` (remove private `runPool`, import the shared one, keep progress logging in the task callback)

- [ ] **Step 1: Write the failing test**

`apps/worker/src/pool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runPool } from "./pool.js";

describe("runPool", () => {
  it("runs the task for every index in [0, total)", async () => {
    const seen: number[] = [];
    await runPool(5, 2, async (i) => {
      seen.push(i);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds `limit` tasks in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(20, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("is a no-op when total is 0", async () => {
    let calls = 0;
    await runPool(0, 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker exec vitest run src/pool.test.ts`
Expected: FAIL — `Cannot find module './pool.js'` / `runPool is not a function`.

- [ ] **Step 3: Create the shared pool**

`apps/worker/src/pool.ts`:

```ts
/** Run `task(i)` for every i in [0, total), with at most `limit` in flight at once. */
export async function runPool(
  total: number,
  limit: number,
  task: (i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < total) {
      const i = next++;
      await task(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker exec vitest run src/pool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `seed.ts` to use the shared pool**

In `apps/worker/src/seed.ts`, delete the private `runPool` function (the block at lines ~139-155, the one with the `/** Run \`tasks\` with at most \`limit\` in flight at once. */` doc comment) and add to the imports at the top:

```ts
import { runPool } from "./pool.js";
```

Replace the seeding call (currently `await runPool(count, CONCURRENCY, (i) => { ... })` near line 175) so progress logging lives in the task callback instead of the pool:

```ts
  let done = 0;
  const step = Math.max(1, Math.floor(count / 10));
  await runPool(count, CONCURRENCY, async (i) => {
    const name = `seed-${String(i + 1).padStart(pad, "0")}.jpg`;
    await makeVariant(pick(bases), path.join(outDir, name), now);
    done++;
    if (done % step === 0 || done === count) {
      console.log(`  ${done}/${count}`);
    }
  });
```

- [ ] **Step 6: Verify seeder still typechecks**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/pool.ts apps/worker/src/pool.test.ts apps/worker/src/seed.ts
git commit -m "refactor(worker): extract shared runPool from seeder"
```

---

### Task 2: Add `INGEST_CONCURRENCY` to worker config

**Files:**
- Modify: `apps/worker/src/config.ts`

- [ ] **Step 1: Add the constant**

At the top of `apps/worker/src/config.ts`, add the `os` import alongside the existing imports:

```ts
import os from "node:os";
```

Then add this export (place it after the `DISPLAYS_DIR` export, before the `thumbnailPath` helper):

```ts
/**
 * Max images processed in parallel during a scan. Defaults to the logical core
 * count. The entry launchers (main.ts / watch-main.ts) also size
 * UV_THREADPOOL_SIZE to this value — Sharp's decode/encode runs on the libuv
 * threadpool, so without that the pool plateaus at ~4 regardless of cores.
 */
export const INGEST_CONCURRENCY = Math.max(
  1,
  Number(process.env.INGEST_CONCURRENCY) || os.cpus().length,
);
```

(`Number(undefined)` and `Number("")` are falsy/NaN → both fall back to `os.cpus().length`; `Math.max(1, …)` guards against a `0`/`1` misconfig.)

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/config.ts
git commit -m "feat(worker): add INGEST_CONCURRENCY config (default cpu count)"
```

---

### Task 3: Add `fileSize` + `fileMtimeMs` to the Photo model

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `model Photo` block)
- Creates (generated): `packages/db/prisma/migrations/<timestamp>_add_file_stat_to_photo/migration.sql`

- [ ] **Step 1: Edit the schema**

In `packages/db/prisma/schema.prisma`, inside `model Photo`, add these two fields immediately after the `hash String?` line:

```prisma
  fileSize    Int?    // bytes from fs.stat; nullable so existing rows migrate cleanly
  fileMtimeMs Float?  // mtimeMs from fs.stat (fractional ms) — change-detection signal
```

- [ ] **Step 2: Ensure the database is running**

Run: `pnpm db:up`
Expected: the `db` container is up (or already running).

- [ ] **Step 3: Create and apply the migration (also regenerates the client)**

Run: `pnpm --filter @lumio/db migrate --name add_file_stat_to_photo`
Expected: Prisma prints "The following migration(s) have been created and applied" and "Your database is now in sync with your schema", a new folder appears under `packages/db/prisma/migrations/`, and the client is regenerated. The generated `migration.sql` should contain two `ALTER TABLE "Photo" ADD COLUMN` statements (both nullable, no default).

- [ ] **Step 4: Verify the client picked up the fields**

Run: `pnpm --filter @lumio/db typecheck`
Expected: PASS (the generated `Photo` type now includes `fileSize` and `fileMtimeMs`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add fileSize + fileMtimeMs to Photo for change detection"
```

---

### Task 4: Persist `fileSize` + `fileMtimeMs` in `storePhoto`

**Files:**
- Modify: `packages/ingest/src/store.ts` (`StoreInput` + the `data` payload)
- Modify: `packages/ingest/src/store.test.ts`

- [ ] **Step 1: Extend the failing test**

In `packages/ingest/src/store.test.ts`, update the first test to pass the new fields and assert they are written. Replace the `storePhoto({ path: "vacation/img.jpg", source: PhotoSource.filesystem, processed }, …)` call in the **first** `it(...)` with:

```ts
    const result = await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 12345,
        fileMtimeMs: 1710408413000.5,
      },
      { db: db as never, thumbnailsDir: thumbs, displaysDir: displays },
    );
```

Then, before the closing `});` of that first test, add:

```ts
    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.fileSize).toBe(12345);
    expect(args.create.fileMtimeMs).toBe(1710408413000.5);
    expect(args.update.fileSize).toBe(12345);
    expect(args.update.fileMtimeMs).toBe(1710408413000.5);
```

Also update the **second** test's `storePhoto(...)` call (the provenance test) to include the new fields so it still typechecks:

```ts
    await storePhoto(
      {
        path: "vacation/img.jpg",
        source: PhotoSource.upload,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "t2"), displaysDir: path.join(dir, "d2") },
    );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: FAIL — TypeScript/assertion error: `fileSize`/`fileMtimeMs` not on `StoreInput`, and `args.create.fileSize` is `undefined`.

- [ ] **Step 3: Implement the store changes**

In `packages/ingest/src/store.ts`, add the two fields to `StoreInput`:

```ts
export interface StoreInput {
  path: string; // path relative to PHOTOS_DIR
  source: PhotoSource;
  processed: ProcessedPhoto;
  fileSize: number; // bytes, from fs.stat
  fileMtimeMs: number; // mtimeMs, from fs.stat
}
```

Destructure them and add them to the shared `data` payload (which feeds both `create` and `update`):

```ts
  const { path: relPath, source, processed, fileSize, fileMtimeMs } = input;

  // ... existing comment ...
  const data = {
    takenAt: processed.takenAt,
    sortDate: processed.takenAt ?? new Date(),
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    exif: processed.exif as object,
    fileSize,
    fileMtimeMs,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "feat(ingest): persist fileSize + fileMtimeMs in storePhoto"
```

---

### Task 5: Stat the file in `ingestPath` and forward the values

**Files:**
- Modify: `packages/ingest/src/ingest.ts`
- Modify: `packages/ingest/src/ingest.test.ts`

- [ ] **Step 1: Extend the failing test**

In `packages/ingest/src/ingest.test.ts`, inside the `ingestPath` test, after `expect((calls[0] as { where: { path: string } }).where).toEqual({ path: "sub/img.jpg" });`, add an assertion that the stat fields were forwarded to the upsert payload:

```ts
    const payload = calls[0] as {
      create: { fileSize: unknown; fileMtimeMs: unknown };
      update: { fileSize: unknown; fileMtimeMs: unknown };
    };
    expect(typeof payload.create.fileSize).toBe("number");
    expect(payload.create.fileSize).toBeGreaterThan(0);
    expect(typeof payload.create.fileMtimeMs).toBe("number");
    expect(payload.update.fileSize).toBe(payload.create.fileSize);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/ingest.test.ts`
Expected: FAIL — `payload.create.fileSize` is `undefined` (ingestPath doesn't yet stat/forward).

- [ ] **Step 3: Implement the stat in `ingestPath`**

In `packages/ingest/src/ingest.ts`, add `stat` to the `node:fs/promises` import:

```ts
import { rm, stat } from "node:fs/promises";
```

Update `ingestPath` to stat the file (before processing, so the recorded mtime matches the bytes we read) and forward the values:

```ts
export async function ingestPath(
  relPath: string,
  deps: IngestDeps,
  source: PhotoSource = PhotoSource.filesystem,
): Promise<{ id: string }> {
  const absPath = path.join(deps.photosDir, relPath);
  const st = await stat(absPath);
  const processed = await processImage(absPath);
  return storePhoto(
    { path: relPath, source, processed, fileSize: st.size, fileMtimeMs: st.mtimeMs },
    { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/ingest.ts packages/ingest/src/ingest.test.ts
git commit -m "feat(ingest): stat files and forward size+mtime through ingestPath"
```

---

### Task 6: Pure `isUnchanged` change-detection helper

Keep the skip decision pure and unit-testable (mirrors the existing `reconcileDeletions` pattern), so `scanAndIngest` stays thin I/O glue.

**Files:**
- Modify: `apps/worker/src/scan.ts` (add the exported helper only — the loop rewrite is Task 7)
- Modify: `apps/worker/src/scan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/src/scan.test.ts`:

```ts
import { isUnchanged } from "./scan.js";

describe("isUnchanged", () => {
  const st = { size: 100, mtimeMs: 5000.5 };

  it("is true when row size+mtime match and the cache exists", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 5000.5 }, st, true)).toBe(true);
  });

  it("is false when the row is unknown (new file)", () => {
    expect(isUnchanged(undefined, st, true)).toBe(false);
  });

  it("is false when size differs", () => {
    expect(isUnchanged({ fileSize: 99, fileMtimeMs: 5000.5 }, st, true)).toBe(false);
  });

  it("is false when mtime differs", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 1 }, st, true)).toBe(false);
  });

  it("is false when the cache is missing (forces regeneration)", () => {
    expect(isUnchanged({ fileSize: 100, fileMtimeMs: 5000.5 }, st, false)).toBe(false);
  });

  it("is false when the row has null stats (un-backfilled legacy row)", () => {
    expect(isUnchanged({ fileSize: null, fileMtimeMs: null }, st, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: FAIL — `isUnchanged is not a function`.

- [ ] **Step 3: Add the helper**

In `apps/worker/src/scan.ts`, add this exported pure function (place it right after `reconcileDeletions`):

```ts
/**
 * Pure decision: is the on-disk file already ingested and unchanged? True only
 * when a row exists, its recorded size+mtime match the current stat, and the
 * rendered cache is present (so a wiped cache forces regeneration).
 */
export function isUnchanged(
  row: { fileSize: number | null; fileMtimeMs: number | null } | undefined,
  st: { size: number; mtimeMs: number },
  cacheExists: boolean,
): boolean {
  return (
    !!row &&
    row.fileSize === st.size &&
    row.fileMtimeMs === st.mtimeMs &&
    cacheExists
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/scan.test.ts
git commit -m "feat(worker): add pure isUnchanged change-detection helper"
```

---

### Task 7: Rewrite `scanAndIngest` — incremental skip + bounded pool

**Files:**
- Modify: `apps/worker/src/scan.ts`

- [ ] **Step 1: Replace the imports**

At the top of `apps/worker/src/scan.ts`, replace the existing import block with:

```ts
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { INGEST_CONCURRENCY, PHOTOS_DIR, displayPath, thumbnailPath } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { runPool } from "./pool.js";
```

- [ ] **Step 2: Add `skippedUnchanged` to the summary type**

Update the `ScanSummary` interface:

```ts
export interface ScanSummary {
  processed: number;
  skipped: number;
  skippedUnchanged: number;
  removed: number;
}
```

- [ ] **Step 3: Add a small cache-existence helper**

Add near the top of the file (after `listImages`):

```ts
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Rewrite `scanAndIngest`**

Replace the entire `scanAndIngest` function body with:

```ts
/** One-shot scan: ingest new/changed images concurrently, skip unchanged, reconcile deletions. */
export async function scanAndIngest(): Promise<ScanSummary> {
  const relPaths = await listImages();
  const summary: ScanSummary = { processed: 0, skipped: 0, skippedUnchanged: 0, removed: 0 };

  const existing = await prisma.photo.findMany({
    select: { id: true, path: true, fileSize: true, fileMtimeMs: true },
  });
  const byPath = new Map(existing.map((p) => [p.path, p]));

  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i];
    try {
      const st = await stat(path.join(PHOTOS_DIR, relPath));
      const row = byPath.get(relPath);
      const cacheExists =
        !!row &&
        (await fileExists(thumbnailPath(row.id))) &&
        (await fileExists(displayPath(row.id)));
      if (isUnchanged(row, st, cacheExists)) {
        summary.skippedUnchanged++;
        return;
      }
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    }
  });

  const onDisk = new Set(relPaths);
  const toDelete = new Set(reconcileDeletions(existing.map((p) => p.path), onDisk));
  const deleteRows = existing.filter((p) => toDelete.has(p.path));
  await runPool(deleteRows.length, INGEST_CONCURRENCY, async (i) => {
    await removePath(deleteRows[i].path, removeDeps);
    summary.removed++;
  });

  return summary;
}
```

(Note: `cacheExists` short-circuits the two `access` calls when there is no `row`, so brand-new files cost a single `stat`. Summary counters are mutated between `await`s, which is safe under Node's single-threaded model.)

- [ ] **Step 5: Update the ingest summary log to show skips**

In `apps/worker/src/main.ts`, update the completion log to include the new counter. Change the `console.log(...)` template to:

```ts
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
```

- [ ] **Step 6: Verify typecheck + the worker test suite**

Run: `pnpm --filter @lumio/worker typecheck && pnpm --filter @lumio/worker test`
Expected: PASS (pool, scan including `reconcileDeletions` + `isUnchanged`).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/main.ts
git commit -m "perf(ingest): incremental scan + bounded concurrency in scanAndIngest"
```

---

### Task 8: Size `UV_THREADPOOL_SIZE` at process start (entry launchers)

Sharp's async work runs on the libuv threadpool, whose size is fixed when the pool is first used. The launchers must set it **before** any module that touches the threadpool (Sharp, fs) is imported — hence the dynamic `import()` after setting the env. Importing `./config.js` first is safe (it only touches `node:path`/`node:url`/`node:os`, none of which init the threadpool).

**Files:**
- Create: `apps/worker/src/ingest-run.ts` (the one-shot logic moved out of `main.ts`)
- Modify: `apps/worker/src/main.ts` (becomes a launcher)
- Modify: `apps/worker/src/watch-main.ts` (becomes a launcher)

- [ ] **Step 1: Move the one-shot logic into `ingest-run.ts`**

Create `apps/worker/src/ingest-run.ts` with the current `main.ts` body wrapped in an exported function (including the Task 7 Step 5 log line):

```ts
import { prisma } from "@lumio/db";
import { scanAndIngest } from "./scan.js";

export async function runIngest(): Promise<void> {
  const start = Date.now();
  const summary = await scanAndIngest();
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
  await prisma.$disconnect();
}
```

- [ ] **Step 2: Turn `main.ts` into a launcher**

Replace the entire contents of `apps/worker/src/main.ts` with:

```ts
import { INGEST_CONCURRENCY } from "./config.js";

// Size the libuv threadpool (where Sharp's decode/encode runs) to our pool
// BEFORE importing anything that touches it — otherwise Sharp plateaus at the
// default of 4 threads regardless of core count. The dynamic import guarantees
// this env is set first.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
}

const { runIngest } = await import("./ingest-run.js");

runIngest().catch(async (err) => {
  console.error(err);
  const { prisma } = await import("@lumio/db");
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 3: Turn `watch-main.ts` into a launcher**

Replace the entire contents of `apps/worker/src/watch-main.ts` with:

```ts
import { INGEST_CONCURRENCY } from "./config.js";

// See main.ts: set the libuv threadpool size before Sharp/fs load.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
}

const { watchAndIngest } = await import("./watch.js");

watchAndIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-test the launcher wires the threadpool**

Run: `pnpm --filter @lumio/worker exec tsx -e "import('./src/config.js').then((c) => { const v = process.env.UV_THREADPOOL_SIZE || String(c.INGEST_CONCURRENCY); console.log('would set UV_THREADPOOL_SIZE=' + v + ', INGEST_CONCURRENCY=' + c.INGEST_CONCURRENCY); })"`
Expected: prints `would set UV_THREADPOOL_SIZE=<N>, INGEST_CONCURRENCY=<N>` where N = your core count (e.g. 12).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/ingest-run.ts apps/worker/src/main.ts apps/worker/src/watch-main.ts
git commit -m "perf(worker): size UV_THREADPOOL_SIZE to INGEST_CONCURRENCY at startup"
```

---

### Task 9: Commit the benchmark as `pnpm bench`

**Files:**
- Create: `apps/worker/src/bench.ts`
- Modify: `apps/worker/package.json` (add `bench` script)
- Modify: `package.json` (root — add `bench` passthrough)

- [ ] **Step 1: Create the benchmark**

`apps/worker/src/bench.ts`:

```ts
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { processImage, SUPPORTED_EXTENSIONS } from "@lumio/ingest";
import { PHOTOS_DIR } from "./config.js";
import { runPool } from "./pool.js";

// Measures the dominant per-image cost (processImage: decode + 2× resize + hash).
// It does NOT write to the DB or disk, so it isolates CPU/decode cost. The full
// ingest pipeline adds a small per-image constant (one Prisma upsert + 2 writes).
//
// Run against your real library; sweep the threadpool to find the real ceiling:
//   pnpm bench
//   UV_THREADPOOL_SIZE=$(nproc) pnpm bench   # Linux
//   UV_THREADPOOL_SIZE=12 pnpm bench         # explicit

async function listImages(): Promise<string[]> {
  const entries = await readdir(PHOTOS_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name));
}

async function timePool(files: string[], limit: number): Promise<number> {
  const t = performance.now();
  await runPool(files.length, limit, async (i) => {
    try {
      await processImage(files[i]);
    } catch {
      /* ignore decode errors for timing */
    }
  });
  return performance.now() - t;
}

async function main(): Promise<void> {
  const all = await listImages();
  if (all.length === 0) {
    console.error(`No images under PHOTOS_DIR=${PHOTOS_DIR}`);
    process.exit(1);
  }
  const cores = os.cpus().length;
  const sample = all.slice(0, Math.min(60, all.length));
  console.log(
    `cores=${cores}  sample=${sample.length}  UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "4 (default)"}\n`,
  );

  await processImage(sample[0]); // warm up lazy libvips init

  const serialMs = await timePool(sample, 1);
  const serialPer = serialMs / sample.length;
  console.log(`serial (limit=1)   ${(serialMs / 1000).toFixed(2)}s  |  ${serialPer.toFixed(1)} ms/img`);

  for (const limit of [4, 8, cores]) {
    const ms = await timePool(sample, limit);
    const per = ms / sample.length;
    console.log(
      `pool (limit=${limit})    ${(ms / 1000).toFixed(2)}s  |  ${per.toFixed(1)} ms/img  |  ${(serialPer / per).toFixed(2)}x`,
    );
  }
  process.exit(0);
}

main();
```

- [ ] **Step 2: Add the worker script**

In `apps/worker/package.json`, add to `"scripts"` (after the `"watch"` line):

```json
    "bench": "dotenv -e ../../.env -- tsx src/bench.ts",
```

- [ ] **Step 3: Add the root passthrough**

In the root `package.json`, add to `"scripts"` (after the `"watch"` line):

```json
    "bench": "pnpm --filter @lumio/worker bench",
```

- [ ] **Step 4: Verify it runs (requires images under PHOTOS_DIR)**

Run: `pnpm bench`
Expected: prints `cores=…`, a `serial` line, and three `pool` lines with `…x` speedups. If `PHOTOS_DIR` is empty it exits with the "No images" error — that is correct behavior, not a failure of the script.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/bench.ts apps/worker/package.json package.json
git commit -m "chore(worker): add pnpm bench to measure ingest throughput"
```

---

### Task 10: Wire the env knob into Docker + document it

**Files:**
- Modify: `infra/docker-compose.prod.yml` (worker service env)
- Modify: `docs/deployment/docker-compose.md`

- [ ] **Step 1: Expose `INGEST_CONCURRENCY` on the worker service**

In `infra/docker-compose.prod.yml`, under `services.worker.environment` (which currently has `DATABASE_URL`, `PHOTOS_DIR`, `CACHE_DIR`), add:

```yaml
      # Max images processed in parallel during a scan. Empty → the worker
      # auto-detects the core count and sizes the libuv threadpool to match.
      # Pin this to the container's CPU allotment if you cap worker CPUs.
      INGEST_CONCURRENCY: ${INGEST_CONCURRENCY:-}
```

(An empty value is falsy in the worker config, so it falls back to `os.cpus().length`; `UV_THREADPOOL_SIZE` is then derived automatically by the entry launcher.)

- [ ] **Step 2: Document the behavior**

In `docs/deployment/docker-compose.md`, add a short section (place it near the existing env/tuning notes) titled `### Ingest performance` with this content:

```markdown
### Ingest performance

The worker scans `PHOTOS_DIR` on startup and whenever files change.

- **Incremental scan:** files already indexed with an unchanged size + mod/time
  (and an intact cache) are skipped, so restarts are near-instant. Only new or
  changed files are (re)processed. Wiping `CACHE_DIR` forces regeneration.
- **Concurrency:** new/changed files are processed by a worker pool sized to
  `INGEST_CONCURRENCY` (default: the worker's logical core count). The worker
  automatically sets `UV_THREADPOOL_SIZE` to the same value — Sharp's decode/
  encode runs on that threadpool, so without it throughput plateaus at ~4
  regardless of cores. Set `INGEST_CONCURRENCY` to pin it (e.g. to a CPU limit).
- **Measure your hardware:** run `pnpm bench` against your library to see the
  real per-image cost and the speedup curve on your machine.
```

- [ ] **Step 3: Validate the compose file parses**

Run: `docker compose -f infra/docker-compose.prod.yml config >/dev/null && echo OK`
Expected: prints `OK` (no YAML/interpolation errors). If `docker` is unavailable in this environment, skip with a note.

- [ ] **Step 4: Commit**

```bash
git add infra/docker-compose.prod.yml docs/deployment/docker-compose.md
git commit -m "docs(deploy): document INGEST_CONCURRENCY + incremental scan"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm -r test`
Expected: PASS across `@lumio/db`, `@lumio/ingest`, `@lumio/worker`, `@lumio/web` (no regressions).

- [ ] **Step 2: Typecheck everything**

Run: `pnpm -r typecheck`
Expected: PASS in every package.

- [ ] **Step 3: End-to-end skip check (manual, needs DB + images)**

With Postgres up and images under `PHOTOS_DIR`:

Run: `pnpm ingest` (first run — processes everything), then `pnpm ingest` again.
Expected: the second run logs `unchanged <N>` equal to the file count, `processed 0`, and completes in seconds. This is the core win — verify it before declaring done.

---

## Notes for the executor

- **Order matters:** Task 3 (migration) must land before Tasks 4–7, which reference the new Prisma fields. Task 1 (pool) before Task 7. Task 7's log line and Task 8's `ingest-run.ts` must carry the same `unchanged …` wording.
- **DB required** for Tasks 3 and 11 Step 3: `pnpm db:up` first.
- **`processImage` decode of `.jxl`/`.heic`** shells out to `djxl`/`heif-convert`; on macOS dev it uses built-in `sips`. The bench/tests here use plain JPEGs so this is not a factor.
