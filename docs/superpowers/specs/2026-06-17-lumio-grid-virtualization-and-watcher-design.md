# Lumio — Virtualized Grid + Cursor Hardening + chokidar Watcher Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Builds on:** 2026-06-17-lumio-walking-skeleton-design.md (follow-ups #1 and #2)

## Goal

Take the walking skeleton two steps toward the stated goals:
1. **Scale the grid** to 10k–100k+ photos by rendering only visible DOM nodes (TanStack Virtual), and harden cursor pagination so it stays correct when `takenAt` is NULL.
2. **Live ingestion** — a long-running worker `watch` mode (chokidar) so files added/changed/removed under `/photos` are picked up automatically, reusing the existing trigger-agnostic pipeline.

## Decisions locked during brainstorming

1. **Grid layout:** uniform square tiles (justified/Google-Photos layout deferred).
2. **Watcher delivery:** additive `watch` command; one-shot `ingest` and `POST /api/rescan` stay as-is.
3. **Conductor integration:** `run` stays web-only; the watcher is started manually (shared-DB model unchanged). Per-workspace-DB isolation remains a separate future follow-up.
4. **Live UI updates:** none — newly watched photos appear on next load/refresh (SSE/polling deferred).

## Part 1 — Virtualized photo grid

- Add `@tanstack/react-virtual` to `apps/web`.
- Rewrite `apps/web/src/app/photos/photo-grid.tsx`:
  - **Window-scroll row virtualizer** (`useWindowVirtualizer`) so the page scrolls normally.
  - A `ResizeObserver` on the grid container measures width; `columns = max(1, floor(width / MIN_TILE))` with `MIN_TILE ≈ 200` and a fixed gap. Row height = tile size + gap. `rowCount = ceil(loaded.length / columns)`.
  - Each virtual row is absolutely positioned at its `start` offset and renders its `columns` tiles. Only visible rows (+ overscan) produce DOM nodes.
  - **Infinite scroll via the virtualizer:** when the largest rendered virtual-row index ≥ `rowCount − OVERSCAN_ROWS`, call `loadMore()` (existing cursor fetch + `loadingRef` reentrancy guard).
  - Thumbnails remain lazy `<img src="/api/thumbnails/:id">`, square `object-cover`; stored `width`/`height` keep layout stable.
- Pure layout math (`computeColumns(width, minTile, gap)` / row count) lives in a small tested helper so it can be unit-tested without a DOM.

## Part 2 — Cursor hardening (NULL-`takenAt` safe)

- Add a non-null **`sortDate DateTime`** column to `Photo`:
  - Prisma: `sortDate DateTime @default(now())` (the default makes the migration clean on the 12 existing rows) and `@@index([sortDate, id])`. The old `@@index([takenAt, id])` may be dropped (superseded).
  - `storePhoto` sets `sortDate = processed.takenAt ?? new Date()` on both create and update, so it always reflects `takenAt` when present, else ingest time.
- `listPhotos` orders by `[ { sortDate: "desc" }, { id: "desc" } ]`. Because `sortDate` is non-null and `id` is a unique tiebreaker, the order is total; Prisma's native `cursor: { id }` + `skip: 1` paginates correctly with **no cursor-format change** and no NULL-boundary ambiguity.
- `PhotoDTO` is unchanged (still exposes `takenAt`, nullable). `sortDate` is an internal ordering key, not surfaced.
- Re-running `pnpm ingest` backfills `sortDate` for existing rows via the upsert update path.

## Part 3 — chokidar watcher (additive)

- Add `chokidar` to `apps/worker`.
- **Refactor (DRY) first:** extract the per-file work from `scan.ts` into reusable functions used by both the scan loop and the watcher:
  - `ingestPath(relPath)` — `processImage(join(PHOTOS_DIR, relPath))` → `storePhoto({ path: relPath, source: filesystem, processed }, { db: prisma, thumbnailsDir })`.
  - `removePath(relPath)` — delete the `Photo` row by `path` and remove its thumbnail file.
  - `scanAndIngest` and the deletion-reconcile loop call these.
- New `apps/worker/src/watch.ts` → `watchAndIngest()`:
  - Initial `scanAndIngest()` on boot.
  - `chokidar.watch(PHOTOS_DIR, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 } })`.
  - `add` / `change`: if extension is in `SUPPORTED_EXTENSIONS`, debounce per path (~300ms) then `ingestPath`; log + count.
  - `unlink`: if supported ext, `removePath`; log + count.
  - Errors per event are caught and logged (one bad file never kills the watcher).
  - Graceful shutdown on `SIGINT`/`SIGTERM`: close the watcher and `prisma.$disconnect()`.
- New entry `apps/worker/src/watch-main.ts`; scripts: `@lumio/worker` `watch = "dotenv -e ../../.env -- tsx src/watch-main.ts"`, and a root `watch = "pnpm --filter @lumio/worker watch"`.

## Error handling

- Grid: a failed page fetch surfaces a retry affordance; the `loadingRef` guard prevents duplicate concurrent fetches.
- Watcher: per-event try/catch → log + continue; `awaitWriteFinish` avoids partial-file reads.
- Cursor: unchanged API surface; invalid cursor still 400 (Zod).

## Testing

- **web:** unit-test `computeColumns`/row-count math; unit-test `listPhotos` ordering uses `[sortDate desc, id desc]` (fake db asserts the `orderBy` and `nextCursor` logic).
- **db:** existing mapper tests stay green; add nothing unless the mapper changes (it does not — `sortDate` isn't in the DTO).
- **worker:** unit-test `ingestPath` (calls pipeline + writes thumbnail, via fake db + temp dir) and `removePath` (deletes row + thumbnail). chokidar wiring verified manually.
- **Full gate:** `pnpm -r test` green; `pnpm --filter @lumio/web build` clean; manual: scroll a large grid (only visible rows in DOM via devtools), `cp`/`rm` a file under `/photos` with `pnpm watch` running and confirm the row appears/disappears.

## Migration / rollout

- One Prisma migration adds `sortDate` (+ index). After migrating, run `pnpm ingest` once to backfill `sortDate` on existing rows.

## Non-goals

- No justified/masonry layout, no live UI push (SSE/poll), no Conductor `run` change, no per-workspace DB, no new EXIF fields.
