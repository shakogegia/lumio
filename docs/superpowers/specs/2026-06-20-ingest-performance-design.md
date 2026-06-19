# Ingest Performance: Incremental Scan + Bounded Concurrency

**Date:** 2026-06-20
**Status:** Proposed — awaiting review
**Target deploy:** Intel N100 mini-PC (4 cores, low power); must stay portable to larger servers.

## Problem

The ingest pipeline processes images one at a time and **re-processes every file on every
scan**. Two distinct issues, both surfaced by benchmarking against the real ~8 MB-median JPG
library on an M4 Pro:

1. **Serial loop.** `scanAndIngest` (`apps/worker/src/scan.ts`) awaits `ingestPath` per file in
   a plain `for` loop. Measured `processImage` cost: **391 ms/img serial**. For 20k images that
   is **~2 h 10 min** on the M4 Pro, and an estimated **~5–6 h** on the N100.

2. **No change detection.** `ingestPath` → `processImage` + `storePhoto` *always* re-decodes,
   re-resizes, re-hashes, and rewrites both WebP renditions. There is no "file unchanged" check
   (the `Photo` model carries no size/mtime). Because `watch.ts` calls `scanAndIngest()` on every
   startup, the full multi-hour reprocess is paid **on every worker restart/redeploy**, not just
   the first import.

### The non-obvious finding (drives the concurrency design)

Adding a JS-level worker pool **alone does nothing past 4 concurrent tasks**. Sharp's
decode/encode runs on Node's libuv threadpool, which defaults to `UV_THREADPOOL_SIZE=4`.

Measured on M4 Pro (12 cores), 60 real images, `processImage` only:

| Setup | ms/img | Speedup | 20k projection (M4 Pro) |
|---|---|---|---|
| serial (pool=1) | 391 | 1.0× | ~2 h 10 min |
| pool=4/8/12, `UV_THREADPOOL_SIZE`=4 (default) | ~100 | 3.9× (flat) | ~33 min |
| pool=8, `UV_THREADPOOL_SIZE`=12 | 57 | 6.9× | **~19 min** |
| pool=12, `UV_THREADPOOL_SIZE`=12 | 57 | 6.9× | ~19 min |

Conclusion: concurrency **must** raise both the JS pool and `UV_THREADPOOL_SIZE` together,
sized to core count. On the 4-core N100 the default `4` is already correct; on a bigger box it
must be raised or most of the win is left on the table.

## Goals

