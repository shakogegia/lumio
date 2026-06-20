# Worker Activity & Async Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web app live visibility into the worker (online + what it's doing) and make rescan, delete-all, and empty-trash run asynchronously as tracked Postgres jobs with progress — no Redis.

**Architecture:** A new `@lumio/jobs` package holds the Postgres-backed job queue (a `Job` table claimed with `FOR UPDATE SKIP LOCKED`), a `WorkerStatus` heartbeat singleton, progress reporting, and the relocated danger-zone deletion functions. The long-running worker process grows two concurrent loops — a heartbeat and a serial job consumer — alongside its existing chokidar watcher. The web app becomes a pure producer (enqueue a row) + reader (poll `/api/activity`), surfacing state on the sidebar aperture logo. Polling is behind one `useActivity()` seam that can later swap to `LISTEN/NOTIFY` push.

**Tech Stack:** TypeScript (ESM, `verbatimModuleSyntax`, `.js` import specifiers), Prisma 6 / PostgreSQL, pnpm workspaces, Next.js 16 (App Router), Vitest, React 19, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-20-worker-activity-and-async-jobs-design.md`

---

## Conventions (read once before starting)

- **Imports use `.js` specifiers** even for `.ts` files (`moduleResolution: "Bundler"`, `verbatimModuleSyntax`). Match the existing code: `import { x } from "./foo.js"`.
- **Tests** (`*.test.ts`, Vitest) live next to the file. Two patterns in this repo, both used here:
  - **Pure functions** → call directly with literal inputs (see `apps/worker/src/scan.test.ts`).
  - **DB logic** → pass a hand-built mock `db` object with `vi.fn()`/async stubs, cast `as never` (see `packages/db/src/settings.test.ts`); use real temp dirs (`mkdtemp`) for filesystem logic (see `apps/web/src/lib/trash-service.test.ts`).
- **No real Postgres needed for these tests** — every DB interaction is mocked. (`DATABASE_URL` in vitest configs is only there so Prisma's client constructs.)
- **Run a single package's tests:** `pnpm --filter @lumio/jobs test` (etc.). Run one file: `pnpm --filter @lumio/jobs exec vitest run src/foo.test.ts`.
- **Commit after each task** with a `feat:`/`refactor:`/`chore:` prefix.
- `Date`/`setTimeout` are fine in app code (the ban only applies to Workflow scripts).

---

## File Structure

**New package `packages/jobs/`** (`@lumio/jobs`) — framework-agnostic, depends on `@lumio/db` + `@lumio/shared`:
- `src/predicates.ts` — pure helpers: `isWorkerOnline`, `formatActivity`, `shouldWrite`, `toJobDTO`, `buildActivitySnapshot`. (Client-side poll cadence lives in `apps/web/src/lib/poll-interval.ts` — `@lumio/jobs` is server-only.)
- `src/queue.ts` — `enqueueJob`, `findActiveJob`, `getActiveJobs`, `recoverOrphanedJobs`, `claimNextJob`, `markJobSucceeded`, `markJobFailed`.
- `src/heartbeat.ts` — `writeHeartbeat`, `readWorkerStatus`.
- `src/progress.ts` — `createProgressReporter`.
- `src/consumer.ts` — `processNextJob`, `runJobConsumer`, `sleep`.
- `src/purge.ts` — relocated `purgeAllPhotos`, `purgeTrash` (deps now required).
- `src/index.ts` — barrel.

**`packages/db/`** — add `Job` + `WorkerStatus` models; export their types.
**`packages/shared/`** — `src/jobs.ts` (job type/status literals + DTO type + zod).
**`apps/worker/`** — `src/activity.ts` (in-process state), `src/handlers.ts` (handler registry), `src/start.ts` (orchestration); modify `config.ts`, `scan.ts`, `watch.ts`, `watch-main.ts`.
**`apps/web/`** — rewrite `api/rescan`, `api/photos/purge`, `api/trash/empty` routes; fix `api/trash/purge` import; new `api/activity` route; `lib/use-activity.ts` hook; sidebar activity indicator; wire settings/trash buttons; remove relocated `purgeAllPhotos`/`purgeTrash` from `lib/photos-service.ts`/`lib/trash-service.ts`.
**`Dockerfile`** — add `packages/jobs/package.json` to the deps COPY list.

---

## Task 1: Prisma models `Job` + `WorkerStatus`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add the two models**

Append to `packages/db/prisma/schema.prisma` (after the `Verification` model):

```prisma
model Job {
  id         String    @id @default(cuid())
  type       String // "rescan" | "purge_all" | "empty_trash"
  status     String    @default("queued") // queued | running | succeeded | failed | canceled
  total      Int? // null until the worker knows the count
  processed  Int       @default(0)
  message    String?
  error      String?
  createdAt  DateTime  @default(now())
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([status, createdAt])
}

