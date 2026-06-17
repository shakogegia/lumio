# Grid Virtualization + Cursor Hardening + Watcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Virtualize the photo grid (TanStack Virtual), harden cursor pagination against NULL `takenAt` via a non-null `sortDate`, and add a chokidar `watch` mode to the worker.

**Architecture:** Three units — (A) cursor hardening across db/worker/web, (B) worker refactor + chokidar watcher, (C) virtualized grid. Reuses the trigger-agnostic pipeline; no API contract changes.

**Tech Stack:** Prisma/Postgres, Next.js 16 (App Router), `@tanstack/react-virtual`, `chokidar`, vitest.

---

## UNIT A — Cursor hardening (`sortDate`)

### Task A1: Add `sortDate` to the Prisma schema + migration

**Files:** `packages/db/prisma/schema.prisma`, new migration.

- [ ] In `model Photo`, add `sortDate DateTime @default(now())` and replace `@@index([takenAt, id])` with `@@index([sortDate, id])`. Keep `takenAt DateTime?`.
- [ ] Create+apply migration (DB on 5433 via dotenv): `cd packages/db && pnpm dotenv -e ../../.env -- prisma migrate dev --name add_sort_date && cd ../..`
- [ ] Verify: `docker compose --env-file .env -f infra/docker-compose.yml exec -T db psql -U lumio -d lumio -c "\d \"Photo\"" | grep sortDate`
- [ ] Commit: `git add packages/db/prisma && git commit -m "feat(db): add non-null sortDate column + index"`

### Task A2: `storePhoto` sets `sortDate`

**Files:** `apps/worker/src/pipeline/store.ts`

- [ ] In the `data` object, add `sortDate: processed.takenAt ?? new Date(),` (so create+update both set it).
- [ ] `pnpm --filter @lumio/worker test` (5 still pass) and `pnpm --filter @lumio/worker typecheck`.
- [ ] Commit: `git add apps/worker/src/pipeline/store.ts && git commit -m "feat(worker): persist sortDate (takenAt ?? now)"`

### Task A3: `listPhotos` orders by `sortDate` (TDD)

**Files:** `apps/web/src/lib/photos-service.ts`, `apps/web/src/lib/photos-service.test.ts`

- [ ] Update the test's `fakeDb` to capture the `findMany` args, and assert `orderBy` is `[{ sortDate: "desc" }, { id: "desc" }]`. Keep the two `nextCursor` assertions.

```ts
function fakeDb(rows: ReturnType<typeof row>[]) {
  const calls: any[] = [];
  return {
    calls,
    photo: { findMany: async (args: any) => { calls.push(args); return rows.slice(0, args.take); } },
  };
}
// in a test:
const db = fakeDb([row("a"), row("b")]);
const page = await listPhotos({ limit: 2 }, db as never);
expect(db.calls[0].orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
```

- [ ] Run test → fails (still `takenAt`). Update `listPhotos` `orderBy` to `[{ sortDate: "desc" }, { id: "desc" }]`. Run → passes.
- [ ] Commit: `git add apps/web/src/lib && git commit -m "feat(web): order photos by sortDate for stable pagination"`

### Task A4: Backfill existing rows

- [ ] `pnpm db:up && pnpm ingest` → re-upserts the 12 rows, setting `sortDate`. Verify: `... psql ... -c "SELECT count(*) FROM \"Photo\" WHERE \"sortDate\" IS NOT NULL;"` → 12. (No commit; data only.)

---

## UNIT B — Worker refactor + chokidar watcher

### Task B1: Extract `ingestPath` / `removePath` (TDD)

**Files:** `apps/worker/src/ingest.ts`, `apps/worker/src/ingest.test.ts`, and refactor `apps/worker/src/scan.ts`.

- [ ] Create `ingest.ts` with deps-injectable functions:

```ts
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { PHOTOS_DIR, THUMBNAILS_DIR } from "./config.js";
import { processImage } from "./pipeline/process.js";
import { storePhoto, type StoreDeps } from "./pipeline/store.js";

export interface IngestDeps extends StoreDeps { photosDir: string; }

export async function ingestPath(
  relPath: string,
  deps: IngestDeps = { db: prisma, thumbnailsDir: THUMBNAILS_DIR, photosDir: PHOTOS_DIR },
): Promise<void> {
  const processed = await processImage(path.join(deps.photosDir, relPath));
  await storePhoto({ path: relPath, source: PhotoSource.filesystem, processed }, deps);
}

export async function removePath(
  relPath: string,
  deps: { db: Pick<import("@lumio/db").PrismaClient, "photo">; thumbnailsDir: string } =
    { db: prisma, thumbnailsDir: THUMBNAILS_DIR },
): Promise<void> {
  const found = await deps.db.photo.findUnique({ where: { path: relPath }, select: { id: true } });
  if (!found) return;
  await deps.db.photo.delete({ where: { id: found.id } });
  await rm(path.join(deps.thumbnailsDir, `${found.id}.webp`), { force: true });
}
```

- [ ] `ingest.test.ts`: test `ingestPath` with a generated temp image (sharp, `IFD2` EXIF like the existing tests), a fake db capturing `upsert`, and temp `photosDir`/`thumbnailsDir`; assert upsert called once and thumbnail written. Test `removePath` with a fake db (`findUnique`→`{id}`, record `delete`) + a temp thumbnail file; assert row deleted and file gone; and the not-found case is a no-op.
- [ ] Refactor `scan.ts`: `scanAndIngest` loop calls `ingestPath(relPath)`; deletion loop calls `removePath(p.path)`. Keep `reconcileDeletions` and its 2 tests. Remove now-dead imports.
- [ ] `pnpm --filter @lumio/worker test` (process 2 + store 1 + scan 2 + ingest tests) and `typecheck` clean.
- [ ] Commit: `git add apps/worker/src && git commit -m "refactor(worker): extract ingestPath/removePath; reuse in scan"`