- Restarts cost **seconds**, not hours, when nothing on disk changed (incremental scan).
- One-time cold import (and genuinely-new batches) run at the hardware's real ceiling
  (~4× on the N100's 4 cores, ~7× on a 12-core box) via a pool sized to cores + matching
  threadpool.
- Auto-tune to the host: zero per-machine config, one overridable env knob for tuning.
- A committed benchmark so the operator can measure their actual hardware (replace the N100
  estimate with a real number).
- No regression to correctness: changed files still re-ingest; deletions still reconcile.

## Non-Goals

- Rewriting the Docker images (they already exist and are sound — Debian `node:24-slim` with the
  JXL/HEIC decoders installed). We only wire in the new env knobs.
- Parallelizing the chokidar steady-state watch path (events trickle in; the burst case is the
  initial scan, which this covers).
- Changing thumbnail/display dimensions or formats.

## Design

Four components, in priority order.

### 1. Incremental scan (the biggest real-world win)

**Schema** — add two nullable columns to `Photo` (`packages/db/prisma/schema.prisma`):

```prisma
fileSize    Int?    // bytes, from fs.stat — nullable so existing rows migrate cleanly
fileMtimeMs Float?  // mtimeMs from fs.stat (fractional ms)
```

A Prisma migration adds them. Existing rows have `null` → treated as "changed" → reprocessed
once on the first scan after deploy, which backfills the columns. Acceptable one-time cost.

**Skip decision** — in `scanAndIngest`:

1. Fetch existing photos once up front:
   `prisma.photo.findMany({ select: { id, path, fileSize, fileMtimeMs } })` → `Map<path, row>`.
   (Replaces the late `findMany` that today only feeds deletion reconciliation; reused for both.)
2. For each on-disk file: `fs.stat` it (microseconds). Skip iff **path is known AND
   `fileSize` matches AND `fileMtimeMs` matches AND both cache files exist**
   (`thumbnailPath(id)` and `displayPath(id)` via `node:fs access`). The cache-existence check
   makes a wiped/partial cache self-heal (cache is documented as regenerable).
3. Otherwise (new or changed) → `ingestPath`.

Size+mtime is the rsync-standard change signal — reliable and cheap; hashing would require
reading the full 8 MB and defeats the purpose.

**Persisting the stat** — `ingestPath` (`packages/ingest/src/ingest.ts`) stats the file it is
about to process and threads `fileSize`/`fileMtimeMs` through `StoreInput` so `storePhoto`
writes them in the upsert `create`/`update` payload. This single internal stat covers the watch
path (`add`/`change`) too, so the columns stay current there for free. The skip-path in
`scanAndIngest` has already stat'd, so the common (unchanged) case is **one stat, no double
work** — only the rare changed/new file incurs the second stat inside `ingestPath`.

New scan summary counter: `skippedUnchanged` (distinct from `skipped` = errored), so the log
shows what incremental scan saved.

### 2. Bounded concurrency + threadpool sizing (the cold-start win)

**Pool** — extract the existing `runPool(total, limit, task)` from `seed.ts:139` into
`apps/worker/src/pool.ts` (generic, no built-in logging) and use it in both `seed.ts` and the
new `scanAndIngest` loop. The per-file `try/catch` and summary counters stay; counter mutations
are safe (single-threaded JS, atomic between awaits). Deletion reconciliation also moves to
`runPool` (cheap, but the big-reorg case benefits).

**Concurrency value** — `INGEST_CONCURRENCY` env in `apps/worker/src/config.ts`, defaulting to
`os.cpus().length`. N100 → 4, big server → many. No per-box config needed.

**Threadpool** — `UV_THREADPOOL_SIZE` must be set **before** the libuv threadpool is first used,
so it can't be set after imports run. Pattern: the entry files (`main.ts`, `watch-main.ts`)
become thin launchers that, if `UV_THREADPOOL_SIZE` is unset, set
`process.env.UV_THREADPOOL_SIZE = String(concurrency)` and then `await import()` the real logic.
The dynamic import guarantees the env is set before any module touches the threadpool. In Docker,
it can alternatively/additionally be set as a plain compose env.

**Sharp** — leave `sharp.concurrency()` at its default (the 6.9× measurement used the default).
The bench script (component 4) lets the operator test `sharp.concurrency(1)` as a tuning
experiment, but it is **not** changed by default to avoid regressing the measured result.

### 3. Docker wiring (small — images already exist)

In `infra/docker-compose.prod.yml`, the `worker` service gains an optional, overridable knob:

```yaml
INGEST_CONCURRENCY: ${INGEST_CONCURRENCY:-}   # empty → app auto-detects os.cpus().length
```

`UV_THREADPOOL_SIZE` is handled by the entry launcher (component 2), so no hardcoding in compose
is required; it derives from `INGEST_CONCURRENCY`/cores automatically. Document both knobs and the
new incremental-scan behavior in `docs/deployment/docker-compose.md`. No Dockerfile change needed.

### 4. Benchmark script

Commit the throwaway bench as `apps/worker/src/bench.ts` with a root `pnpm bench` script
(`pnpm --filter @lumio/worker bench`). It lists images under `PHOTOS_DIR`, warms up, then times
`processImage` (no DB/FS-write dependency) serial vs pooled at limits {4, 8, cores}, printing
ms/img and speedup. Lets the operator run it on the actual N100 and replace the estimate with a
measured number. Honest about what it measures (the dominant `processImage` cost; the full
pipeline adds a small DB-upsert + 2-write constant per image).

## Data Flow (one-shot scan, after changes)

```
listImages()                      → relPaths[]
findMany({id,path,size,mtime})    → byPath Map
runPool(relPaths, INGEST_CONCURRENCY, async relPath => {
    stat(file)
    if (known && size==row.fileSize && mtime==row.fileMtimeMs && cacheFilesExist) {
        summary.skippedUnchanged++; return            // the common restart case
    }
    try { ingestPath(relPath) ; summary.processed++ } // stats again, processes, upserts size/mtime
    catch { summary.skipped++ }
})
reconcileDeletions(byPath, onDisk) → runPool(toDelete, …, removePath)
```

## Error Handling

- Per-file failures stay isolated (`try/catch` → `skipped++`), unchanged behavior.
- `fs.stat` failure on a listed file (race: deleted mid-scan) → treat as skip-error, log, continue.
- Concurrency does not change error semantics; a thrown task rejects only its own pool iteration.

## Testing

- **Unit (`@lumio/ingest`):** `storePhoto` persists `fileSize`/`fileMtimeMs`; `ingestPath` stats
  and forwards them. Extend existing `store.test.ts` / `ingest.test.ts`.
- **Unit (`@lumio/worker`):** new `pool.test.ts` for `runPool` (respects limit, runs all, surfaces
  task results/order-independence). `scan.test.ts`: skip logic — unchanged file skipped, changed
  size/mtime re-ingested, missing cache file forces re-ingest, unknown path ingested.
- **Existing tests** for reconciliation/deletion must still pass.
- Manual: `pnpm bench` on dev hardware sanity-checks the speedup before/after.

## Rollout / Migration

1. Ship migration (additive, nullable columns — safe, no backfill needed).
2. First scan after deploy reprocesses everything once (null mtime), backfilling the columns.
3. Subsequent restarts hit the fast path. Operator can run `pnpm bench` on the N100 to confirm
   tuning, optionally set `INGEST_CONCURRENCY`.

## Open Tuning Knobs (documented, not blocking)

- `INGEST_CONCURRENCY` (default `os.cpus().length`).
- `sharp.concurrency(1)` experiment via bench, if oversubscription hurts on a given box.
- `UV_THREADPOOL_SIZE` auto-derived; can be pinned via env for unusual setups.

## Expected Outcome

| | Today | After |
|---|---|---|
| N100, 20k, **first** import | ~5–6 h | ~1.5–2 h |
| N100, 20k, **restart** (no changes) | ~5–6 h | **seconds** |
| M4 Pro, 20k, first import | ~2 h 10 min | ~19 min |
| M4 Pro, 20k, restart | ~2 h 10 min | **seconds** |