model WorkerStatus {
  id         String   @id // always "singleton"
  lastSeenAt DateTime
  activity   String   @default("idle") // "idle" | "watching" | "importing N" | "running: <type>"
  jobId      String?
}
```

- [ ] **Step 2: Export the generated types**

In `packages/db/src/index.ts`, add `Job` and `WorkerStatus` to the type re-export line:

```typescript
export type { Photo, Album, AlbumPhoto, TrashedPhoto, Job, WorkerStatus, Prisma, PrismaClient } from "@prisma/client";
```

- [ ] **Step 3: Create the migration + regenerate the client**

Run (requires the dev Postgres up — `pnpm db:up` if needed):

```bash
pnpm --filter @lumio/db migrate -- --name add_jobs_and_worker_status
```

Expected: a new folder under `packages/db/prisma/migrations/` and "Your database is now in sync". This also regenerates the Prisma client. If the client isn't regenerated, run `pnpm --filter @lumio/db generate`.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @lumio/db typecheck`
Expected: no errors (the new `Job`/`WorkerStatus` types resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma packages/db/src/index.ts
git commit -m "feat(db): add Job + WorkerStatus models"
```

---

## Task 2: Shared job literals + DTO + zod (`@lumio/shared`)

**Files:**
- Create: `packages/shared/src/jobs.ts`
- Create: `packages/shared/src/jobs.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/jobs.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { JobType, isJobType, jobTypeSchema } from "./jobs.js";

describe("jobTypeSchema", () => {
  it("accepts the known job types", () => {
    for (const t of Object.values(JobType)) expect(jobTypeSchema.parse(t)).toBe(t);
  });

  it("rejects unknown types", () => {
    expect(jobTypeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("isJobType", () => {
  it("is a type guard over the enum values", () => {
    expect(isJobType("rescan")).toBe(true);
    expect(isJobType("purge_all")).toBe(true);
    expect(isJobType("nope")).toBe(false);
    expect(isJobType(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/jobs.test.ts`
Expected: FAIL — cannot find module `./jobs.js`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/jobs.ts` (TS `enum`s, matching the `enums.ts` style — see `PhotoSource`):

```typescript
import { z } from "zod";

/** Discrete, user-initiated background operations. Mirrors the Job.type column 1:1. */
export enum JobType {
  rescan = "rescan",
  purge_all = "purge_all",
  empty_trash = "empty_trash",
}

/** Job lifecycle states. Mirrors the Job.status column 1:1. */
export enum JobStatus {
  queued = "queued",
  running = "running",
  succeeded = "succeeded",
  failed = "failed",
  canceled = "canceled",
}

/** Statuses that count as "in flight" (occupies the queue, shows in the UI). */
export const ACTIVE_JOB_STATUSES = [JobStatus.queued, JobStatus.running] as const;

/** Zod schema for a job type (strict — used in API validation). */
export const jobTypeSchema = z.nativeEnum(JobType);

export function isJobType(value: unknown): value is JobType {
  return Object.values(JobType).includes(value as JobType);
}

/** Serialized job for the web (dates as ISO strings). */
export interface JobDTO {
  id: string;
  type: JobType;
  status: JobStatus;
  total: number | null;
  processed: number;
  message: string | null;
  error: string | null;
}

/** Response shape for GET /api/activity. */
export interface ActivitySnapshot {
  worker: { online: boolean; activity: string };
  jobs: JobDTO[];
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add after the `./api.js` line:

```typescript
export * from "./jobs.js";
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/jobs.test.ts`
Expected: PASS (both describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/jobs.ts packages/shared/src/jobs.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): job type/status literals + DTO + zod"
```

---

## Task 3: Scaffold the `@lumio/jobs` package

**Files:**
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/tsconfig.json`
- Create: `packages/jobs/vitest.config.ts`
- Create: `packages/jobs/src/index.ts`
- Modify: `apps/web/package.json`, `apps/worker/package.json`, `Dockerfile`

- [ ] **Step 1: Create the package manifest**

Create `packages/jobs/package.json`:

```json
{
  "name": "@lumio/jobs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lumio/db": "workspace:*",
    "@lumio/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create tsconfig + vitest config + empty barrel**

Create `packages/jobs/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Create `packages/jobs/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

Create `packages/jobs/src/index.ts`:

```typescript
export * from "./predicates.js";
export * from "./queue.js";
export * from "./heartbeat.js";
export * from "./progress.js";
export * from "./consumer.js";
export * from "./purge.js";
```

(The referenced files arrive in Tasks 4–9; the barrel will fail typecheck until then — that's expected mid-task.)

- [ ] **Step 3: Add the dependency to web + worker**

In `apps/web/package.json`, add to `dependencies` (alphabetical, after `@lumio/ingest`):

```json
    "@lumio/jobs": "workspace:*",
```

In `apps/worker/package.json`, add to `dependencies` (after `@lumio/ingest`):

```json
    "@lumio/jobs": "workspace:*",
```

- [ ] **Step 4: Add the package to the Docker deps stage**

In `Dockerfile`, after the `packages/ingest/package.json` COPY line (line ~31), add:

```dockerfile
COPY packages/jobs/package.json    packages/jobs/package.json
```

- [ ] **Step 5: Install so the workspace links resolve**

Run: `pnpm install`
Expected: lockfile updates; `@lumio/jobs` linked into web + worker `node_modules`. (Typecheck will still fail until Tasks 4–9 add the source — that's fine.)

- [ ] **Step 6: Commit**

```bash
git add packages/jobs apps/web/package.json apps/worker/package.json Dockerfile pnpm-lock.yaml
git commit -m "chore(jobs): scaffold @lumio/jobs package"
```

---

## Task 4: Pure predicates (`@lumio/jobs`)

**Files:**
- Create: `packages/jobs/src/predicates.ts`
- Create: `packages/jobs/src/predicates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/jobs/src/predicates.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildActivitySnapshot,
  formatActivity,
  isWorkerOnline,
  shouldWrite,
  toJobDTO,
} from "./predicates.js";

const NOW = new Date("2026-06-20T12:00:00.000Z");

describe("isWorkerOnline", () => {
  it("is online when lastSeenAt is within the stale window", () => {
    expect(isWorkerOnline(new Date(NOW.getTime() - 3000), NOW, 6000)).toBe(true);
  });
  it("is offline when lastSeenAt is older than the window", () => {
    expect(isWorkerOnline(new Date(NOW.getTime() - 9000), NOW, 6000)).toBe(false);
  });
  it("is offline when never seen", () => {
    expect(isWorkerOnline(null, NOW, 6000)).toBe(false);
  });
});

describe("formatActivity", () => {
  it("prefers the current job", () => {
    expect(formatActivity({ importing: 4, currentJob: { id: "j", type: "rescan" } })).toBe(
      "running: rescan",
    );
  });
  it("reports importing when the watcher is busy", () => {
    expect(formatActivity({ importing: 12, currentJob: null })).toBe("importing 12");
  });
  it("is watching when idle", () => {
    expect(formatActivity({ importing: 0, currentJob: null })).toBe("watching");
  });
});

describe("shouldWrite", () => {
  it("always writes the first time", () => {
    expect(shouldWrite(null, 1000, 250)).toBe(true);
  });
  it("skips within the interval", () => {
    expect(shouldWrite(1000, 1100, 250)).toBe(false);
  });
  it("writes once the interval elapses", () => {
    expect(shouldWrite(1000, 1300, 250)).toBe(true);
  });
});

describe("toJobDTO + buildActivitySnapshot", () => {
  const job = {
    id: "j1",
    type: "rescan",
    status: "running",
    total: 100,
    processed: 40,
    message: "Scanning…",
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
  };

  it("strips dates down to the wire DTO", () => {
    expect(toJobDTO(job)).toEqual({
      id: "j1",
      type: "rescan",
      status: "running",
      total: 100,
      processed: 40,
      message: "Scanning…",
      error: null,
    });
  });

  it("combines worker status + jobs into the snapshot", () => {
    const snap = buildActivitySnapshot(
      { id: "singleton", lastSeenAt: new Date(NOW.getTime() - 1000), activity: "running: rescan", jobId: "j1" },
      [job],
      NOW,
      6000,
    );
    expect(snap.worker).toEqual({ online: true, activity: "running: rescan" });
    expect(snap.jobs).toHaveLength(1);
    expect(snap.jobs[0]?.id).toBe("j1");
  });

  it("reports offline + idle when there is no worker status row", () => {
    const snap = buildActivitySnapshot(null, [], NOW, 6000);
    expect(snap.worker).toEqual({ online: false, activity: "offline" });
    expect(snap.jobs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/predicates.test.ts`
Expected: FAIL — cannot find module `./predicates.js`.

- [ ] **Step 3: Implement**

Create `packages/jobs/src/predicates.ts`:

```typescript
import type { Job, WorkerStatus } from "@lumio/db";
import type { ActivitySnapshot, JobDTO, JobType } from "@lumio/shared";

/** Worker is online if its heartbeat landed within the stale window. */
export function isWorkerOnline(
  lastSeenAt: Date | null | undefined,
  now: Date,
  staleMs: number,
): boolean {
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() <= staleMs;
}

/** In-process activity snapshot the worker keeps; rendered to a status string. */
export interface ActivityState {
  importing: number;
  currentJob: { id: string; type: string } | null;
}

/** Human status string: current job wins, then watcher imports, then idle. */
export function formatActivity(state: ActivityState): string {
  if (state.currentJob) return `running: ${state.currentJob.type}`;
  if (state.importing > 0) return `importing ${state.importing}`;
  return "watching";
}

/** Throttle gate: write if never written or the min interval has elapsed. */
export function shouldWrite(lastAt: number | null, now: number, minIntervalMs: number): boolean {
  return lastAt === null || now - lastAt >= minIntervalMs;
}

/** Serialize a Job row to the wire DTO (drops dates the UI doesn't need). */
export function toJobDTO(job: Job): JobDTO {
  return {
    id: job.id,
    type: job.type as JobType,
    status: job.status as JobDTO["status"],
    total: job.total,
    processed: job.processed,
    message: job.message,
    error: job.error,
  };
}

/** Assemble the GET /api/activity payload from the worker row + active jobs. */
export function buildActivitySnapshot(
  worker: WorkerStatus | null,
  jobs: Job[],
  now: Date,
  staleMs: number,
): ActivitySnapshot {
  return {
    worker: {
      online: isWorkerOnline(worker?.lastSeenAt, now, staleMs),
      activity: worker?.activity ?? "offline",
    },
    jobs: jobs.map(toJobDTO),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/predicates.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/predicates.ts packages/jobs/src/predicates.test.ts
git commit -m "feat(jobs): pure predicates (online/activity/throttle/poll/snapshot)"
```

---

## Task 5: Queue helpers — enqueue, dedupe, list, recover, mark (`@lumio/jobs`)

**Files:**
- Create: `packages/jobs/src/queue.ts`
- Create: `packages/jobs/src/queue.test.ts`

Note: `claimNextJob` (raw SQL) is added in Task 6 — this task covers the Prisma-model helpers.

- [ ] **Step 1: Write the failing test**

Create `packages/jobs/src/queue.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import {
  enqueueJob,
  findActiveJob,
  getActiveJobs,
  markJobFailed,
  markJobSucceeded,
  recoverOrphanedJobs,
} from "./queue.js";

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "new", type: "rescan", status: "queued" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  };
}

describe("enqueueJob", () => {
  it("creates a new job when none is active", async () => {
    const db = fakeDb();
    const job = await enqueueJob(db as never, JobType.rescan);
    expect(db.job.create).toHaveBeenCalledWith({ data: { type: "rescan" } });
    expect(job.id).toBe("new");
  });

  it("returns the existing active job instead of double-queueing", async () => {
    const existing = { id: "x", type: "rescan", status: "running" };
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue(existing) });
    const job = await enqueueJob(db as never, JobType.rescan);
    expect(job).toBe(existing);
    expect(db.job.create).not.toHaveBeenCalled();
  });
});

describe("findActiveJob", () => {
  it("queries for queued/running of the given type", async () => {
    const db = fakeDb();
    await findActiveJob(db as never, JobType.purge_all);
    expect(db.job.findFirst).toHaveBeenCalledWith({
      where: { type: "purge_all", status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("getActiveJobs", () => {
  it("lists all queued/running jobs oldest-first", async () => {
    const db = fakeDb();
    await getActiveJobs(db as never);
    expect(db.job.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("recoverOrphanedJobs", () => {
  it("requeues any job left running (single-worker: must be orphaned)", async () => {
    const db = fakeDb({ updateMany: vi.fn().mockResolvedValue({ count: 2 }) });
    const n = await recoverOrphanedJobs(db as never);
    expect(db.job.updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: { status: "queued", startedAt: null },
    });
    expect(n).toBe(2);
  });
});

describe("markJobSucceeded / markJobFailed", () => {
  it("marks succeeded", async () => {
    const db = fakeDb();
    await markJobSucceeded(db as never, "j1");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "succeeded" }),
    });
  });

  it("marks failed with the error message", async () => {
    const db = fakeDb();
    await markJobFailed(db as never, "j1", "boom");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "failed", error: "boom" }),
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/queue.test.ts`
Expected: FAIL — cannot find module `./queue.js`.

- [ ] **Step 3: Implement**

Create `packages/jobs/src/queue.ts`:

```typescript
import type { Job, PrismaClient } from "@lumio/db";
import { ACTIVE_JOB_STATUSES, JobStatus, type JobType } from "@lumio/shared";

/** The slice of Prisma the queue helpers need (so tests can pass a mock). */
export type JobDb = Pick<PrismaClient, "job">;

/** The oldest in-flight (queued or running) job of a type, if any. */
export function findActiveJob(db: JobDb, type: JobType): Promise<Job | null> {
  return db.job.findFirst({
    where: { type, status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

/** Enqueue a job, de-duping against an already-active job of the same type. */
export async function enqueueJob(db: JobDb, type: JobType): Promise<Job> {
  const active = await findActiveJob(db, type);
  if (active) return active;
  return db.job.create({ data: { type } });
}

/** All in-flight jobs, oldest first — for the activity endpoint. */
export function getActiveJobs(db: JobDb): Promise<Job[]> {
  return db.job.findMany({
    where: { status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * On worker startup, any job still marked `running` is orphaned (a single
 * worker that just booted can't be running anything yet) — requeue it.
 */
export async function recoverOrphanedJobs(db: JobDb): Promise<number> {
  const { count } = await db.job.updateMany({
    where: { status: JobStatus.running },
    data: { status: JobStatus.queued, startedAt: null },
  });
  return count;
}

export async function markJobSucceeded(db: JobDb, id: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: { status: JobStatus.succeeded, finishedAt: new Date() },
  });
}

export async function markJobFailed(db: JobDb, id: string, error: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: { status: JobStatus.failed, error, finishedAt: new Date() },
  });
}
```

Note: `JobType`/`JobStatus` enum values ARE the matching strings (`JobStatus.running === "running"`), so the `Job.type`/`Job.status` columns being Prisma `String` accept them with no cast, and the test assertions below (which use string literals like `"running"`) still match by value.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/queue.ts packages/jobs/src/queue.test.ts
git commit -m "feat(jobs): queue helpers — enqueue/dedupe/list/recover/mark"
```

---

## Task 6: Atomic claim with `FOR UPDATE SKIP LOCKED` (`@lumio/jobs`)

**Files:**
- Modify: `packages/jobs/src/queue.ts`
- Modify: `packages/jobs/src/queue.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `packages/jobs/src/queue.test.ts` (and add `claimNextJob` to the import at the top):

```typescript
describe("claimNextJob", () => {
  it("returns the claimed row when one was queued", async () => {
    const row = { id: "j1", type: "rescan", status: "running" };
    const db = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    const job = await claimNextJob(db as never);
    expect(job).toBe(row);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns null when nothing was queued", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    expect(await claimNextJob(db as never)).toBeNull();
  });
});
```

Update the import line at the top of the file to include `claimNextJob`:

```typescript
import {
  claimNextJob,
  enqueueJob,
  findActiveJob,
  getActiveJobs,
  markJobFailed,
  markJobSucceeded,
  recoverOrphanedJobs,
} from "./queue.js";
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/queue.test.ts`
Expected: FAIL — `claimNextJob` is not exported.

- [ ] **Step 3: Implement**

In `packages/jobs/src/queue.ts`, widen the `JobDb` type to include `$queryRaw` and add the function. Replace the `JobDb` type line with:

```typescript
/** The slice of Prisma the queue helpers need (so tests can pass a mock). */
export type JobDb = Pick<PrismaClient, "job" | "$queryRaw">;
```

Add at the end of the file:

```typescript
/**
 * Atomically claim the oldest queued job, flipping it to `running`. Uses
 * `FOR UPDATE SKIP LOCKED` so the claim stays correct even if a second worker
 * is ever added (each gets a distinct row, never the same one). Returns the
 * claimed row, or null if the queue is empty.
 */
export async function claimNextJob(db: JobDb): Promise<Job | null> {
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'running', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'queued'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/queue.test.ts`
Expected: PASS (all queue tests, including the two new claim cases).

- [ ] **Step 5: Commit**

```bash
git add packages/jobs/src/queue.ts packages/jobs/src/queue.test.ts
git commit -m "feat(jobs): atomic claimNextJob via FOR UPDATE SKIP LOCKED"
```

---

## Task 7: Heartbeat + progress reporter (`@lumio/jobs`)

**Files:**
- Create: `packages/jobs/src/heartbeat.ts`
- Create: `packages/jobs/src/heartbeat.test.ts`
- Create: `packages/jobs/src/progress.ts`
- Create: `packages/jobs/src/progress.test.ts`

- [ ] **Step 1: Write the failing heartbeat test**

Create `packages/jobs/src/heartbeat.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { readWorkerStatus, writeHeartbeat } from "./heartbeat.js";

describe("writeHeartbeat", () => {
  it("upserts the singleton row with activity + jobId + timestamp", async () => {
    const db = { workerStatus: { upsert: vi.fn().mockResolvedValue({}) } };
    const now = new Date("2026-06-20T12:00:00.000Z");
    await writeHeartbeat(db as never, "watching", "j1", now);
    expect(db.workerStatus.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: { id: "singleton", lastSeenAt: now, activity: "watching", jobId: "j1" },
      update: { lastSeenAt: now, activity: "watching", jobId: "j1" },
    });
  });
});

describe("readWorkerStatus", () => {
  it("reads the singleton row", async () => {
    const db = { workerStatus: { findUnique: vi.fn().mockResolvedValue(null) } };
    await readWorkerStatus(db as never);
    expect(db.workerStatus.findUnique).toHaveBeenCalledWith({ where: { id: "singleton" } });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/heartbeat.test.ts`
Expected: FAIL — cannot find module `./heartbeat.js`.

- [ ] **Step 3: Implement the heartbeat**

Create `packages/jobs/src/heartbeat.ts`:

```typescript
import type { PrismaClient, WorkerStatus } from "@lumio/db";

export type HeartbeatDb = Pick<PrismaClient, "workerStatus">;

const SINGLETON_ID = "singleton";

/** Worker is considered offline if its heartbeat is older than this. */
export const WORKER_STALE_MS = 6000;

/** Upsert the single WorkerStatus row. The heartbeat loop is its sole writer. */
export async function writeHeartbeat(
  db: HeartbeatDb,
  activity: string,
  jobId: string | null,
  now: Date = new Date(),
): Promise<void> {
  await db.workerStatus.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, lastSeenAt: now, activity, jobId },
    update: { lastSeenAt: now, activity, jobId },
  });
}

export function readWorkerStatus(db: HeartbeatDb): Promise<WorkerStatus | null> {
  return db.workerStatus.findUnique({ where: { id: SINGLETON_ID } });
}
```

- [ ] **Step 4: Run the heartbeat test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/heartbeat.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing progress test**

Create `packages/jobs/src/progress.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createProgressReporter } from "./progress.js";

describe("createProgressReporter", () => {
  it("writes the first update and throttles writes within the interval", async () => {
    const db = { job: { update: vi.fn().mockResolvedValue({}) } };
    let clock = 1000;
    const report = createProgressReporter(db as never, "j1", {
      minIntervalMs: 250,
      now: () => clock,
    });

    await report(1, 10, "Scanning…"); // first → writes
    clock = 1100;
    await report(2, 10, null); // +100ms → throttled
    clock = 1300;
    await report(3, 10, null); // +300ms from last write → writes

    expect(db.job.update).toHaveBeenCalledTimes(2);
    expect(db.job.update).toHaveBeenNthCalledWith(1, {
      where: { id: "j1" },
      data: { processed: 1, total: 10, message: "Scanning…" },
    });
    expect(db.job.update).toHaveBeenNthCalledWith(2, {
      where: { id: "j1" },
      data: { processed: 3, total: 10, message: null },
    });
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/progress.test.ts`
Expected: FAIL — cannot find module `./progress.js`.

- [ ] **Step 7: Implement the progress reporter**

Create `packages/jobs/src/progress.ts`:

```typescript
import type { PrismaClient } from "@lumio/db";
import { shouldWrite } from "./predicates.js";

export type ProgressDb = Pick<PrismaClient, "job">;

/** Called by handlers to publish progress; signature is (processed, total, message). */
export type ProgressReporter = (
  processed: number,
  total: number | null,
  message: string | null,
) => Promise<void>;

export interface ProgressOptions {
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * A throttled progress writer for one job: writes the first update immediately,
 * then at most once per `minIntervalMs` so a large scan doesn't hammer Postgres.
 */
export function createProgressReporter(
  db: ProgressDb,
  jobId: string,
  options: ProgressOptions = {},
): ProgressReporter {
  const minIntervalMs = options.minIntervalMs ?? 250;
  const now = options.now ?? (() => Date.now());
  let lastAt: number | null = null;

  return async (processed, total, message) => {
    const t = now();
    if (!shouldWrite(lastAt, t, minIntervalMs)) return;
    lastAt = t;
    await db.job.update({ where: { id: jobId }, data: { processed, total, message } });
  };
}
```

- [ ] **Step 8: Run the progress test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/progress.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/jobs/src/heartbeat.ts packages/jobs/src/heartbeat.test.ts packages/jobs/src/progress.ts packages/jobs/src/progress.test.ts
git commit -m "feat(jobs): worker heartbeat + throttled progress reporter"
```

---

## Task 8: Relocate `purgeAllPhotos` + `purgeTrash` into `@lumio/jobs`

The worker needs to *run* these (it can't import from `apps/web`), so they move into the shared package with **required** deps. Web's selected-trash-purge route keeps calling `purgeTrash` (now from `@lumio/jobs`, passing explicit deps); web no longer calls `purgeAllPhotos` at all (the purge route becomes an enqueue in Task 12).

**Files:**
- Create: `packages/jobs/src/purge.ts`
- Create: `packages/jobs/src/purge.test.ts`
- Modify: `apps/web/src/lib/photos-service.ts` (remove `purgeAllPhotos` + `PurgeDeps`/`PurgeResult`)
- Modify: `apps/web/src/lib/trash-service.ts` (remove `purgeTrash`)
- Modify: `apps/web/src/lib/photos-service.test.ts` (remove the `purgeAllPhotos` tests — they move)
- Modify: `apps/web/src/lib/trash-service.test.ts` (remove the `purgeTrash` tests — they move)
- Modify: `apps/web/src/app/api/trash/purge/route.ts` (import from `@lumio/jobs`, pass deps)

- [ ] **Step 1: Write the failing purge test**

Create `packages/jobs/src/purge.test.ts`:

```typescript
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { purgeAllPhotos, purgeTrash } from "./purge.js";

async function photoDirs() {
  const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
  const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
  await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
  await mkdir(path.join(cacheDir, "displays"), { recursive: true });
  return { photosDir, cacheDir };
}

describe("purgeAllPhotos", () => {
  it("removes originals + renditions then deletes every row", async () => {
    const { photosDir, cacheDir } = await photoDirs();
    await writeFile(path.join(photosDir, "a.jpg"), "orig");
    await writeFile(path.join(cacheDir, "thumbnails", "a.webp"), "t");
    await writeFile(path.join(cacheDir, "displays", "a.webp"), "d");

    const db = {
      photo: {
        findMany: vi.fn().mockResolvedValue([{ id: "a", path: "a.jpg" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await purgeAllPhotos({ db: db as never, photosDir, cacheDir });

    expect(result).toEqual({ deleted: 1 });
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(false);
    expect(existsSync(path.join(cacheDir, "thumbnails", "a.webp"))).toBe(false);
    expect(db.photo.deleteMany).toHaveBeenCalledWith({});
  });
});

describe("purgeTrash", () => {
  it("removes trashed files (all) and deletes the rows", async () => {
    const trashDir = await mkdtemp(path.join(tmpdir(), "lumio-trash-"));
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(trashDir, "displays"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "t");

    const db = {
      trashedPhoto: {
        findMany: vi.fn().mockResolvedValue([{ id: "a", originalPath: "a.jpg" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await purgeTrash(undefined, { db: db as never, trashDir });

    expect(result).toEqual({ deleted: 1 });
    expect(await readdir(path.join(trashDir, "originals"))).toEqual([]);
    expect(db.trashedPhoto.deleteMany).toHaveBeenCalledWith({ where: {} });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/purge.test.ts`
Expected: FAIL — cannot find module `./purge.js`.

- [ ] **Step 3: Implement the relocated functions**

Create `packages/jobs/src/purge.ts`:

```typescript
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";

export interface PurgeAllDeps {
  db: Pick<PrismaClient, "photo">;
  photosDir: string;
  cacheDir: string;
}

/**
 * Danger zone: delete every photo from the database and the filesystem,
 * including originals and cached thumbnails/displays. Files are removed
 * best-effort (missing files ignored) before the rows, so a rescan won't
 * re-import originals that survived a wipe.
 */
export async function purgeAllPhotos(deps: PurgeAllDeps): Promise<{ deleted: number }> {
  const photos = await deps.db.photo.findMany({ select: { id: true, path: true } });
  await Promise.all(
    photos.flatMap((p) => [
      rm(path.join(deps.photosDir, p.path), { force: true }),
      rm(path.join(deps.cacheDir, "thumbnails", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays", `${p.id}.webp`), { force: true }),
    ]),
  );
  const { count } = await deps.db.photo.deleteMany({});
  return { deleted: count };
}

export interface PurgeTrashDeps {
  db: Pick<PrismaClient, "trashedPhoto">;
  trashDir: string;
}

/** Permanently remove trashed photos (all when `ids` is undefined) + their files. */
export async function purgeTrash(
  ids: string[] | undefined,
  deps: PurgeTrashDeps,
): Promise<{ deleted: number }> {
  const where = ids ? { id: { in: ids } } : {};
  const rows = await deps.db.trashedPhoto.findMany({
    where,
    select: { id: true, originalPath: true },
  });
  await Promise.all(
    rows.flatMap((r) => {
      const ext = path.extname(r.originalPath);
      return [
        rm(path.join(deps.trashDir, "originals", `${r.id}${ext}`), { force: true }),
        rm(path.join(deps.trashDir, "thumbnails", `${r.id}.webp`), { force: true }),
        rm(path.join(deps.trashDir, "displays", `${r.id}.webp`), { force: true }),
      ];
    }),
  );
  const { count } = await deps.db.trashedPhoto.deleteMany({ where });
  return { deleted: count };
}
```

- [ ] **Step 4: Run the purge test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/purge.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove `purgeAllPhotos` from `photos-service.ts`**

In `apps/web/src/lib/photos-service.ts`, delete the `PurgeDeps` interface, the `PurgeResult` interface, and the entire `purgeAllPhotos` function (lines ~131–163). Also remove the now-unused imports: `rm` from `node:fs/promises`, `path` from `node:path`, and `CACHE_DIR`/`PHOTOS_DIR` from `@/lib/paths` — **only if** no other code in the file uses them (grep the file; if `path`/`rm`/those constants are unused after the deletion, remove them from the import lines).

- [ ] **Step 6: Remove `purgeTrash` from `trash-service.ts`**

In `apps/web/src/lib/trash-service.ts`, delete the entire `purgeTrash` function (lines ~187–208). Leave `trashPhotos`, `restorePhotos`, `listTrash`, and the `moveFile`/`freePath` helpers untouched.

- [ ] **Step 7: Move the corresponding tests out of web**

In `apps/web/src/lib/photos-service.test.ts`, delete the `describe("purgeAllPhotos", …)` block (and any helper used only by it). In `apps/web/src/lib/trash-service.test.ts`, delete the `describe("purgeTrash", …)` block. (Coverage for both now lives in `packages/jobs/src/purge.test.ts`.)

- [ ] **Step 8: Repoint the selected-trash-purge route**

Only two lines of the existing route change: the `purgeTrash` import (now `@lumio/jobs`, plus `prisma` + `TRASH_DIR`) and the call (pass explicit deps). Replace `apps/web/src/app/api/trash/purge/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { purgeTrash } from "@lumio/jobs";
import { photoIdsSchema } from "@lumio/shared";
import { TRASH_DIR } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await purgeTrash(parsed.data.ids, { db: prisma, trashDir: TRASH_DIR });
  return NextResponse.json(result);
});
```

- [ ] **Step 9: Run the affected test suites**

Run: `pnpm --filter @lumio/jobs test && pnpm --filter @lumio/web test`
Expected: PASS — web suites green without the moved blocks; jobs suite green with the relocated purge tests.

- [ ] **Step 10: Commit**

```bash
git add packages/jobs/src/purge.ts packages/jobs/src/purge.test.ts apps/web/src/lib/photos-service.ts apps/web/src/lib/trash-service.ts apps/web/src/lib/photos-service.test.ts apps/web/src/lib/trash-service.test.ts apps/web/src/app/api/trash/purge/route.ts
git commit -m "refactor(jobs): relocate purgeAllPhotos + purgeTrash into @lumio/jobs"
```

---

## Task 9: Job consumer — `processNextJob` + `runJobConsumer` (`@lumio/jobs`)

**Files:**
- Create: `packages/jobs/src/consumer.ts`
- Create: `packages/jobs/src/consumer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/jobs/src/consumer.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import { processNextJob } from "./consumer.js";

function dbWithClaim(row: unknown) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(row ? [row] : []),
    job: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe("processNextJob", () => {
  it("returns 'empty' and runs nothing when the queue is empty", async () => {
    const db = dbWithClaim(null);
    const handler = vi.fn();
    const result = await processNextJob(db as never, { [JobType.rescan]: handler }, {});
    expect(result).toBe("empty");
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the matching handler and marks the job succeeded", async () => {
    const db = dbWithClaim({ id: "j1", type: "rescan", status: "running" });
    const handler = vi.fn().mockResolvedValue(undefined);
    const onClaim = vi.fn();
    const onSettle = vi.fn();

    const result = await processNextJob(db as never, { [JobType.rescan]: handler }, { onClaim, onSettle });

    expect(result).toBe("ran");
    expect(handler).toHaveBeenCalledOnce();
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(onSettle).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "succeeded" }),
    });
  });

  it("marks the job failed when the handler throws, and still settles", async () => {
    const db = dbWithClaim({ id: "j2", type: "purge_all", status: "running" });
    const handler = vi.fn().mockRejectedValue(new Error("kaboom"));
    const onSettle = vi.fn();

    const result = await processNextJob(db as never, { [JobType.purge_all]: handler }, { onSettle });

    expect(result).toBe("ran");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j2" },
      data: expect.objectContaining({ status: "failed", error: "kaboom" }),
    });
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it("fails the job when there is no handler for its type", async () => {
    const db = dbWithClaim({ id: "j3", type: "rescan", status: "running" });
    const result = await processNextJob(db as never, {}, {});
    expect(result).toBe("ran");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j3" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/jobs exec vitest run src/consumer.test.ts`
Expected: FAIL — cannot find module `./consumer.js`.

- [ ] **Step 3: Implement**

Create `packages/jobs/src/consumer.ts`:

```typescript
import type { Job } from "@lumio/db";
import type { JobType } from "@lumio/shared";
import { createProgressReporter, type ProgressReporter } from "./progress.js";
import { claimNextJob, type JobDb, markJobFailed, markJobSucceeded } from "./queue.js";

/** One handler per job type; receives a throttled progress reporter. */
export type JobHandler = (report: ProgressReporter) => Promise<void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export interface ConsumerOptions {
  onClaim?: (job: Job) => void;
  onSettle?: (job: Job) => void;
  signal?: AbortSignal;
  idleMs?: number;
}

/** Sleep that resolves early if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Claim and run one job. Returns "empty" if nothing was queued, "ran" otherwise.
 * Always marks the job (succeeded/failed) and calls onSettle, even on throw.
 */
export async function processNextJob(
  db: JobDb,
  handlers: JobHandlers,
  options: ConsumerOptions,
): Promise<"ran" | "empty"> {
  const job = await claimNextJob(db);
  if (!job) return "empty";

  options.onClaim?.(job);
  try {
    const handler = handlers[job.type as JobType];
    if (!handler) throw new Error(`No handler for job type: ${job.type}`);
    const report = createProgressReporter(db, job.id);
    await handler(report);
    await markJobSucceeded(db, job.id);
  } catch (err) {
    await markJobFailed(db, job.id, (err as Error).message);
  } finally {
    options.onSettle?.(job);
  }
  return "ran";
}

/**
 * The worker's job loop: drain the queue, sleeping `idleMs` whenever it's empty,
 * until the abort signal fires. A claim/run error never kills the loop.
 */
export async function runJobConsumer(
  db: JobDb,
  handlers: JobHandlers,
  options: ConsumerOptions,
): Promise<void> {
  const { signal, idleMs = 1000 } = options;
  while (!signal?.aborted) {
    const result = await processNextJob(db, handlers, options).catch(() => "empty" as const);
    if (result === "empty") await sleep(idleMs, signal);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/jobs exec vitest run src/consumer.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Typecheck the whole package**

Run: `pnpm --filter @lumio/jobs typecheck && pnpm --filter @lumio/jobs test`
Expected: no type errors; all suites green.

- [ ] **Step 6: Commit**

```bash
git add packages/jobs/src/consumer.ts packages/jobs/src/consumer.test.ts
git commit -m "feat(jobs): job consumer (processNextJob + runJobConsumer)"
```

---

## Task 10: Worker — activity state, scan progress, handler registry

**Files:**
- Create: `apps/worker/src/activity.ts`
- Create: `apps/worker/src/handlers.ts`
- Create: `apps/worker/src/handlers.test.ts`
- Modify: `apps/worker/src/config.ts` (add `TRASH_DIR`)
- Modify: `apps/worker/src/scan.ts` (add `onProgress`)

- [ ] **Step 1: Add `TRASH_DIR` to worker config**

In `apps/worker/src/config.ts`, after the `DISPLAYS_DIR` export (line ~25), add:

```typescript
/** Absolute path to the trash root (mirrors the cache layout). */
export const TRASH_DIR = resolveFromRoot(process.env.TRASH_DIR, "./trash");
```

- [ ] **Step 2: Thread an optional progress callback through the scan**

In `apps/worker/src/scan.ts`, change the `scanAndIngest` signature and report progress as files complete. Replace the function header and the processing pool:

Change the signature line:

```typescript
export async function scanAndIngest(
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
```

Immediately after `const byPath = new Map(...)` (just before the `await runPool(relPaths.length, …)` call), add:

```typescript
  let done = 0;
```

Inside that `runPool` task callback, add a progress tick as the **last line of the task body** (after the `try/catch`, so it fires whether the file was processed, skipped-unchanged, or errored):

```typescript
    onProgress?.(++done, relPaths.length);
```

Concretely, the task callback becomes:

```typescript
  await runPool(relPaths.length, INGEST_CONCURRENCY, async (i) => {
    const relPath = relPaths[i]!;
    try {
      const st = await stat(path.join(PHOTOS_DIR, relPath));
      const row = byPath.get(relPath);
      let cacheExists = false;
      if (row) {
        cacheExists =
          (await fileExists(thumbnailPath(row.id))) &&
          (await fileExists(displayPath(row.id)));
      }
      if (isUnchanged(row, st, cacheExists)) {
        summary.skippedUnchanged++;
        return;
      }
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
    } catch (err) {
      summary.skipped++;
      console.warn(`skip ${relPath}: ${(err as Error).message}`);
    } finally {
      onProgress?.(++done, relPaths.length);
    }
  });
```

(Using `finally` guarantees the tick even on the early `return` from the unchanged branch.)

- [ ] **Step 3: Create the in-process activity state**

Create `apps/worker/src/activity.ts`:

```typescript
import type { ActivityState } from "@lumio/jobs";

/**
 * Mutable in-process activity, shared between the watcher (which bumps
 * `importing` while ingesting new files) and the heartbeat loop (which reads it).
 * The job consumer sets `currentJob` on claim and clears it on settle.
 */
export const activity: ActivityState = { importing: 0, currentJob: null };
```

- [ ] **Step 4: Write the failing handler-registry test**

Create `apps/worker/src/handlers.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import { buildHandlers } from "./handlers.js";

describe("buildHandlers", () => {
  it("rescan forwards scan progress to the reporter", async () => {
    const scan = vi.fn(async (onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
    });
    const handlers = buildHandlers({
      scan,
      purgeAll: vi.fn(),
      emptyTrash: vi.fn(),
    });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.rescan](report);

    expect(scan).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(1, 2, "Scanning…");
    expect(report).toHaveBeenCalledWith(2, 2, "Scanning…");
  });

  it("purge_all runs the purge and reports the final count", async () => {
    const purgeAll = vi.fn().mockResolvedValue({ deleted: 7 });
    const handlers = buildHandlers({ scan: vi.fn(), purgeAll, emptyTrash: vi.fn() });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.purge_all](report);

    expect(purgeAll).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(7, 7, null);
  });

  it("empty_trash runs the purge and reports the final count", async () => {
    const emptyTrash = vi.fn().mockResolvedValue({ deleted: 3 });
    const handlers = buildHandlers({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.empty_trash](report);

    expect(emptyTrash).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(3, 3, null);
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `pnpm --filter @lumio/worker exec vitest run src/handlers.test.ts`
Expected: FAIL — cannot find module `./handlers.js`.

- [ ] **Step 6: Implement the handler registry**

Create `apps/worker/src/handlers.ts` (uses computed enum keys — a `Record<JobType, …>` from a string enum is satisfied with `[JobType.x]:` keys):

```typescript
import { prisma } from "@lumio/db";
import { type JobHandlers, purgeAllPhotos, purgeTrash } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { CACHE_DIR, PHOTOS_DIR, TRASH_DIR } from "./config.js";
import { scanAndIngest } from "./scan.js";

/** Injectable seams so the registry is unit-testable without a DB/filesystem. */
export interface HandlerDeps {
  scan: (onProgress?: (done: number, total: number) => void) => Promise<unknown>;
  purgeAll: () => Promise<{ deleted: number }>;
  emptyTrash: () => Promise<{ deleted: number }>;
}

const defaultDeps: HandlerDeps = {
  scan: scanAndIngest,
  purgeAll: () => purgeAllPhotos({ db: prisma, photosDir: PHOTOS_DIR, cacheDir: CACHE_DIR }),
  emptyTrash: () => purgeTrash(undefined, { db: prisma, trashDir: TRASH_DIR }),
};

/** The worker's job handlers, keyed by job type. */
export function buildHandlers(deps: HandlerDeps = defaultDeps): Required<JobHandlers> {
  return {
    [JobType.rescan]: async (report) => {
      await deps.scan((done, total) => {
        void report(done, total, "Scanning…");
      });
    },
    [JobType.purge_all]: async (report) => {
      await report(0, null, "Deleting all photos…");
      const { deleted } = await deps.purgeAll();
      await report(deleted, deleted, null);
    },
    [JobType.empty_trash]: async (report) => {
      await report(0, null, "Emptying trash…");
      const { deleted } = await deps.emptyTrash();
      await report(deleted, deleted, null);
    },
  };
}
```

- [ ] **Step 7: Run the handler test to confirm it passes**

Run: `pnpm --filter @lumio/worker exec vitest run src/handlers.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/activity.ts apps/worker/src/handlers.ts apps/worker/src/handlers.test.ts apps/worker/src/config.ts apps/worker/src/scan.ts
git commit -m "feat(worker): activity state, scan progress callback, handler registry"
```

---

## Task 11: Worker — start orchestration (heartbeat + consumer + watcher)

The watcher loses its self-owned shutdown/`process.exit` so a single orchestrator can run all three concurrent loops and own graceful shutdown.

**Files:**
- Modify: `apps/worker/src/watch.ts` (accept a signal, bump activity, return the watcher, drop self-shutdown)
- Create: `apps/worker/src/start.ts`
- Modify: `apps/worker/src/watch-main.ts` (call `startWorker`)

- [ ] **Step 1: Refactor `watch.ts` to `startWatcher(signal)`**

Replace `apps/worker/src/watch.ts` with:

```typescript
import path from "node:path";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { activity } from "./activity.js";
import { PHOTOS_DIR } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { scanAndIngest } from "./scan.js";

const isSupported = (p: string): boolean =>
  SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

/**
 * Initial scan + continuous watch. Bumps `activity.importing` while ingesting
 * new files so the heartbeat can surface steady-state import activity. Returns
 * the watcher so the caller owns shutdown; never calls process.exit itself.
 */
export async function startWatcher(signal: AbortSignal): Promise<FSWatcher> {
  const initial = await scanAndIngest();
  console.log(`Initial scan — processed ${initial.processed}, removed ${initial.removed}`);

  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    activity.importing++;
    try {
      await ingestPath(rel, ingestDeps);
      console.log(`+ ${rel}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    } finally {
      activity.importing--;
    }
  };

  watcher
    .on("add", upsert)
    .on("change", upsert)
    .on("unlink", async (abs: string) => {
      if (!isSupported(abs)) return;
      const rel = path.relative(PHOTOS_DIR, abs);
      try {
        await removePath(rel, removeDeps);
        console.log(`- ${rel}`);
      } catch (err) {
        console.warn(`remove failed ${rel}: ${(err as Error).message}`);
      }
    })
    .on("error", (err) => console.error(`watcher error: ${String(err)}`));

  console.log(`Watching ${PHOTOS_DIR} …`);
  signal.addEventListener("abort", () => void watcher.close(), { once: true });
  return watcher;
}
```

- [ ] **Step 2: Create the orchestrator**

Create `apps/worker/src/start.ts`:

```typescript
import { prisma } from "@lumio/db";
import {
  formatActivity,
  recoverOrphanedJobs,
  runJobConsumer,
  sleep,
  writeHeartbeat,
} from "@lumio/jobs";
import { activity } from "./activity.js";
import { buildHandlers } from "./handlers.js";
import { startWatcher } from "./watch.js";

const HEARTBEAT_MS = 2000;

/**
 * Boot the worker: requeue orphaned jobs, then run the heartbeat loop, the job
 * consumer, and the file watcher concurrently until a shutdown signal arrives.
 */
export async function startWorker(): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;

  await recoverOrphanedJobs(prisma);

  const heartbeat = (async () => {
    while (!signal.aborted) {
      await writeHeartbeat(
        prisma,
        formatActivity(activity),
        activity.currentJob?.id ?? null,
      ).catch((err) => console.warn(`heartbeat failed: ${(err as Error).message}`));
      await sleep(HEARTBEAT_MS, signal);
    }
  })();

  const consumer = runJobConsumer(prisma, buildHandlers(), {
    signal,
    onClaim: (job) => {
      activity.currentJob = { id: job.id, type: job.type };
    },
    onSettle: () => {
      activity.currentJob = null;
    },
  });

  await startWatcher(signal);

  const shutdown = async (): Promise<void> => {
    controller.abort();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await Promise.all([heartbeat, consumer]);
}
```

- [ ] **Step 3: Point the entrypoint at the orchestrator**

Replace `apps/worker/src/watch-main.ts` with:

```typescript
import { bootstrapWorker } from "./runtime.js";

// See runtime.ts: tune threadpool / Sharp / priority before Sharp or fs load.
await bootstrapWorker();

const { startWorker } = await import("./start.js");

startWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck the worker**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: no errors. (If `FSWatcher` isn't exported from `chokidar` in this version, change the return type to `Awaited<ReturnType<typeof chokidar.watch>>` and re-run.)

- [ ] **Step 5: Smoke-test the worker boots**

With the dev DB up (`pnpm db:up`), run the worker briefly:

```bash
timeout 8 pnpm --filter @lumio/worker watch || true
```

Expected: logs "Initial scan — …" then "Watching …"; no crash. Then verify the heartbeat row was written:

```bash
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma db execute --stdin <<'SQL'
SELECT id, activity FROM "WorkerStatus";
SQL
```

Expected: one `singleton` row with activity `watching` (or `idle`). (If `prisma db execute` is awkward, skip this sub-check; the typecheck + boot log is sufficient.)

- [ ] **Step 6: Run worker tests**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS (existing `scan.test.ts`, `config.test.ts`, `pool.test.ts`, plus new `handlers.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/watch.ts apps/worker/src/start.ts apps/worker/src/watch-main.ts
git commit -m "feat(worker): orchestrate heartbeat + job consumer + watcher"
```

---

## Task 12: Web — enqueue routes (rescan, purge, empty)

**Files:**
- Modify: `apps/web/src/app/api/rescan/route.ts`
- Modify: `apps/web/src/app/api/photos/purge/route.ts`
- Modify: `apps/web/src/app/api/trash/empty/route.ts`

- [ ] **Step 1: Rewrite the rescan route to enqueue**

Replace `apps/web/src/app/api/rescan/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const job = await enqueueJob(prisma, JobType.rescan);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
```

- [ ] **Step 2: Rewrite the purge-all route to enqueue**

Replace `apps/web/src/app/api/photos/purge/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const job = await enqueueJob(prisma, JobType.purge_all);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
```

- [ ] **Step 3: Rewrite the empty-trash route to enqueue**

Replace `apps/web/src/app/api/trash/empty/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const job = await enqueueJob(prisma, JobType.empty_trash);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
```

- [ ] **Step 4: Typecheck web**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` (or `pnpm --filter @lumio/web lint` if no typecheck script).
Expected: no errors — the old `purgeAllPhotos`/`purgeTrash` imports are gone, `spawn`/`ROOT` no longer referenced here.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/rescan/route.ts apps/web/src/app/api/photos/purge/route.ts apps/web/src/app/api/trash/empty/route.ts
git commit -m "feat(web): rescan/purge/empty routes enqueue jobs instead of running them"
```

---

## Task 13: Web — `GET /api/activity`

**Files:**
- Create: `apps/web/src/app/api/activity/route.ts`

- [ ] **Step 1: Implement the route**

(Coverage for the payload shape already exists in `packages/jobs/src/predicates.test.ts` via `buildActivitySnapshot`; this route is thin glue.)

Create `apps/web/src/app/api/activity/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import {
  WORKER_STALE_MS,
  buildActivitySnapshot,
  getActiveJobs,
  readWorkerStatus,
} from "@lumio/jobs";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const [worker, jobs] = await Promise.all([
    readWorkerStatus(prisma),
    getActiveJobs(prisma),
  ]);
  const snapshot = buildActivitySnapshot(worker, jobs, new Date(), WORKER_STALE_MS);
  return NextResponse.json(snapshot);
});
```

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify the endpoint (worker + web running)**

With the dev DB + worker running and the web dev server up (`pnpm dev`), hit the endpoint while authenticated (or temporarily check the shape via the browser devtools network tab after Task 15 wires the hook). Expected JSON: `{ "worker": { "online": true, "activity": "watching" }, "jobs": [] }`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/activity/route.ts
git commit -m "feat(web): GET /api/activity returns worker + active-jobs snapshot"
```

---

## Task 14: Web — `useActivity()` polling hook

**Files:**
- Create: `apps/web/src/lib/poll-interval.ts`
- Create: `apps/web/src/lib/poll-interval.test.ts`
- Create: `apps/web/src/lib/use-activity.ts`

The polling cadence is a client/UI concern, so it lives in the web app (not `@lumio/jobs`, which is server-only — it pulls in Prisma + `node:fs` and must never reach a client bundle). The hook imports only the `ActivitySnapshot` **type** from `@lumio/shared` (client-safe).

- [ ] **Step 1: Write the failing cadence test**

Create `apps/web/src/lib/poll-interval.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pollInterval } from "./poll-interval.js";

describe("pollInterval", () => {
  it("pauses on a hidden tab", () => {
    expect(pollInterval(true, true)).toBeNull();
  });
  it("polls fast when a job is active", () => {
    expect(pollInterval(true, false)).toBe(1500);
  });
  it("polls slow when idle", () => {
    expect(pollInterval(false, false)).toBe(5000);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/poll-interval.test.ts`
Expected: FAIL — cannot find module `./poll-interval.js`.

- [ ] **Step 3: Implement the cadence helper**

Create `apps/web/src/lib/poll-interval.ts`:

```typescript
/** Poll cadence (ms): null = paused (hidden tab); fast when active, slow when idle. */
export function pollInterval(hasActive: boolean, hidden: boolean): number | null {
  if (hidden) return null;
  return hasActive ? 1500 : 5000;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/poll-interval.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the hook**

Create `apps/web/src/lib/use-activity.ts`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivitySnapshot } from "@lumio/shared";
import { pollInterval } from "@/lib/poll-interval";

const EMPTY: ActivitySnapshot = { worker: { online: false, activity: "offline" }, jobs: [] };

/**
 * Poll GET /api/activity with an adaptive cadence: fast (~1.5s) while a job is
 * active, slow (~5s) when idle, paused on a hidden tab. This is the single seam
 * to later swap for an SSE/LISTEN-NOTIFY stream without touching consumers.
 */
export function useActivity(): ActivitySnapshot {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>(EMPTY);
  // Keep the latest snapshot in a ref so the scheduler can read it without
  // re-subscribing the effect on every poll.
  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/activity", { cache: "no-store" });
        if (res.ok && !cancelled) setSnapshot(await res.json());
      } catch {
        // transient — keep the last snapshot, try again next tick
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      const hidden = typeof document !== "undefined" && document.hidden;
      const hasActive = latest.current.jobs.length > 0;
      const ms = pollInterval(hasActive, hidden);
      if (ms === null) return; // paused; visibilitychange will restart it
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
  }, []);

  return snapshot;
}
```

- [ ] **Step 6: Typecheck web**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/poll-interval.ts apps/web/src/lib/poll-interval.test.ts apps/web/src/lib/use-activity.ts
git commit -m "feat(web): useActivity() adaptive polling hook"
```

---

## Task 15: Web — sidebar aperture activity indicator + button wiring

**Files:**
- Create: `apps/web/src/lib/activity-display.ts`
- Create: `apps/web/src/lib/activity-display.test.ts`
- Create: `apps/web/src/components/worker-activity.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`
- Modify: `apps/web/src/app/(app)/settings/rescan-button.tsx`
- Modify: `apps/web/src/app/(app)/settings/danger-zone.tsx`

- [ ] **Step 1: Write the failing display-logic test**

Create `apps/web/src/lib/activity-display.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { type ActivitySnapshot, JobStatus, JobType } from "@lumio/shared";
import { activityLabel, isBusy } from "./activity-display.js";

const snap = (over: Partial<ActivitySnapshot>): ActivitySnapshot => ({
  worker: { online: true, activity: "watching" },
  jobs: [],
  ...over,
});

describe("isBusy", () => {
  it("is busy when a job is active", () => {
    expect(isBusy(snap({ jobs: [{ id: "j", type: JobType.rescan, status: JobStatus.running, total: 10, processed: 3, message: null, error: null }] }))).toBe(true);
  });
  it("is busy when the watcher is importing", () => {
    expect(isBusy(snap({ worker: { online: true, activity: "importing 5" } }))).toBe(true);
  });
  it("is idle when watching with no jobs", () => {
    expect(isBusy(snap({}))).toBe(false);
  });
});

describe("activityLabel", () => {
  it("shows job progress with a count when total is known", () => {
    expect(
      activityLabel(snap({ jobs: [{ id: "j", type: JobType.rescan, status: JobStatus.running, total: 1200, processed: 340, message: null, error: null }] })),
    ).toBe("Rescanning 340/1,200");
  });
  it("labels purge + empty jobs", () => {
    expect(activityLabel(snap({ jobs: [{ id: "j", type: JobType.purge_all, status: JobStatus.running, total: null, processed: 0, message: null, error: null }] }))).toBe("Deleting all photos…");
    expect(activityLabel(snap({ jobs: [{ id: "j", type: JobType.empty_trash, status: JobStatus.running, total: null, processed: 0, message: null, error: null }] }))).toBe("Emptying trash…");
  });
  it("falls back to the worker activity when no job is active", () => {
    expect(activityLabel(snap({ worker: { online: true, activity: "importing 5" } }))).toBe("Importing 5 photos");
    expect(activityLabel(snap({}))).toBe("Worker online");
    expect(activityLabel(snap({ worker: { online: false, activity: "offline" } }))).toBe("Worker offline");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/activity-display.test.ts`
Expected: FAIL — cannot find module `./activity-display.js`.

- [ ] **Step 3: Implement the display logic**

Create `apps/web/src/lib/activity-display.ts`:

```typescript
import { type ActivitySnapshot, type JobDTO, JobType } from "@lumio/shared";

/** The job the indicator should foreground (the first active one), if any. */
function activeJob(snapshot: ActivitySnapshot): JobDTO | undefined {
  return snapshot.jobs[0];
}

/** Busy = a job is running/queued, or the watcher is importing new files. */
export function isBusy(snapshot: ActivitySnapshot): boolean {
  if (snapshot.jobs.length > 0) return true;
  return snapshot.worker.activity.startsWith("importing");
}

const JOB_VERB: Record<JobType, string> = {
  [JobType.rescan]: "Rescanning",
  [JobType.purge_all]: "Deleting all photos…",
  [JobType.empty_trash]: "Emptying trash…",
};

/** Human label for the sidebar tooltip / aria-label. */
export function activityLabel(snapshot: ActivitySnapshot): string {
  const job = activeJob(snapshot);
  if (job) {
    if (job.type === JobType.rescan) {
      return job.total != null
        ? `Rescanning ${job.processed.toLocaleString("en-US")}/${job.total.toLocaleString("en-US")}`
        : "Rescanning…";
    }
    return JOB_VERB[job.type];
  }
  const importing = snapshot.worker.activity.match(/^importing (\d+)$/);
  if (importing) return `Importing ${importing[1]} photos`;
  return snapshot.worker.online ? "Worker online" : "Worker offline";
}
```

- [ ] **Step 4: Run the display test to confirm it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/activity-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the indicator component**

Create `apps/web/src/components/worker-activity.tsx`:

```tsx
"use client";

import { Logo } from "@/components/logo";
import { activityLabel, isBusy } from "@/lib/activity-display";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";

/**
 * The sidebar brand mark doubling as the worker activity indicator: the aperture
 * spins while the worker is busy, and a corner dot shows online/offline. The
 * label is exposed via title/aria for hover + screen readers.
 */
export function WorkerActivity() {
  const snapshot = useActivity();
  const busy = isBusy(snapshot);
  const online = snapshot.worker.online;
  const label = activityLabel(snapshot);

  return (
    <span className="relative inline-flex" title={label} aria-label={label}>
      <Logo
        className={cn(
          "h-7 w-7 transition-transform duration-500 ease-out",
          busy ? "animate-spin [animation-duration:2.4s]" : "group-hover:rotate-90",
        )}
      />
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background transition-colors",
          online ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
    </span>
  );
}
```

- [ ] **Step 6: Mount it in the sidebar**

In `apps/web/src/components/app-sidebar.tsx`, replace the `<Logo … />` usage inside the brand `<Link>` (lines ~50–57) with the indicator. Change the import block to add `WorkerActivity` and drop the now-unused `Logo` import **only if** `Logo` is no longer referenced elsewhere in the file (it isn't — the back-button branch uses `ArrowLeft`). Update:

```tsx
import { WorkerActivity } from "@/components/worker-activity";
```

(remove `import { Logo } from "@/components/logo";`)

And the brand link becomes (add `group` so the hover-rotate fallback still works):

```tsx
        <Link
          href="/photos"
          title="Lumio"
          className="group mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground"
        >
          <WorkerActivity />
          <span className="sr-only">Lumio</span>
        </Link>
```

- [ ] **Step 7: Wire the rescan button to the async flow**

The route now returns `202 { jobId }` immediately; the aperture shows progress. Update `apps/web/src/app/(app)/settings/rescan-button.tsx` so it stops faking a 1.5s timer and instead relies on the response. Replace the `rescan` function body and keep the rest:

```tsx
  async function rescan() {
    setState("running");
    try {
      const res = await fetch("/api/rescan", { method: "POST" });
      if (!res.ok) throw new Error(`Rescan failed: ${res.status}`);
      // The worker now owns progress (watch the sidebar aperture). Re-enable the
      // button shortly; the catalog refreshes as rows land.
      setTimeout(() => {
        setState("idle");
        router.refresh();
      }, 1000);
    } catch {
      setState("error");
    }
  }
```

(Behaviorally close to before, but now truthful: the request returns at once and the worker does the work. The button copy "Rescanning…" still reads correctly.)

- [ ] **Step 8: Wire the delete-all dialog to the async flow**

In `apps/web/src/app/(app)/settings/danger-zone.tsx`, the purge route now returns `202` and the deletion runs in the worker. Update `deleteAll` so it closes the dialog on the 202 and lets the sidebar show progress:

```tsx
  async function deleteAll() {
    setState("deleting");
    try {
      const res = await fetch("/api/photos/purge", { method: "POST" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setOpen(false);
      reset();
      // Deletion proceeds in the worker; refresh shortly so counts catch up.
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setState("error");
    }
  }
```

- [ ] **Step 9: Typecheck + run web tests**

Run: `pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web test`
Expected: no type errors; all suites green.

- [ ] **Step 10: Browser-verify the indicator**

With DB + worker + web running, open the app. Expected: the sidebar aperture shows a green corner dot (worker online). Drop a photo into `photos/` (or click "Rescan now" in Settings) and watch the aperture spin; hover shows the progress label (e.g. "Rescanning 12/40"). When idle, it stops and reverts to hover-rotate.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/activity-display.ts apps/web/src/lib/activity-display.test.ts apps/web/src/components/worker-activity.tsx apps/web/src/components/app-sidebar.tsx apps/web/src/app/(app)/settings/rescan-button.tsx apps/web/src/app/(app)/settings/danger-zone.tsx
git commit -m "feat(web): sidebar aperture activity indicator + async button wiring"
```

---

## Task 16: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck sweep**

Run: `pnpm -r test`
Expected: every package's suite passes (`@lumio/shared`, `@lumio/db`, `@lumio/ingest`, `@lumio/jobs`, `@lumio/web`, `@lumio/worker`).

Run typechecks: `pnpm --filter @lumio/jobs typecheck && pnpm --filter @lumio/worker typecheck && pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/db typecheck && pnpm --filter @lumio/shared typecheck`
Expected: no errors.

- [ ] **Step 2: End-to-end manual smoke (DB + worker + web)**

1. `pnpm db:up`, start worker (`pnpm --filter @lumio/worker watch`), start web (`pnpm dev`).
2. Sidebar aperture shows online (green dot).
3. Settings → "Rescan now": aperture spins, hover shows progress, button re-enables.
4. Settings → "Delete all photos" (type DELETE): dialog closes immediately (202), aperture shows "Deleting all photos…", grid empties after refresh.
5. Trash → "Empty trash": same async behavior.
6. Stop the worker; within ~6s the sidebar dot goes gray ("Worker offline"). Enqueue a rescan; restart the worker; it claims the queued job and runs it (orphan-recovery + claim both exercised).

- [ ] **Step 3: Commit any final touch-ups, then finish the branch**

If everything passes, the feature is complete. Use the `superpowers:finishing-a-development-branch` skill to decide on merge/PR.

---

## Notes & deferred (per spec Non-Goals)

- **No Redis** — Postgres is the queue, progress store, and (future) push channel.
- **Cancellation, job-history page, retries UI** — the `Job` model supports them (status `canceled`, persisted rows, `error`) but no UI is built now.
- **Push transport** — `useActivity()` is the single seam; swap its `fetch` loop for an `EventSource` backed by `LISTEN/NOTIFY` later with no consumer changes.
- **Serial execution** — one job at a time; the claim is already multi-worker-correct (`FOR UPDATE SKIP LOCKED`) if that ever changes.
- **Orphan recovery simplification** — at startup any `running` row is requeued wholesale (a freshly-booted single worker can't legitimately have one), which is simpler and safer than the time-based staleness check the spec sketched.
