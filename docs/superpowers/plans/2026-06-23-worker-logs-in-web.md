# Worker Logs in the Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the ingestion worker's leveled log lines to Postgres and surface them in a filterable, live-updating Logs page in the settings shell.

**Architecture:** The worker writes log entries to a new `WorkerLog` Postgres table via a batched "tee" logger (prints to console *and* buffers + flushes via `createMany`), with an automatic ring-buffer trim. The web app reads them through a global `GET /api/logs` route and renders them in a `/settings/logs` page using a shadcn ScrollArea, polling for new entries on the existing adaptive cadence. This mirrors the established `WorkerStatus`/`Job` worker↔web pattern (Postgres is the only chokepoint).

**Tech Stack:** Prisma + Postgres, `@lumio/jobs` (worker-side DB helpers), `@lumio/shared` (Zod wire types), Next.js App Router (route + RSC page + client hook), Tailwind + shadcn, Vitest.

Spec: `docs/superpowers/specs/2026-06-23-worker-logs-in-web-design.md`

---

## File structure

**Create:**
- `packages/shared/src/logs.ts` — `LogLevel` enum, `WorkerLogEntry`, `LogsResponse`, `logsQuerySchema`, constants.
- `packages/shared/src/logs.test.ts` — query-schema tests.
- `packages/jobs/src/log.ts` — `createWorkerLogger`, `trimWorkerLogs`, `getWorkerLogs`, constants.
- `packages/jobs/src/log.test.ts` — logger/trim/read tests.
- `apps/worker/src/log.ts` — process-wide `log` singleton + `initWorkerLog`.
- `apps/web/src/app/api/logs/route.ts` — global `GET /api/logs`.
- `apps/web/src/lib/hooks/use-logs.ts` — fetch/merge/poll/load-more hook.
- `apps/web/src/app/(app)/settings/logs/page.tsx` — settings page shell.
- `apps/web/src/app/(app)/settings/logs/logs-view.tsx` — filters + ScrollArea list.
- `apps/web/src/components/ui/scroll-area.tsx` — added via shadcn CLI.

**Modify:**
- `packages/db/prisma/schema.prisma` — add `WorkerLog` model.
- `packages/db/src/index.ts` — export the `WorkerLog` type.
- `packages/shared/src/index.ts` — re-export `./logs.js`.
- `packages/jobs/src/index.ts` — re-export `./log.js`.
- `apps/worker/src/scan.ts`, `watch.ts`, `handlers.ts`, `start.ts`, `ingest-run.ts` — route `console.*` through `log`, add scope/catalogId/jobId, job lifecycle logging, init/close wiring.
- `apps/web/src/components/settings-sidebar.tsx` — add the Logs nav item.

---

## Task 1: `WorkerLog` model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after the `WorkerStatus` model, ~line 260)
- Modify: `packages/db/src/index.ts:11` (type export list)

- [ ] **Step 1: Add the model**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model WorkerLog {
  id        String   @id @default(cuid())
  level     String // "error" | "warn" | "info" | "debug"
  scope     String? // "scan" | "watch" | "consumer" | "heartbeat" | "startup"
  message   String
  catalogId String?
  jobId     String?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([level, createdAt])
}
```

- [ ] **Step 2: Run the migration**

This only *adds* a table, so it is safe on the shared dev DB — do NOT reset or backfill.

Run: `pnpm --filter @lumio/db migrate --name add_worker_log`
Expected: Prisma applies `..._add_worker_log` and regenerates the client (no "drift"/reset prompts; if Prisma reports unrelated drift from another branch's unmerged migration, do not accept a reset — stop and report).

- [ ] **Step 3: Export the type**

In `packages/db/src/index.ts`, add `WorkerLog` to the existing type export (line 11):

```ts
export type { Photo, Album, AlbumPhoto, Folder, TrashedPhoto, Job, WorkerStatus, WorkerLog, Catalog, UserSettings, PrismaClient } from "@prisma/client";
```

- [ ] **Step 4: Verify the client has the model**

Run: `pnpm --filter @lumio/db typecheck`
Expected: PASS (the regenerated client now includes `prisma.workerLog`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma packages/db/src/index.ts
git commit -m "feat(db): add WorkerLog model for persisted worker logs"
```

---

## Task 2: Shared wire types + query schema

**Files:**
- Create: `packages/shared/src/logs.ts`
- Create: `packages/shared/src/logs.test.ts`
- Modify: `packages/shared/src/index.ts` (add a re-export line)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/logs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LogLevel, LOGS_PAGE_SIZE, logsQuerySchema } from "./logs.js";