### Task B2: chokidar watcher + entry + scripts

**Files:** `apps/worker/src/watch.ts`, `apps/worker/src/watch-main.ts`, `apps/worker/package.json`, root `package.json`.

- [ ] `pnpm --filter @lumio/worker add chokidar` (handle any ignored-builds, e.g. `fsevents`, via root `pnpm-workspace.yaml` `onlyBuiltDependencies`+`allowBuilds`).
- [ ] Create `watch.ts`:

```ts
import path from "node:path";
import chokidar from "chokidar";
import { prisma } from "@lumio/db";
import { PHOTOS_DIR, SUPPORTED_EXTENSIONS } from "./config.js";
import { ingestPath, removePath } from "./ingest.js";
import { scanAndIngest } from "./scan.js";

const isSupported = (p: string) => SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

export async function watchAndIngest(): Promise<void> {
  const initial = await scanAndIngest();
  console.log(`Initial scan — processed ${initial.processed}, removed ${initial.removed}`);

  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const upsert = async (abs: string) => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    try { await ingestPath(rel); console.log(`+ ${rel}`); }
    catch (err) { console.warn(`skip ${rel}: ${(err as Error).message}`); }
  };

  watcher
    .on("add", upsert)
    .on("change", upsert)
    .on("unlink", async (abs) => {
      if (!isSupported(abs)) return;
      const rel = path.relative(PHOTOS_DIR, abs);
      try { await removePath(rel); console.log(`- ${rel}`); }
      catch (err) { console.warn(`remove failed ${rel}: ${(err as Error).message}`); }
    })
    .on("error", (err) => console.error(`watcher error: ${err}`));

  console.log(`Watching ${PHOTOS_DIR} … (Ctrl-C to stop)`);

  const shutdown = async () => { await watcher.close(); await prisma.$disconnect(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

- [ ] Create `watch-main.ts`:

```ts
import { watchAndIngest } from "./watch.js";
watchAndIngest().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] Add scripts: `@lumio/worker` → `"watch": "dotenv -e ../../.env -- tsx src/watch-main.ts"`; root → `"watch": "pnpm --filter @lumio/worker watch"`.
- [ ] `typecheck` clean. Manual verify: `pnpm watch` in one shell; in another `cp photos/sample-01.jpg photos/zzz-live.jpg` → log `+ zzz-live.jpg`; `rm photos/zzz-live.jpg` → log `- zzz-live.jpg`; psql count returns to 12; stop watcher; `git checkout -- photos` / ensure no stray committed test files.
- [ ] Commit: `git add apps/worker package.json pnpm-workspace.yaml pnpm-lock.yaml && git commit -m "feat(worker): add chokidar watch mode"`

---

## UNIT C — Virtualized grid

### Task C1: Grid layout helper (TDD)

**Files:** `apps/web/src/lib/grid-layout.ts`, `apps/web/src/lib/grid-layout.test.ts`

- [ ] Test then implement:

```ts
export const MIN_TILE = 200;
export const GRID_GAP = 12;

export function computeColumns(width: number, minTile: number = MIN_TILE, gap: number = GRID_GAP): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

export function rowCount(itemCount: number, columns: number): number {
  if (columns <= 0 || itemCount <= 0) return 0;
  return Math.ceil(itemCount / columns);
}
```

- [ ] Tests: `computeColumns(0)===1`; `computeColumns(1000)` ≥ 4 with defaults; `rowCount(10, 4)===3`; `rowCount(0, 4)===0`.
- [ ] `pnpm --filter @lumio/web test` passes; commit `feat(web): add grid layout math helper`.

### Task C2: Virtualized grid component

**Files:** `apps/web/src/app/photos/photo-grid.tsx`; add dep `@tanstack/react-virtual`.

- [ ] `pnpm --filter @lumio/web add @tanstack/react-virtual`.
- [ ] Rewrite `photo-grid.tsx` using `useWindowVirtualizer` over `rowCount(photos.length, columns)`, measuring container width with `ResizeObserver`, rendering each virtual row as an absolutely-positioned CSS grid of `columns` tiles, lazy `<img>` thumbnails (square), `loadingRef` guard, retry-on-error, and triggering `loadMore()` when the last virtual row index ≥ `rows − OVERSCAN_ROWS`. (Reference implementation in the design doc / Unit C prompt.)
- [ ] Verify: `pnpm --filter @lumio/web build` clean; start dev (`CONDUCTOR_PORT=4400 bash scripts/conductor/run.sh`), load `/photos`, confirm thumbnails render and scroll; in DevTools confirm only ~visible rows exist in the DOM; kill server.
- [ ] Commit: `git add apps/web && git commit -m "feat(web): virtualize photo grid with TanStack Virtual"`

---

## Final verification
- [ ] `pnpm -r test` green; `pnpm --filter @lumio/web build` clean.
- [ ] Manual: large-grid scroll renders only visible rows; `pnpm watch` live add/remove works; `/photos` still paginates correctly ordered by `sortDate`.

## Self-review notes
- `sortDate` is non-null (default now()), so `[sortDate desc, id desc]` is a total order — id-cursor pagination is correct without a cursor-format change.
- `ingestPath`/`removePath` are the single ingestion entry points shared by scan + watcher (DRY); both deps-injectable for tests.
- No API/DTO changes; grid stays uniform-square; watcher is manual (Conductor `run` unchanged).