describe("logsQuerySchema", () => {
  it("parses comma-separated levels, before, since, and limit", () => {
    const r = logsQuerySchema.parse({
      level: "error,warn",
      before: "2026-06-23T12:00:00.000Z",
      since: "2026-06-23T00:00:00.000Z",
      limit: "100",
    });
    expect(r.level).toEqual([LogLevel.Error, LogLevel.Warn]);
    expect(r.before).toBe("2026-06-23T12:00:00.000Z");
    expect(r.since).toBe("2026-06-23T00:00:00.000Z");
    expect(r.limit).toBe(100);
  });

  it("defaults level to [] and limit to the page size, dropping unknown levels", () => {
    const r = logsQuerySchema.parse({ level: "error,bogus" });
    expect(r.level).toEqual([LogLevel.Error]);
    expect(r.before).toBeUndefined();
    expect(r.limit).toBe(LOGS_PAGE_SIZE);
  });

  it("clamps a too-large limit by rejecting it", () => {
    expect(() => logsQuerySchema.parse({ limit: "99999" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/shared test -- logs`
Expected: FAIL — cannot find module `./logs.js`.

- [ ] **Step 3: Implement `logs.ts`**

Create `packages/shared/src/logs.ts`:

```ts
import { z } from "zod";

/** Worker log severity. Mirrors the WorkerLog.level column. */
export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
}

/** All levels, newest-severity-first, for UI iteration. */
export const LOG_LEVELS = [LogLevel.Error, LogLevel.Warn, LogLevel.Info, LogLevel.Debug] as const;

/** Serialized worker log entry for the web (createdAt as ISO string). */
export interface WorkerLogEntry {
  id: string;
  level: LogLevel;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: string;
}

/** Response shape for GET /api/logs. `nextBefore` is the cursor for the next older page. */
export interface LogsResponse {
  entries: WorkerLogEntry[];
  nextBefore: string | null;
}

/** Default page size and hard ceiling for GET /api/logs. */
export const LOGS_PAGE_SIZE = 200;
export const LOGS_MAX_LIMIT = 500;

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Parse + validate the GET /api/logs query string. */
export const logsQuerySchema = z.object({
  // Comma-separated list; unknown tokens are dropped rather than rejected.
  level: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(isLogLevel) : [])),
  before: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(LOGS_MAX_LIMIT).default(LOGS_PAGE_SIZE),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, add after the `./jobs.js` line:

```ts
export * from "./logs.js";
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/shared test -- logs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/logs.ts packages/shared/src/logs.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): worker-log wire types + logs query schema"
```

---

## Task 3: Worker logger engine (`@lumio/jobs`)

**Files:**
- Create: `packages/jobs/src/log.ts`
- Create: `packages/jobs/src/log.test.ts`
- Modify: `packages/jobs/src/index.ts` (add a re-export line)

- [ ] **Step 1: Write the failing tests**

Create `packages/jobs/src/log.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { LogLevel } from "@lumio/shared";
import { createWorkerLogger, getWorkerLogs, trimWorkerLogs } from "./log.js";

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeDb() {
  return {
    workerLog: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("createWorkerLogger", () => {
  it("buffers entries and writes nothing until the flush threshold", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 3, console: silent, now: () => 1000 });
    logger.info("a");
    logger.warn("b");
    expect(db.workerLog.createMany).not.toHaveBeenCalled();
    logger.error("c"); // 3rd entry hits threshold → auto-flush
    await logger.flush();
    expect(db.workerLog.createMany).toHaveBeenCalledTimes(1);
    expect(db.workerLog.createMany.mock.calls[0][0].data).toHaveLength(3);
    await logger.close();
  });

  it("flush() persists buffered rows with meta + the buffered timestamp", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 100, console: silent, now: () => 5000 });
    logger.warn("skip x", { scope: "scan", catalogId: "c1" });
    await logger.flush();
    expect(db.workerLog.createMany).toHaveBeenCalledWith({
      data: [
        { level: LogLevel.Warn, scope: "scan", message: "skip x", catalogId: "c1", jobId: null, createdAt: new Date(5000) },
      ],
    });
    await logger.close();
  });

  it("close() performs a final flush of pending rows", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 100, console: silent, now: () => 1 });
    logger.info("pending");
    await logger.close();
    expect(db.workerLog.createMany).toHaveBeenCalledTimes(1);
  });

  it("tees each level to the matching console method", async () => {
    const out = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { console: out, now: () => 1 });
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");
    expect(out.log).toHaveBeenCalledWith("i");
    expect(out.warn).toHaveBeenCalledWith("w");
    expect(out.error).toHaveBeenCalledWith("e");
    expect(out.debug).toHaveBeenCalledWith("d");
    await logger.close();
  });
});

describe("trimWorkerLogs", () => {
  it("deletes rows older than maxAgeMs and beyond the maxRows cap", async () => {
    const db = fakeDb();
    db.workerLog.findFirst.mockResolvedValue({ createdAt: new Date(2000) });
    await trimWorkerLogs(db as never, { now: () => 10_000, maxRows: 100, maxAgeMs: 5000 });
    expect(db.workerLog.deleteMany).toHaveBeenNthCalledWith(1, { where: { createdAt: { lt: new Date(5000) } } });
    expect(db.workerLog.findFirst).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, skip: 100, select: { createdAt: true } });
    expect(db.workerLog.deleteMany).toHaveBeenNthCalledWith(2, { where: { createdAt: { lt: new Date(2000) } } });
  });

  it("skips the count-cap delete when under the cap", async () => {
    const db = fakeDb();
    db.workerLog.findFirst.mockResolvedValue(null);
    await trimWorkerLogs(db as never, { now: () => 10_000, maxRows: 100, maxAgeMs: 5000 });
    expect(db.workerLog.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe("getWorkerLogs", () => {
  it("filters by level + before, orders newest-first, and maps createdAt to ISO", async () => {
    const db = fakeDb();
    const before = new Date("2026-06-23T12:00:00.000Z");
    db.workerLog.findMany.mockResolvedValue([
      { id: "1", level: "error", scope: "scan", message: "boom", catalogId: "c1", jobId: null, createdAt: new Date("2026-06-23T10:00:00.000Z") },
    ]);
    const out = await getWorkerLogs(db as never, { levels: [LogLevel.Error], before, limit: 50 });
    expect(db.workerLog.findMany).toHaveBeenCalledWith({
      where: { level: { in: [LogLevel.Error] }, createdAt: { lt: before } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(out).toEqual([
      { id: "1", level: LogLevel.Error, scope: "scan", message: "boom", catalogId: "c1", jobId: null, createdAt: "2026-06-23T10:00:00.000Z" },
    ]);
  });

  it("omits the level + range filters when none are given", async () => {
    const db = fakeDb();
    await getWorkerLogs(db as never, { levels: [], limit: 10 });
    expect(db.workerLog.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: "desc" }, take: 10 });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @lumio/jobs test -- log`
Expected: FAIL — cannot find module `./log.js`.

- [ ] **Step 3: Implement `log.ts`**

Create `packages/jobs/src/log.ts`:

```ts
import type { PrismaClient } from "@lumio/db";
import { LogLevel, type WorkerLogEntry } from "@lumio/shared";

/** The slice of Prisma the log helpers need (so tests can pass a mock). */
export type LogDb = Pick<PrismaClient, "workerLog">;

/** Optional structured tags attached to a log entry. */
export interface LogMeta {
  scope?: string;
  catalogId?: string | null;
  jobId?: string | null;
}

export interface WorkerLogger {
  error(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
  /** Persist buffered entries now. */
  flush(): Promise<void>;
  /** Final flush + stop the background timers. */
  close(): Promise<void>;
}

/** Ring-buffer bounds: keep at most this many rows and at most this age. */
export const LOG_MAX_ROWS = 10_000;
export const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 1000;
const TRIM_INTERVAL_MS = 30_000;

type ConsoleLike = Pick<Console, "log" | "warn" | "error" | "debug">;

interface BufferRow {
  level: LogLevel;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: Date;
}

export interface WorkerLoggerOptions {
  now?: () => number;
  flushThreshold?: number;
  maxRows?: number;
  maxAgeMs?: number;
  console?: ConsoleLike;
}

/**
 * A batched "tee" logger: every call prints to the console immediately
 * (preserving terminal UX) and buffers a row that is flushed to Postgres in
 * batches. A slow background timer trims the table to a ring buffer. A failed
 * DB write is swallowed — logging must never crash the worker.
 */
export function createWorkerLogger(db: LogDb, options: WorkerLoggerOptions = {}): WorkerLogger {
  const now = options.now ?? (() => Date.now());
  const threshold = options.flushThreshold ?? FLUSH_THRESHOLD;
  const maxRows = options.maxRows ?? LOG_MAX_ROWS;
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS;
  const out: ConsoleLike = options.console ?? console;

  let buffer: BufferRow[] = [];

  const tee = (level: LogLevel, message: string): void => {
    if (level === LogLevel.Error) out.error(message);
    else if (level === LogLevel.Warn) out.warn(message);
    else if (level === LogLevel.Debug) out.debug(message);
    else out.log(message);
  };

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    try {
      await db.workerLog.createMany({ data: rows });
    } catch {
      // best-effort telemetry: drop the batch rather than crash.
    }
  };

  const enqueue = (level: LogLevel, message: string, meta?: LogMeta): void => {
    tee(level, message);
    buffer.push({
      level,
      scope: meta?.scope ?? null,
      message,
      catalogId: meta?.catalogId ?? null,
      jobId: meta?.jobId ?? null,
      createdAt: new Date(now()),
    });
    if (buffer.length >= threshold) void flush();
  };

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const trimTimer = setInterval(
    () => void trimWorkerLogs(db, { now, maxRows, maxAgeMs }),
    TRIM_INTERVAL_MS,
  );
  // Don't keep the event loop alive just for logging timers.
  flushTimer.unref();
  trimTimer.unref();

  return {
    error: (m, meta) => enqueue(LogLevel.Error, m, meta),
    warn: (m, meta) => enqueue(LogLevel.Warn, m, meta),
    info: (m, meta) => enqueue(LogLevel.Info, m, meta),
    debug: (m, meta) => enqueue(LogLevel.Debug, m, meta),
    flush,
    close: async () => {
      clearInterval(flushTimer);
      clearInterval(trimTimer);
      await flush();
    },
  };
}

export interface TrimOptions {
  now?: () => number;
  maxRows?: number;
  maxAgeMs?: number;
}

/** Enforce the ring buffer: drop rows older than maxAgeMs, then any beyond maxRows. */
export async function trimWorkerLogs(db: LogDb, options: TrimOptions = {}): Promise<void> {
  const now = options.now ?? (() => Date.now());
  const maxRows = options.maxRows ?? LOG_MAX_ROWS;
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS;
  try {
    await db.workerLog.deleteMany({ where: { createdAt: { lt: new Date(now() - maxAgeMs) } } });
    const boundary = await db.workerLog.findFirst({
      orderBy: { createdAt: "desc" },
      skip: maxRows,
      select: { createdAt: true },
    });
    if (boundary) {
      await db.workerLog.deleteMany({ where: { createdAt: { lt: boundary.createdAt } } });
    }
  } catch {
    // best-effort
  }
}

export interface GetLogsQuery {
  levels?: LogLevel[];
  before?: Date;
  after?: Date;
  limit: number;
}

function toLogEntry(row: {
  id: string;
  level: string;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: Date;
}): WorkerLogEntry {
  return {
    id: row.id,
    level: row.level as LogLevel,
    scope: row.scope,
    message: row.message,
    catalogId: row.catalogId,
    jobId: row.jobId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Read worker logs newest-first, filtered by level + optional time window. */
export async function getWorkerLogs(db: LogDb, query: GetLogsQuery): Promise<WorkerLogEntry[]> {
  const where: { level?: { in: LogLevel[] }; createdAt?: { lt?: Date; gte?: Date } } = {};
  if (query.levels && query.levels.length > 0) where.level = { in: query.levels };
  const range: { lt?: Date; gte?: Date } = {};
  if (query.before) range.lt = query.before;
  if (query.after) range.gte = query.after;
  if (range.lt || range.gte) where.createdAt = range;

  const rows = await db.workerLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });
  return rows.map(toLogEntry);
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/jobs/src/index.ts`, add:

```ts
export * from "./log.js";
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @lumio/jobs test -- log`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/jobs/src/log.ts packages/jobs/src/log.test.ts packages/jobs/src/index.ts
git commit -m "feat(jobs): batched worker logger + ring-buffer trim + read helper"
```

---

## Task 4: Wire the logger through the worker

**Files:**
- Create: `apps/worker/src/log.ts`
- Modify: `apps/worker/src/scan.ts` (lines 179, 207, 222)
- Modify: `apps/worker/src/watch.ts` (lines 37-39, 61-64, 80-85, 87, 102, 108, 114)
- Modify: `apps/worker/src/handlers.ts` (line 40)
- Modify: `apps/worker/src/start.ts` (init/close + heartbeat + job lifecycle)
- Modify: `apps/worker/src/ingest-run.ts` (init/close + summary line)

> No unit test here — this is integration wiring. Behavior is covered by the existing `scan.test.ts` / `handlers.test.ts` (which assert behavior, not console output) plus the end-to-end verification in Task 9. The `log` singleton falls back to plain `console` until `initWorkerLog` runs, so those tests are unaffected.

- [ ] **Step 1: Create the worker log singleton**

Create `apps/worker/src/log.ts`:

```ts
import type { PrismaClient } from "@lumio/db";
import { createWorkerLogger, type LogMeta, type WorkerLogger } from "@lumio/jobs";

// Process-wide logger. Until initWorkerLog() runs (tests, one-off CLI scripts
// that don't activate persistence), calls fall back to plain console so nothing
// double-prints and no DB writes happen.
let impl: WorkerLogger | null = null;

export const log = {
  error: (message: string, meta?: LogMeta) => (impl ? impl.error(message, meta) : console.error(message)),
  warn: (message: string, meta?: LogMeta) => (impl ? impl.warn(message, meta) : console.warn(message)),
  info: (message: string, meta?: LogMeta) => (impl ? impl.info(message, meta) : console.log(message)),
  debug: (message: string, meta?: LogMeta) => (impl ? impl.debug(message, meta) : console.debug(message)),
};

/**
 * Activate DB-backed logging for the current process. Returns a close fn that
 * flushes buffered entries — wire it to shutdown so nothing is lost.
 */
export function initWorkerLog(db: Pick<PrismaClient, "workerLog">): () => Promise<void> {
  impl = createWorkerLogger(db);
  return async () => {
    const current = impl;
    impl = null;
    if (current) await current.close();
  };
}
```

- [ ] **Step 2: Route `scan.ts` through `log`**

In `apps/worker/src/scan.ts`, add the import after line 10 (`import { runPool } from "./pool.js";`):

```ts
import { log } from "./log.js";
```

Replace line 179:

```ts
  log.info(`processed ${timedLine(relPath, performance.now() - start)}`, { scope: "scan", catalogId: catalog.id });
```

Replace line 207:

```ts
      log.warn(`skip ${relPath}: ${errorMessage(err)}`, { scope: "scan", catalogId: catalog.id });
```

Replace line 222:

```ts
      log.warn(`remove failed ${row.path}: ${errorMessage(err)}`, { scope: "scan", catalogId: catalog.id });
```

- [ ] **Step 3: Route `watch.ts` through `log`**

In `apps/worker/src/watch.ts`, add after line 10 (`import { catalogForPath } from "./catalog-routing.js";`):

```ts
import { log } from "./log.js";
```

Replace the initial-scan log (lines 37-39):

```ts
    log.info(
      `Initial scan [${c.path}] — processed ${result.processed}, unchanged ${result.skippedUnchanged}, healed ${result.healed}, restamped ${result.restamped}, removed ${result.removed}`,
      { scope: "scan", catalogId: c.id },
    );
```

Replace lines 61-64 (inside `upsert`):

```ts
      if (summary.healed) log.info(`healed ${rel}`, { scope: "watch", catalogId: catalog.id });
      else if (summary.restamped) log.info(`restamped ${rel}`, { scope: "watch", catalogId: catalog.id });
    } catch (err) {
      log.warn(`skip ${rel}: ${errorMessage(err)}`, { scope: "watch", catalogId: catalog.id });
```

Replace the unlink handler body (lines 80-85). The full `.on("unlink", …)`/`.on("error", …)` block becomes:

```ts
    .on("unlink", async (abs: string) => {
      if (!isSupported(abs)) return;
      const catalog = catalogForPath(catalogs, abs);
      if (!catalog) return;
      const rel = path.relative(catalog.path, abs);
      try {
        await removePath(rel, removeDepsFor(catalog));
        log.info(`removed ${rel}`, { scope: "watch", catalogId: catalog.id });
      } catch (err) {
        log.warn(`remove failed ${rel}: ${errorMessage(err)}`, { scope: "watch", catalogId: catalog.id });
      }
    })
    .on("error", (err) => log.error(`watcher error: ${String(err)}`, { scope: "watch" }));
```

Replace line 87:

```ts
  log.info(`Watching ${catalogs.map((c) => c.path).join(", ")} …`, { scope: "watch" });
```

Replace line 102:

```ts
          log.info(`Catalog added, now watching ${c.path}`, { scope: "watch", catalogId: c.id });
```

Replace line 108:

```ts
          log.info(`Catalog removed, stopped watching ${c.path}`, { scope: "watch", catalogId: c.id });
```

Replace line 114:

```ts
      log.warn(`catalog reconcile error: ${errorMessage(err)}`, { scope: "watch" });
```

- [ ] **Step 4: Route `handlers.ts` through `log`**

In `apps/worker/src/handlers.ts`, add after line 6 (`import { scanCatalog } from "./scan.js";`):

```ts
import { log } from "./log.js";
```

Replace the `console.warn` at line 40:

```ts
        void report(done, total, "Scanning…").catch((err) => {
          log.warn(`progress write failed: ${err instanceof Error ? err.message : String(err)}`, { scope: "consumer", jobId: job.id });
        });
```

- [ ] **Step 5: Init/close + heartbeat + job lifecycle in `start.ts`**

Edit `apps/worker/src/start.ts`. Update the imports block (lines 1-12) to add `JobStatus` and the local log module:

```ts
import { prisma } from "@lumio/db";
import {
  formatActivity,
  recoverOrphanedJobs,
  runJobConsumer,
  sleep,
  writeHeartbeat,
} from "@lumio/jobs";
import { errorMessage, JobStatus } from "@lumio/shared";
import { activity } from "./activity.js";
import { buildHandlers } from "./handlers.js";
import { log, initWorkerLog } from "./log.js";
import { startWatcher } from "./watch.js";
```

Inside `startWorker()`, right after `const { signal } = controller;` (line 22), activate logging:

```ts
  const closeLog = initWorkerLog(prisma);
  log.info("worker started", { scope: "startup" });
```

In the `shutdown` closure, flush logs before disconnecting (between `controller.abort();` and `await prisma.$disconnect();`):

```ts
    controller.abort();
    await closeLog();
    await prisma.$disconnect();
    process.exit(0);
```

Replace the heartbeat `.catch` (line 43):

```ts
      ).catch((err) => log.warn(`heartbeat failed: ${errorMessage(err)}`, { scope: "heartbeat" }));
```

Replace the consumer `onClaim` / `onSettle` (lines 48-56) to log job lifecycle:

```ts
  const consumer = runJobConsumer(prisma, buildHandlers(), {
    signal,
    onClaim: (job) => {
      activity.currentJob = { id: job.id, type: job.type };
      log.info(`job ${job.type} started`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
    },
    onSettle: (job) => {
      activity.currentJob = null;
      // Re-read the settled row so we log the real outcome (the claimed job was
      // still "running"). Best-effort — never throw out of a settle callback.
      void prisma.job
        .findUnique({ where: { id: job.id } })
        .then((settled) => {
          if (!settled) return;
          if (settled.status === JobStatus.failed) {
            log.error(`job ${job.type} failed: ${settled.error ?? "unknown error"}`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
          } else {
            log.info(`job ${job.type} ${settled.status}`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
          }
        })
        .catch(() => {});
    },
  });
```

- [ ] **Step 6: Persist one-off ingests in `ingest-run.ts`**

Replace the whole of `apps/worker/src/ingest-run.ts`:

```ts
import { prisma } from "@lumio/db";
import { scanAllCatalogs } from "./scan.js";
import { initWorkerLog, log } from "./log.js";

export async function runIngest(): Promise<void> {
  const closeLog = initWorkerLog(prisma);
  const start = Date.now();
  const summary = await scanAllCatalogs();
  log.info(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, healed ${summary.healed}, restamped ${summary.restamped}, skipped ${summary.skipped}, removed ${summary.removed}`,
    { scope: "scan" },
  );
  await closeLog();
  await prisma.$disconnect();
}
```

- [ ] **Step 7: Typecheck + run worker tests**

Run: `pnpm --filter @lumio/worker typecheck && pnpm --filter @lumio/worker test`
Expected: PASS (existing scan/handlers/etc. tests still green; the `log` import resolves and types check).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/log.ts apps/worker/src/scan.ts apps/worker/src/watch.ts apps/worker/src/handlers.ts apps/worker/src/start.ts apps/worker/src/ingest-run.ts
git commit -m "feat(worker): persist leveled logs (scan/watch/consumer) via tee logger"
```

---

## Task 5: Global `GET /api/logs` route

**Files:**
- Create: `apps/web/src/app/api/logs/route.ts`

- [ ] **Step 1: Implement the route**

Create `apps/web/src/app/api/logs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { getWorkerLogs } from "@lumio/jobs";
import { logsQuerySchema, type LogsResponse } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Worker logs are global (a single worker). Auth is "logged-in" only, like the
 * other settings endpoints. Newest-first, cursor-paged via `before`.
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const parsed = logsQuerySchema.safeParse({
    level: url.searchParams.get("level") ?? undefined,
    before: url.searchParams.get("before") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { level, before, since, limit } = parsed.data;

  try {
    const entries = await getWorkerLogs(prisma, {
      levels: level,
      before: before ? new Date(before) : undefined,
      after: since ? new Date(since) : undefined,
      limit,
    });
    // A full page implies there may be older rows; hand back the oldest as the cursor.
    const nextBefore = entries.length === limit ? entries[entries.length - 1]!.createdAt : null;
    return NextResponse.json({ entries, nextBefore } satisfies LogsResponse);
  } catch {
    // DB unreachable → empty page rather than 500-ing the poller (mirrors /activity).
    return NextResponse.json({ entries: [], nextBefore: null } satisfies LogsResponse, { status: 503 });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/logs/route.ts
git commit -m "feat(web): GET /api/logs global route"
```

---

## Task 6: Add the shadcn ScrollArea component

**Files:**
- Create: `apps/web/src/components/ui/scroll-area.tsx` (generated)

- [ ] **Step 1: Add via the shadcn CLI**

Run: `cd apps/web && pnpm dlx shadcn@latest add scroll-area --yes`
Expected: creates `apps/web/src/components/ui/scroll-area.tsx`. If the CLI also pulls a Radix dependency, let it.

- [ ] **Step 2: Verify it exists and typechecks**

Run: `cd /Users/gego/conductor/workspaces/lumio/cape-town-v2 && pnpm --filter @lumio/web typecheck`
Expected: PASS, and `apps/web/src/components/ui/scroll-area.tsx` is present.

> If the CLI is offline/unavailable, create the file manually from the shadcn "radix-maia" style: a `ScrollArea` wrapping `@radix-ui/react-scroll-area` `Root`/`Viewport`/`Scrollbar`/`Thumb`/`Corner`, exporting `ScrollArea` and `ScrollBar`. Confirm `@radix-ui/react-scroll-area` is installed (`pnpm --filter @lumio/web add @radix-ui/react-scroll-area`) before writing it.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/scroll-area.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add shadcn scroll-area"
```

---

## Task 7: `use-logs` data hook

**Files:**
- Create: `apps/web/src/lib/hooks/use-logs.ts`

- [ ] **Step 1: Implement the hook**

Create `apps/web/src/lib/hooks/use-logs.ts`. It resets + live-polls the newest page on the existing adaptive cadence, dedupes by id, and exposes `loadMore` for older pages. Filters are tracked via the comma-joined `levelKey` string so a fresh `levels` array identity each render does not thrash the effect.

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOGS_PAGE_SIZE, type LogLevel, type LogsResponse, type WorkerLogEntry } from "@lumio/shared";
import { pollInterval } from "@/lib/poll-interval";

export type SinceFilter = "1h" | "24h" | "7d";

const SINCE_MS: Record<SinceFilter, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

export interface UseLogsResult {
  entries: WorkerLogEntry[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

function buildUrl(levels: LogLevel[], sinceIso: string, before?: string): string {
  const params = new URLSearchParams();
  if (levels.length > 0) params.set("level", levels.join(","));
  params.set("since", sinceIso);
  params.set("limit", String(LOGS_PAGE_SIZE));
  if (before) params.set("before", before);
  return `/api/logs?${params.toString()}`;
}

function sortDesc(entries: WorkerLogEntry[]): WorkerLogEntry[] {
  return [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function useLogs(levels: LogLevel[], since: SinceFilter): UseLogsResult {
  const [entries, setEntries] = useState<WorkerLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  // Comma key keeps the effect stable across new `levels` array identities.
  const levelKey = levels.join(",");

  // Latest entries for loadMore's cursor; synced in an effect, not during render.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  const mergeInto = useCallback((incoming: WorkerLogEntry[]) => {
    setEntries((prev) => {
      const map = new Map(prev.map((e) => [e.id, e] as const));
      for (const e of incoming) map.set(e.id, e);
      return sortDesc([...map.values()]);
    });
  }, []);

  // Reset on filter change, then live-poll the newest page.
  useEffect(() => {
    const activeLevels = levelKey ? (levelKey.split(",") as LogLevel[]) : [];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setEntries([]);
    setLoading(true);
    setHasMore(false);

    const sinceIso = () => new Date(Date.now() - SINCE_MS[since]).toISOString();

    const tick = async () => {
      try {
        const res = await fetch(buildUrl(activeLevels, sinceIso()), { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data: LogsResponse = await res.json();
          mergeInto(data.entries);
          if (data.entries.length >= LOGS_PAGE_SIZE) setHasMore(true);
        }
      } catch {
        // transient — keep the last entries, retry next tick
      }
      if (!cancelled) setLoading(false);
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      const ms = pollInterval(false, document.hidden);
      if (ms === null) return; // paused on hidden tab; visibilitychange restarts
      timer = setTimeout(tick, ms);
    };

    const onVisible = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [levelKey, since, mergeInto]);

  const loadMore = useCallback(() => {
    const current = entriesRef.current;
    const oldest = current[current.length - 1];
    if (!oldest) return;
    const activeLevels = levelKey ? (levelKey.split(",") as LogLevel[]) : [];
    const sinceIso = new Date(Date.now() - SINCE_MS[since]).toISOString();
    void (async () => {
      try {
        const res = await fetch(buildUrl(activeLevels, sinceIso, oldest.createdAt), { cache: "no-store" });
        if (!res.ok) return;
        const data: LogsResponse = await res.json();
        mergeInto(data.entries);
        setHasMore(data.entries.length >= LOGS_PAGE_SIZE);
      } catch {
        // ignore — the button stays available to retry
      }
    })();
  }, [levelKey, since, mergeInto]);

  return { entries, loading, hasMore, loadMore };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/use-logs.ts
git commit -m "feat(web): use-logs hook (poll newest + load older)"
```

---

## Task 8: Logs settings page, view, and nav

**Files:**
- Create: `apps/web/src/app/(app)/settings/logs/page.tsx`
- Create: `apps/web/src/app/(app)/settings/logs/logs-view.tsx`
- Modify: `apps/web/src/components/settings-sidebar.tsx` (imports + `ITEMS`)

- [ ] **Step 1: Add the nav item**

In `apps/web/src/components/settings-sidebar.tsx`, update the lucide import (line 5) to include `ScrollText`:

```ts
import { ArrowLeft, GalleryHorizontalEnd, ScrollText, ToggleRight, User, Users } from "lucide-react";
```

Add a Logs entry to `ITEMS` (after the Features line, ~line 13):

```ts
  { href: "/settings/logs", label: "Logs", icon: ScrollText, match: ["/settings/logs"] },
```

- [ ] **Step 2: Create the page shell**

Create `apps/web/src/app/(app)/settings/logs/page.tsx`:

```tsx
import type { Metadata } from "next";
import { LogsView } from "./logs-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logs" };

export default function LogsSettingsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">
          Recent worker activity — ingestion, the file watcher, and background jobs.
          Kept to the last 10,000 entries (max 7 days).
        </p>
      </div>
      <LogsView />
    </main>
  );
}
```

- [ ] **Step 3: Create the view**

Create `apps/web/src/app/(app)/settings/logs/logs-view.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { LOG_LEVELS, LogLevel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useLogs, type SinceFilter } from "@/lib/hooks/use-logs";

const LEVEL_LABEL: Record<LogLevel, string> = {
  [LogLevel.Error]: "Error",
  [LogLevel.Warn]: "Warn",
  [LogLevel.Info]: "Info",
  [LogLevel.Debug]: "Debug",
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  [LogLevel.Error]: "text-red-500",
  [LogLevel.Warn]: "text-amber-500",
  [LogLevel.Info]: "text-foreground",
  [LogLevel.Debug]: "text-muted-foreground",
};

const SINCE_OPTIONS: { value: SinceFilter; label: string }[] = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogsView() {
  const [active, setActive] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS));
  const [since, setSince] = useState<SinceFilter>("24h");

  // Derive a stable, sorted level list from the toggle set.
  const levels = useMemo(() => LOG_LEVELS.filter((l) => active.has(l)), [active]);
  const { entries, loading, hasMore, loadMore } = useLogs(levels, since);

  const toggle = (level: LogLevel) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggle(level)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active.has(level)
                  ? "border-transparent bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active.has(level)}
            >
              {LEVEL_LABEL[level]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {SINCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSince(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                since === opt.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={since === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log stream */}
      <ScrollArea className="h-[calc(100dvh-260px)] rounded-lg border bg-card">
        <div className="p-2 font-mono text-xs">
          {entries.length === 0 && !loading && (
            <p className="px-2 py-8 text-center text-muted-foreground">No logs match these filters.</p>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="flex gap-3 rounded px-2 py-1 hover:bg-muted/50">
              <time
                className="shrink-0 tabular-nums text-muted-foreground"
                title={new Date(entry.createdAt).toLocaleString()}
              >
                {formatTime(entry.createdAt)}
              </time>
              <span className={cn("w-12 shrink-0 font-semibold uppercase", LEVEL_TEXT[entry.level])}>
                {entry.level}
              </span>
              {entry.scope && <span className="shrink-0 text-muted-foreground">[{entry.scope}]</span>}
              <span className="whitespace-pre-wrap break-all text-foreground">{entry.message}</span>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center py-3">
              <Button variant="outline" size="sm" onClick={loadMore}>
                Load older logs
              </Button>
            </div>
          )}
          {loading && entries.length === 0 && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```

> Note: I implemented "load older" as an explicit button rather than scroll-triggered, which is simpler and avoids fragile scroll-position math inside the Radix viewport. Live tail (new entries appearing on top) still works via the poll. If `Spinner` is not present, swap for a simple `<p className="text-muted-foreground">Loading…</p>` (verify: `apps/web/src/components/ui/spinner.tsx` exists — it does per the ui inventory).

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lumio/web typecheck && pnpm --filter @lumio/web lint`
Expected: PASS (no React-Compiler violations: `"use client"` is line 1; state updates use updater fns; no refs read during render).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/settings/logs apps/web/src/components/settings-sidebar.tsx
git commit -m "feat(web): worker logs settings page (filters + scroll-area)"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests across the affected packages**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS across `@lumio/shared`, `@lumio/jobs`, `@lumio/db`, `@lumio/worker`, `@lumio/web`.

- [ ] **Step 2: Generate logs with the worker**

Ensure the DB is up (`pnpm db:up`), then run a one-shot ingest:

Run: `pnpm ingest`
Expected: terminal prints the same `processed …` / `Ingestion complete …` lines as before, AND rows now exist in `WorkerLog`.

Verify rows persisted:

Run: `pnpm --filter @lumio/db exec prisma studio` (open the `WorkerLog` table) — or a quick count via a node one-liner against the DB.
Expected: `WorkerLog` has `info`/`warn` rows with `scope = "scan"`.

- [ ] **Step 3: View in the browser**

Start the web app (`pnpm dev`), sign in, and navigate to `/settings/logs`.
Expected:
- The Logs item appears in the settings rail (ScrollText icon) and is active on the page.
- Entries render newest-first in the ScrollArea with timestamp · level · scope · message.
- Toggling level chips filters the stream; switching Since (1h/24h/7d) re-queries.
- Running `pnpm watch` and touching a file in a catalog makes a new `watch`-scoped entry appear within ~5s without reload.
- "Load older logs" appears when there is a full page and fetches more.

Use the browser tools to confirm the page renders and the `/api/logs` calls return 200 (check the network panel / console for errors).

- [ ] **Step 4: Final commit (if verification required any fixups)**

```bash
git add -A
git commit -m "test(web): verify worker logs end-to-end"
```

---

## Self-review notes

- **Spec coverage:** data model (T1) · wire types + schema (T2) · batched logger + ring-buffer trim + read helper (T3) · "make logs well" worker audit incl. job lifecycle (T4) · global API route (T5) · ScrollArea dep (T6) · live hook (T7) · settings page + nav + filters (T8) · retention is enforced by T3's `trimWorkerLogs` on the logger's timer · verification (T9). All spec sections map to a task.
- **Type consistency:** `LogLevel`, `WorkerLogEntry`, `LogsResponse`, `LOGS_PAGE_SIZE` defined in T2 and used verbatim in T3/T5/T7. `createWorkerLogger`/`trimWorkerLogs`/`getWorkerLogs`/`LogMeta` defined in T3 and consumed in T4 (`initWorkerLog`) and T5 (route). `useLogs(levels, since)` signature from T7 matches the call in T8.
- **Deviations from spec (intentional, noted in-task):** "load older" is a button, not scroll-triggered (T8). Job lifecycle is logged from the worker's `onSettle` via a re-read, keeping `@lumio/jobs`' consumer untouched and its tests intact (T4).
- **Shared-DB safety:** the only migration (T1) is purely additive; the plan explicitly forbids accepting any reset/backfill prompt.
